import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { SeedLocalEventStream, type SeedLocalApiRegistration, type SeedLocalGatewayEvent, type SeedLocalGatewaySnapshot, type SeedLocalPluginRuntimeState } from '@motusai/seed-sdk'
import type { CapsRuntimeService } from './caps'
import type { SeedPluginHost } from './plugin-host'
import type { GlobalTaskActivityObserver } from './global-task-activity-observer'
import type { DiagnosticTraceContext, HostDiagnosticEvent } from '../shared/diagnostic-trace'

export const seedLocalApiPort = 43127
const maxBodyBytes = 1024 * 1024 * 1024
const allowedMethods = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'

function json(status: number, value: unknown) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function failure(status: number, code: string, message: string) {
  return json(status, { error: { code, message } })
}

function routeMatches(pattern: string, pathname: string) {
  const expected = pattern.split('/').filter(Boolean)
  const actual = pathname.split('/').filter(Boolean)
  for (let index = 0; index < expected.length; index += 1) {
    const part = expected[index]!
    if (part === '*') return index === expected.length - 1
    if (actual[index] === undefined) return false
    if (!part.startsWith(':') && part !== actual[index]) return false
  }
  return expected.length === actual.length
}

function registeredRoute(registration: SeedLocalApiRegistration, method: string, pathname: string) {
  return registration.routes.find((route) => (
    (route.method === '*' || route.method.toUpperCase() === method) && routeMatches(route.path, pathname)
  ))
}

async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > maxBodyBytes) throw Object.assign(new Error('Request body is too large.'), { code: 'body_too_large' })
    chunks.push(value)
  }
  return chunks.length ? Buffer.concat(chunks) : undefined
}

function pluginRoute(pathname: string) {
  const parts = pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
  if (parts[0] !== 'v1' || parts[1] !== 'plugins' || !parts[2]) return null
  const packageId = parts[2]
  const relativePath = `/${parts.slice(3).map((part) => encodeURIComponent(part)).join('/')}`.replace(/\/$/, '')
  return { packageId, relativePath: relativePath || '/' }
}

function applyCors(response: ServerResponse, origin: string) {
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Vary', 'Origin')
}

function requestHeaders(request: IncomingMessage) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (name.toLowerCase() === 'authorization' || name.toLowerCase() === 'cookie') continue
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else if (value !== undefined) headers.set(name, value)
  }
  return headers
}

export class SeedLocalHttpGateway {
  private server: Server | null = null
  private listeningPort = 0
  private stateEvents = new SeedLocalEventStream<SeedLocalGatewayEvent>({ initialId: Date.now() * 1_000 })
  private readonly pluginStates = new Map<string, SeedLocalPluginRuntimeState>()

  constructor(
    private readonly runtime: CapsRuntimeService,
    private readonly pluginHost: () => SeedPluginHost,
    private readonly requestedPort = seedLocalApiPort,
    private readonly taskActivityObserver?: GlobalTaskActivityObserver,
    private readonly onDiagnostic?: (event: HostDiagnosticEvent) => void,
  ) {}

  async start() {
    if (this.server) return
    const server = createServer((request, response) => void this.handle(request, response))
    this.server = server
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(this.requestedPort, '127.0.0.1', resolve)
      })
    } catch (error) {
      this.server = null
      server.close()
      if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'EADDRINUSE') {
        throw new Error(`Seed 本地 API 固定端口 ${this.requestedPort} 已被占用，请关闭占用该端口的程序后重试。`)
      }
      throw error
    }
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Seed 本地 API 未获得 TCP 端口。')
    this.listeningPort = address.port
  }

  port() { return this.listeningPort }

  async stop() {
    const server = this.server
    this.server = null
    this.stateEvents.close()
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        // Local clients can keep SSE and plugin-proxied streams open indefinitely.
        // Account logout must not wait for those connections before a later sign-in
        // can start the gateway and plugin runtimes again.
        server.closeAllConnections()
      })
    }
    this.listeningPort = 0
    this.pluginStates.clear()
    this.stateEvents = new SeedLocalEventStream<SeedLocalGatewayEvent>({ initialId: Date.now() * 1_000 })
  }

  updatePluginStates(states: SeedLocalPluginRuntimeState[]) {
    const next = new Map(states.map((state) => [state.plugin_id, state]))
    for (const [pluginId, previous] of this.pluginStates) {
      if (!next.has(pluginId)) this.stateEvents.publish({
        type: 'plugin.runtime.changed',
        plugin: { plugin_id: pluginId, state: 'unavailable' },
      }, 'plugin.runtime.changed')
      else {
        const current = next.get(pluginId)!
        if (current.state !== previous.state || current.version !== previous.version) {
          this.stateEvents.publish({ type: 'plugin.runtime.changed', plugin: current }, 'plugin.runtime.changed')
        }
        if (current.configuration_revision && current.configuration_revision !== previous.configuration_revision) {
          this.stateEvents.publish({
            type: 'plugin.configuration.changed',
            plugin_id: pluginId,
            configuration_revision: current.configuration_revision,
          }, 'plugin.configuration.changed')
        }
      }
    }
    for (const [pluginId, current] of next) {
      if (!this.pluginStates.has(pluginId)) this.stateEvents.publish({ type: 'plugin.runtime.changed', plugin: current }, 'plugin.runtime.changed')
    }
    this.pluginStates.clear()
    for (const [pluginId, state] of next) this.pluginStates.set(pluginId, state)
  }

  publishStateEvent(event: SeedLocalGatewayEvent) {
    this.stateEvents.publish(event, event.type)
  }

  stateSnapshot(): SeedLocalGatewaySnapshot {
    return { type: 'gateway.ready', protocol_version: 1, plugins: [...this.pluginStates.values()] }
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    let origin = String(request.headers.origin || '')
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/v1/status') {
        return await this.writeResponse(request, response, json(200, {
          running: true,
          port: this.listeningPort,
          protocol_version: 1,
        }), '')
      }
      if (request.method === 'OPTIONS' && url.pathname === '/v1/events') {
        const requestedMethod = String(request.headers['access-control-request-method'] || '').toUpperCase()
        if (requestedMethod !== 'GET') {
          return await this.writeResponse(request, response, failure(404, 'not_found', 'Route was not found.'), origin)
        }
        response.statusCode = 204
        applyCors(response, origin)
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Last-Event-ID')
        response.setHeader('Access-Control-Allow-Methods', allowedMethods)
        response.setHeader('Access-Control-Max-Age', '600')
        response.end()
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/events') {
        const requestedAfter = url.searchParams.get('after') || request.headers['last-event-id']
        const after = requestedAfter === undefined || requestedAfter === null
          ? this.stateEvents.latestId()
          : Number(requestedAfter)
        const clientId = url.searchParams.get('client_id') || ''
        const installationId = url.searchParams.get('installation_id') || ''
        return await this.writeResponse(request, response, this.stateEvents.response({
          after: Number.isFinite(after) ? after : this.stateEvents.latestId(),
          filter: (event) => event.type !== 'client.authorization.changed'
            || (Boolean(clientId) && event.client_id === clientId && event.installation_id === installationId),
          ready: this.stateSnapshot(),
        }), origin)
      }
      const route = pluginRoute(url.pathname)
      if (!route) return await this.writeResponse(request, response, failure(404, 'not_found', 'Route was not found.'), '')
      const registration = this.pluginHost().localApi(route.packageId)
      if (!registration) return await this.writeResponse(request, response, failure(404, 'plugin_api_unavailable', 'The plugin local API is unavailable.'), origin)

      if (origin && !registration.allowed_origins.includes(origin)) {
        return await this.writeResponse(request, response, failure(403, 'origin_forbidden', 'This origin is not allowed to access the plugin.'), '')
      }
      if (request.method === 'OPTIONS') {
        const requestedMethod = String(request.headers['access-control-request-method'] || '').toUpperCase()
        const authorizationRoute = route.relativePath === '/clients/authorize' && requestedMethod === 'POST'
        if (!authorizationRoute && (!requestedMethod || !registeredRoute(registration, requestedMethod, route.relativePath))) {
          return await this.writeResponse(request, response, failure(404, 'not_found', 'Route was not found.'), origin)
        }
        response.statusCode = 204
        applyCors(response, origin)
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Last-Event-ID, X-Seed-Attachment-Name')
        response.setHeader('Access-Control-Allow-Methods', allowedMethods)
        response.setHeader('Access-Control-Max-Age', '600')
        response.end()
        return
      }

      const authorization = String(request.headers.authorization || '')
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''

      if (request.method === 'POST' && route.relativePath === '/clients/authorize') {
        const input = JSON.parse((await requestBody(request))?.toString('utf8') || '{}') as Record<string, unknown>
        const clientId = String(input.client_id || '')
        if (!registration.allowed_client_ids.includes(clientId)) {
          return await this.writeResponse(request, response, failure(403, 'client_forbidden', 'This local client is not allowed to access the plugin.'), origin)
        }
        const result = await this.runtime.invoke_host('seed.local-client.authorize', {
          request_id: randomUUID(),
          package_id: route.packageId,
          client_id: clientId,
          installation_id: String(input.installation_id || ''),
          display_name: String(input.display_name || '').trim(),
          device_name: String(input.device_name || '').trim(),
          token,
        }) as { id?: unknown; token?: unknown }
        return await this.writeResponse(request, response, json(201, {
          auth_id: String(result.id || ''),
          token: String(result.token || ''),
        }), origin)
      }

      const method = String(request.method || 'GET').toUpperCase()
      const declaredRoute = registeredRoute(registration, method, route.relativePath)
      if (!declaredRoute) return await this.writeResponse(request, response, failure(404, 'not_found', 'Route was not found.'), origin)

      let authorizationId = ''
      if (!declaredRoute.public) {
        const verified = await this.verify(route.packageId, token)
        authorizationId = verified.authorizationId
        if (!verified.authorized) {
          return await this.writeResponse(request, response, failure(401, 'unauthorized', 'A valid authorized local client token is required.'), origin)
        }
      }

      const body = method === 'GET' || method === 'HEAD' ? undefined : await requestBody(request)
      const pluginUrl = new URL(request.url || '/', 'http://127.0.0.1')
      pluginUrl.pathname = route.relativePath
      const abort = new AbortController()
      response.once('close', () => abort.abort())
      const pluginRequest = new Request(pluginUrl, {
        method,
        headers: requestHeaders(request),
        ...(body ? { body } : {}),
        signal: abort.signal,
      })
      const requestId = randomUUID()
      const foreground = (declaredRoute.activity || 'foreground') === 'foreground'
      const trace: DiagnosticTraceContext = { trace_id: randomUUID(), span_id: randomUUID(),
        ...(!foreground ? { activity_visibility: 'technical' as const } : {}) }
      const started = performance.now()
      const definition = this.runtime.configuration()?.plugins.find((plugin) => plugin.package_id === route.packageId)
      const diagnostic = { ...trace, plugin_id: route.packageId,
        plugin_version: this.pluginStates.get(route.packageId)?.version,
        request_id: requestId, operation: `${method} ${route.relativePath}`, event: 'local_api.request',
        details: { ...(definition?.name ? { plugin_name_en_us: definition.name.en_US,
          plugin_name_zh_hans: definition.name.zh_Hans } : {}),
          ...(!foreground ? { activity_visibility: 'technical' } : {}) },
      }
      const emit = (event: HostDiagnosticEvent) => { try { this.onDiagnostic?.(event) } catch { /* Diagnostics must not break requests. */ } }
      emit({ ...diagnostic, phase: 'started', message: 'Local API request started.' })
      const activity = {
        requestId,
        taskId: requestId,
        operation: `${route.packageId}.local-api.${method.toLowerCase()}`,
      }
      if (foreground) this.taskActivityObserver?.observe(activity, 'started')
      try {
        const result = await this.pluginHost().withDiagnosticTrace(trace, () => registration.handle(
          pluginRequest,
          authorizationId ? { auth_id: authorizationId } : null,
        ))
        await this.writeResponse(
          request,
          response,
          await this.localizePluginError(route.packageId, result, String(request.headers['accept-language'] || '')),
          origin,
          declaredRoute.public ? undefined : () => this.verify(route.packageId, token),
        )
        const phase = result.ok && !response.destroyed ? 'completed' : 'failed'
        if (foreground) this.taskActivityObserver?.observe(activity, phase)
        emit({ ...diagnostic, phase, duration_ms: Math.round(performance.now() - started),
          ...(phase === 'failed' ? { error_code: response.destroyed ? 'client_disconnected' : `http_${result.status}` } : {}),
          message: response.destroyed ? 'Local API client disconnected.' : `Local API request returned HTTP ${result.status}.` })
      } catch (error) {
        if (foreground) this.taskActivityObserver?.observe(activity, 'failed')
        emit({ ...diagnostic, phase: 'failed', duration_ms: Math.round(performance.now() - started),
          error_code: error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined,
          error_name: error instanceof Error ? error.name : undefined,
          error_stack: error instanceof Error ? error.stack : undefined,
          message: error instanceof Error ? error.message : String(error) })
        throw error
      }
      return
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'invalid_request'
      const message = error instanceof Error ? error.message : String(error)
      if (!response.headersSent) await this.writeResponse(request, response, failure(code === 'body_too_large' ? 413 : 400, code, message), origin)
      else response.end()
    }
  }

  private async localizePluginError(packageId: string, response: Response, requestedLocale: string) {
    if (response.status < 400 || !response.headers.get('content-type')?.includes('application/json')) return response
    try {
      const value = await response.clone().json() as { error?: { code?: unknown; message?: unknown; params?: unknown } }
      if (!value.error || typeof value.error.code !== 'string') return response
      const params = value.error.params && typeof value.error.params === 'object'
        ? value.error.params as Record<string, unknown>
        : {}
      const locale = requestedLocale || this.runtime.configuration()?.locale || 'zh-CN'
      const fallback = String(value.error.message || '')
      const message = this.pluginHost().localizeError(packageId, value.error.code, params, locale, fallback)
      if (message === fallback) return response
      return new Response(JSON.stringify({
        ...value,
        error: {
          ...value.error,
          message,
          ...(fallback && fallback !== message ? { detail: fallback } : {}),
        },
      }), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    } catch {
      return response
    }
  }

  private async verify(packageId: string, token: string) {
    if (!token) return { authorized: false, authorizationId: '' }
    const result = await this.runtime.invoke_host('seed.local-client.verify', { package_id: packageId, token }) as {
      authorized?: unknown
      auth_id?: unknown
    }
    const authorizationId = String(result.auth_id || '')
    return { authorized: result.authorized === true && Boolean(authorizationId), authorizationId }
  }

  private async writeResponse(
    request: IncomingMessage,
    response: ServerResponse,
    value: Response,
    origin: string,
    reverify?: () => Promise<{ authorized: boolean }>,
  ) {
    response.statusCode = value.status
    value.headers.forEach((headerValue, name) => {
      const lowerName = name.toLowerCase()
      if (!lowerName.startsWith('access-control-')
        && !['connection', 'content-length', 'set-cookie', 'transfer-encoding'].includes(lowerName)) {
        response.setHeader(name, headerValue)
      }
    })
    applyCors(response, origin)
    if (!value.body) {
      response.end()
      return
    }
    const reader = value.body.getReader()
    let verificationRunning = false
    const timer = reverify ? setInterval(() => {
      if (verificationRunning) return
      verificationRunning = true
      void reverify().then((result) => {
        if (!result.authorized) {
          void reader.cancel('Local client authorization was revoked.')
          response.end()
        }
      }).catch(() => response.end()).finally(() => { verificationRunning = false })
    }, 15_000) : undefined
    const close = () => {
      if (timer) clearInterval(timer)
      void reader.cancel().catch(() => undefined)
    }
    request.once('aborted', close)
    response.once('close', close)
    try {
      while (!response.destroyed) {
        const chunk = await reader.read()
        if (chunk.done) break
        response.write(Buffer.from(chunk.value))
      }
    } finally {
      if (timer) clearInterval(timer)
      if (!response.writableEnded) response.end()
    }
  }
}
