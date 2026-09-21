import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreditBillingClient, relayBillingModelId } from './credit-billing'

afterEach(() => vi.unstubAllGlobals())

describe('personal credit wallet', () => {
  it('loads only the personal wallet using the current Cloud access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ available: 2340 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new CreditBillingClient('https://cloud.example.com/', async () => 'access-token')
    expect(await client.personalWallet()).toEqual({ available: 2340 })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://cloud.example.com/api/v1/credits/wallet')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: 'Bearer access-token' } })
  })

  it('rejects invalid wallet data instead of showing a misleading balance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ available: '123' }), { status: 200 })))
    const client = new CreditBillingClient('https://cloud.example.com', async () => 'access-token')
    await expect(client.personalWallet()).rejects.toThrow()
  })

  it('refreshes a server-rejected access token once and retries the request', async () => {
    const accessToken = vi.fn(async (rejectedToken?: string) => rejectedToken ? 'fresh-token' : 'expired-token')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 'invalid_token', message: '登录已失效' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ available: 2340 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new CreditBillingClient('https://cloud.example.com', accessToken)
    await expect(client.personalWallet()).resolves.toEqual({ available: 2340 })
    expect(accessToken).toHaveBeenNthCalledWith(1)
    expect(accessToken).toHaveBeenNthCalledWith(2, 'expired-token')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: 'Bearer expired-token' } })
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ headers: { Authorization: 'Bearer fresh-token' } })
  })

  it('does not refresh for an unrelated authorization failure', async () => {
    const accessToken = vi.fn(async () => 'access-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      code: 'plugin_not_authorized', message: '插件未授权',
    }, { status: 401 })))

    const client = new CreditBillingClient('https://cloud.example.com', accessToken)
    await expect(client.personalWallet()).rejects.toMatchObject({ code: 'plugin_not_authorized' })
    expect(accessToken).toHaveBeenCalledOnce()
  })
})

describe('personal credit grants', () => {
  it('loads only grant records and maps the Cloud response for the renderer', async () => {
    const createdAt = '2026-09-21T04:30:00.000Z'
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      items: [{ id: 'grant-1', amount: 100, reason: '欢迎赠送', created_at: createdAt }],
      next_cursor: '20',
    }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new CreditBillingClient('https://cloud.example.com/', async () => 'access-token')
    await expect(client.personalGrants()).resolves.toEqual({
      items: [{ id: 'grant-1', amount: 100, reason: '欢迎赠送', createdAt }],
      nextCursor: '20',
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://cloud.example.com/api/v1/credits/grants?page_size=20')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: 'Bearer access-token' } })
  })

  it('sends the pagination cursor without exposing other ledger kinds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ items: [], next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new CreditBillingClient('https://cloud.example.com', async () => 'access-token')
    await client.personalGrants('20')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://cloud.example.com/api/v1/credits/grants?page_size=20&cursor=20')
  })
})

describe('generic Cloud relay client', () => {
  it('uses payload.model for provider-cost billing only', () => {
    const payload = { model: 'mimo-v2.5-asr' }
    expect(relayBillingModelId('audio.transcribe', payload)).toBeUndefined()
    expect(relayBillingModelId('model.generate', payload)).toBe('mimo-v2.5-asr')
    expect(relayBillingModelId('model.generate', {})).toBeUndefined()
  })

  it('passes through real model reasoning metadata without a plugin-specific rule', async () => {
    const catalog = [{ model_id: 'example/model', display_name: 'Example', badge: 'New', display_original_multiplier_basis_points: 10_000,
      display_discounted_multiplier_basis_points: 3000, max_output_tokens: 4096,
      context_window: 128000, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, supported_parameters: ['tools'],
      reasoning: { supported_efforts: ['low', 'high'], mandatory: false,
        default_enabled: true, default_effort: 'low' } }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(catalog)))
    const client = new CreditBillingClient('https://cloud.example.com', async () => 'access-token')
    expect(await client.models({ plugin_id: 'com.example.plugin', capability_id: 'hosted_models', method: 'complete' }))
      .toEqual(catalog)
  })

  it('pulls Cloud SSE chunks incrementally through an owner-bound stream handle', async () => {
    let sendSecond!: () => void
    const gate = new Promise<void>((resolve) => { sendSecond = resolve })
    const first = 'data: {"choices":[{"delta":{"content":"A"}}]}\n\n'
    const second = 'data: [DONE]\n\n'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(first))
        void gate.then(() => { controller.enqueue(new TextEncoder().encode(second)); controller.close() })
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } })))
    const client = new CreditBillingClient('https://cloud.example.com', async () => 'access-token')
    const input = { call_id: 'a9505c1e-9f5d-4658-a3e1-594a8bab2432', plugin_id: 'com.example.plugin',
      capability_id: 'hosted_models', method: 'complete', payload: { model: 'example/model', stream: true } }
    const { stream_id } = await client.startRelayStream(input)
    await expect(client.nextRelayStream('com.other.plugin', stream_id)).rejects.toThrow()
    const firstChunk = await client.nextRelayStream(input.plugin_id, stream_id)
    expect(Buffer.from(firstChunk.chunk!, 'base64').toString()).toBe(first)
    sendSecond()
    const secondChunk = await client.nextRelayStream(input.plugin_id, stream_id)
    expect(Buffer.from(secondChunk.chunk!, 'base64').toString()).toBe(second)
    expect(await client.nextRelayStream(input.plugin_id, stream_id)).toEqual({ done: true })
    await client.closeAllRelayStreams()
  })

  it('refreshes a rejected access token before opening a Cloud relay stream', async () => {
    const accessToken = vi.fn(async (rejectedToken?: string) => rejectedToken ? 'fresh-token' : 'expired-token')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 'invalid_token', message: '登录已失效' }, { status: 401 }))
      .mockResolvedValueOnce(new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new CreditBillingClient('https://cloud.example.com', accessToken)
    const input = { call_id: 'a9505c1e-9f5d-4658-a3e1-594a8bab2432', plugin_id: 'com.example.plugin',
      capability_id: 'hosted_models', method: 'complete', payload: { model: 'example/model', stream: true } }

    const { stream_id } = await client.startRelayStream(input)
    expect(accessToken).toHaveBeenNthCalledWith(2, 'expired-token')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ headers: { Authorization: 'Bearer fresh-token' } })
    await client.closeRelayStream(input.plugin_id, stream_id)
  })

  it('sends a prepared plugin capability with the current login token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ payload: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new CreditBillingClient('https://cloud.example.com', async () => 'access-token')
    const input = { call_id: 'a9505c1e-9f5d-4658-a3e1-594a8bab2432', plugin_id: 'com.example.plugin',
      capability_id: 'search', method: 'run', payload: { query: 'hello' } }
    expect(await client.relay(input)).toEqual({ payload: { results: [] } })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://cloud.example.com/api/v1/credits/relay')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST',
      body: JSON.stringify(input), headers: { Authorization: 'Bearer access-token' } })
  })

  it('surfaces an uncertain upstream result rather than assuming the charge was refunded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      code: 'credit_relay_outcome_uncertain', message: '待核查',
    }, { status: 503 })))
    const client = new CreditBillingClient('https://cloud.example.com', async () => 'access-token')
    await expect(client.relay({ call_id: 'a9505c1e-9f5d-4658-a3e1-594a8bab2432',
      plugin_id: 'com.example.plugin', capability_id: 'search', method: 'run', payload: {} }))
      .rejects.toMatchObject({ code: 'credit_relay_outcome_uncertain' })
  })
})
