import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PersonalCreditGrantPage } from '../shared/contracts'
import { isCreditAmount } from '../shared/credit-amount'

const invocationSchema = z.discriminatedUnion('billable', [
  z.object({ billable: z.literal(false) }),
  z.object({
    billable: z.literal(true), call_id: z.string().uuid(), amount: z.number().nonnegative().refine(isCreditAmount),
    charged_amount: z.number().nonnegative().refine(isCreditAmount).nullable().optional(),
    price_revision: z.number().int().positive(), state: z.enum(['prepared', 'executing', 'uncertain', 'settled', 'released']),
  }),
])

export type BillingPreparation = z.infer<typeof invocationSchema>
const personalWalletSchema = z.object({
  available: z.number().refine(isCreditAmount),
})
export type PersonalCreditWallet = z.infer<typeof personalWalletSchema>
const personalCreditGrantPageSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    amount: z.number().int().positive(),
    reason: z.string().min(1).max(240),
    created_at: z.string().datetime(),
  })),
  next_cursor: z.string().nullable(),
})
export type BillingRequest = {
  source_plugin_ids?: string[]
  invocation_id: string
  plugin_id: string
  plugin_version: string
  capability_id: string
  method: string
  model_id?: string
  arguments_sha256: string
}

type AccessTokenProvider = (rejectedToken?: string) => Promise<string>

export function relayBillingModelId(billingProduct: unknown, payload: Record<string, unknown>) {
  if (billingProduct !== 'model.generate') return undefined
  return typeof payload.model === 'string' && payload.model.trim() ? payload.model : undefined
}

const relaySchema = z.object({ payload: z.unknown() })
// Match Cloud's /credits/relay and /credits/relay/stream HTTP envelope limit.
const RELAY_REQUEST_MAX_BYTES = 64 * 1024 * 1024
function serializeRelayRequest(input: Record<string, unknown>) {
  const body = JSON.stringify(input)
  if (Buffer.byteLength(body) > RELAY_REQUEST_MAX_BYTES) {
    throw Object.assign(new Error('云转发请求超过大小限制，请减少内容后重试。'), {
      code: 'credit_relay_request_too_large',
    })
  }
  return body
}

function creditRequestError(response: Response, body: Record<string, unknown> | null) {
  const tooLarge = response.status === 413
  return Object.assign(new Error(typeof body?.message === 'string' ? body.message
    : tooLarge ? '云转发请求超过大小限制，请减少内容后重试。' : `积分服务请求失败（${response.status}）。`), {
    code: tooLarge ? 'credit_relay_request_too_large'
      : typeof body?.code === 'string' ? body.code : 'credit_service_error',
  })
}

const RELAY_STREAM_TERMINAL_TTL_MS = 60_000
type RelayStreamEnd = { done: true; billing?: { state: 'settled'; charged_amount: number } }
const relayModelsSchema = z.array(z.object({
  model_id: z.string(), display_name: z.string(), badge: z.string().nullable(),
  icon_data_url: z.string().nullable(),
  display_original_multiplier_basis_points: z.number().int().nonnegative(),
  display_discounted_multiplier_basis_points: z.number().int().nonnegative(),
  max_output_tokens: z.number().int().positive(), context_window: z.number().int().positive(),
  architecture: z.object({
    input_modalities: z.array(z.string()),
    output_modalities: z.array(z.string()),
  }).nullable(),
  supported_parameters: z.array(z.string()),
  reasoning: z.object({
    supported_efforts: z.array(z.string()).nullable().optional(),
    mandatory: z.boolean(),
    default_enabled: z.boolean().nullable(),
    default_effort: z.string().nullable(),
  }).nullable(),
}))

export class CreditBillingClient {
  private readonly relayStreams = new Map<string, {
    packageId: string; callId: string; reader: ReadableStreamDefaultReader<Uint8Array>;
    controller: AbortController; timer: ReturnType<typeof setTimeout>
    completion?: Promise<RelayStreamEnd>
  }>()
  private readonly terminalRelayStreams = new Map<string, {
    packageId: string; timer: ReturnType<typeof setTimeout>; result: RelayStreamEnd
  }>()

  constructor(private readonly cloudUrl: string, private readonly accessToken: AccessTokenProvider) {}

  private shouldRefreshAccessToken(response: Response, body: Record<string, unknown> | null) {
    return response.status === 401 && body?.code === 'invalid_token'
  }

  private rememberTerminalRelayStream(packageId: string, streamId: string, result: RelayStreamEnd = { done: true }) {
    const previous = this.terminalRelayStreams.get(streamId)
    if (previous) clearTimeout(previous.timer)
    const timer = setTimeout(() => { this.terminalRelayStreams.delete(streamId) }, RELAY_STREAM_TERMINAL_TTL_MS)
    timer.unref()
    this.terminalRelayStreams.set(streamId, { packageId, timer, result })
  }

  private terminalRelayStreamResult(packageId: string, streamId: string) {
    const terminal = this.terminalRelayStreams.get(streamId)
    if (!terminal) return undefined
    if (terminal.packageId !== packageId) throw new Error('云转发流不存在或不属于该插件。')
    return terminal.result
  }

  private completeRelayStream(packageId: string, streamId: string, result: RelayStreamEnd) {
    const stream = this.relayStreams.get(streamId)
    if (stream?.packageId === packageId) {
      this.relayStreams.delete(streamId)
      clearTimeout(stream.timer)
    }
    this.rememberTerminalRelayStream(packageId, streamId, result)
  }

  private async expireRelayStream(packageId: string, streamId: string) {
    const stream = this.relayStreams.get(streamId)
    if (!stream || stream.packageId !== packageId) return
    this.relayStreams.delete(streamId)
    clearTimeout(stream.timer)
    stream.controller.abort()
    await stream.reader.cancel().catch(() => undefined)
  }

  private async request<T>(path: string, schema: z.ZodType<T>, options: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
    let token = await this.accessToken()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${this.cloudUrl.replace(/\/+$/, '')}/api/v1/credits${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
      const body = await response.json().catch(() => null) as Record<string, unknown> | null
      if (attempt === 0 && this.shouldRefreshAccessToken(response, body)) {
        token = await this.accessToken(token)
        continue
      }
      if (!response.ok) {
        throw creditRequestError(response, body)
      }
      return schema.parse(body)
    }
    throw new Error('积分服务请求失败。')
  }

  prepare(input: BillingRequest) {
    return this.request('/invocations', invocationSchema, { method: 'POST', body: JSON.stringify(input) })
  }

  status(callId: string) {
    return this.request(`/invocations/${encodeURIComponent(callId)}`, invocationSchema)
  }

  cancel(callId: string) {
    return this.request(`/invocations/${encodeURIComponent(callId)}`, invocationSchema, { method: 'DELETE' })
  }

  async relay(input: { call_id: string; plugin_id: string; capability_id: string; method: string; payload: Record<string, unknown> }) {
    return this.request('/relay', relaySchema, { method: 'POST', body: serializeRelayRequest(input) }, 135_000)
  }

  async startRelayStream(input: { call_id: string; plugin_id: string; capability_id: string;
    method: string; payload: Record<string, unknown> }) {
    const body = serializeRelayRequest(input)
    const controller = new AbortController()
    let token = await this.accessToken()
    const headerTimer = setTimeout(() => controller.abort(), 120_000)
    let response: Response | undefined
    let responseBody: Record<string, unknown> | null | undefined
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        responseBody = undefined
        response = await fetch(`${this.cloudUrl.replace(/\/+$/, '')}/api/v1/credits/relay/stream`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream', 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        })
        if (attempt === 0 && response.status === 401) {
          responseBody = await response.json().catch(() => null) as Record<string, unknown> | null
          if (this.shouldRefreshAccessToken(response, responseBody)) {
            token = await this.accessToken(token)
            continue
          }
        }
        break
      }
    } finally { clearTimeout(headerTimer) }
    if (!response) throw new Error('积分服务请求失败。')
    if (!response.ok) {
      const body = responseBody ?? await response.json().catch(() => null) as Record<string, unknown> | null
      throw creditRequestError(response, body)
    }
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('云转发没有返回事件流。')
    }
    const streamId = randomUUID()
    const timer = setTimeout(() => { void this.expireRelayStream(input.plugin_id, streamId) }, 10 * 60_000)
    timer.unref()
    this.relayStreams.set(streamId, { packageId: input.plugin_id, callId: input.call_id,
      reader: response.body.getReader(), controller, timer })
    return { stream_id: streamId }
  }

  async nextRelayStream(packageId: string, streamId: string): Promise<RelayStreamEnd | { done: false; chunk: string }> {
    const stream = this.relayStreams.get(streamId)
    if (!stream) {
      const terminal = this.terminalRelayStreamResult(packageId, streamId)
      if (terminal) return terminal
      throw new Error('云转发流不存在或不属于该插件。')
    }
    if (stream.packageId !== packageId) throw new Error('云转发流不存在或不属于该插件。')
    try {
      const part = await stream.reader.read()
      if (part.done) {
        if (!this.relayStreams.has(streamId)) return { done: true }
        stream.completion ??= (async (): Promise<RelayStreamEnd> => {
          // Cloud settles before ending the response body. Never infer a charge from tokens.
          const settlement = await this.status(stream.callId).catch(() => undefined)
          const result: RelayStreamEnd = { done: true }
          if (settlement?.billable && settlement.state === 'settled' &&
            isCreditAmount(settlement.charged_amount) && settlement.charged_amount >= 0) {
            result.billing = { state: 'settled', charged_amount: settlement.charged_amount }
          }
          if (this.relayStreams.has(streamId)) this.completeRelayStream(packageId, streamId, result)
          return result
        })()
        return stream.completion
      }
      return { done: false, chunk: Buffer.from(part.value).toString('base64') }
    } catch (error) {
      await this.closeRelayStream(packageId, streamId)
      throw error
    }
  }

  async closeRelayStream(packageId: string, streamId: string) {
    const stream = this.relayStreams.get(streamId)
    if (!stream) return { closed: false }
    if (stream.packageId !== packageId) return { closed: false }
    this.relayStreams.delete(streamId)
    clearTimeout(stream.timer)
    this.rememberTerminalRelayStream(packageId, streamId)
    stream.controller.abort()
    await stream.reader.cancel().catch(() => undefined)
    return { closed: true }
  }

  async closeAllRelayStreams() {
    await Promise.all([...this.relayStreams].map(([id, stream]) => this.closeRelayStream(stream.packageId, id)))
    for (const terminal of this.terminalRelayStreams.values()) clearTimeout(terminal.timer)
    this.terminalRelayStreams.clear()
  }

  models(input: { plugin_id: string; capability_id: string; method: string }) {
    const params = new URLSearchParams(input)
    return this.request(`/relay/models?${params.toString()}`, relayModelsSchema, {}, 30_000)
  }

  personalWallet(): Promise<PersonalCreditWallet> {
    return this.request('/wallet', personalWalletSchema)
  }

  async personalGrants(cursor?: string): Promise<PersonalCreditGrantPage> {
    const query = new URLSearchParams({ page_size: '20' })
    if (cursor) query.set('cursor', cursor)
    const page = await this.request(`/grants?${query.toString()}`, personalCreditGrantPageSchema)
    return {
      items: page.items.map((item) => ({
        id: item.id,
        amount: item.amount,
        reason: item.reason,
        createdAt: item.created_at,
      })),
      ...(page.next_cursor ? { nextCursor: page.next_cursor } : {}),
    }
  }
}
