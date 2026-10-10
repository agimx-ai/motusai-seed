import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { SeedLocalApiRegistration } from '@motus-ai/seed-sdk'
import type { CapsRuntimeService } from './caps'
import { SeedLocalHttpGateway } from './local-http-gateway'
import type { SeedPluginHost } from './plugin-host'
import { GlobalTaskActivityObserver } from './global-task-activity-observer'

const origin = 'app://obsidian.md'

function registration(name: string): SeedLocalApiRegistration {
  return {
    allowed_origins: [origin],
    allowed_client_ids: ['com.motusai.obsidian'],
    routes: [
      { method: 'GET', path: '/status', public: true, activity: 'background' },
      { method: 'POST', path: '/echo' },
      { method: 'GET', path: '/events', activity: 'stream' },
      { method: 'GET', path: '/error', public: true },
      { method: 'GET', path: '/throw', public: true },
    ],
    handle: async (request, client) => {
      const url = new URL(request.url)
      if (url.pathname === '/status') return Response.json({ plugin: name })
      if (url.pathname === '/events') return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: ready\ndata: {"ok":true}\n\n'))
          controller.close()
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } })
      if (url.pathname === '/error') return Response.json({ error: { code: 'probe_failed', message: 'fallback detail' } }, { status: 400 })
      if (url.pathname === '/throw') throw new Error('plugin handler failed')
      return Response.json({ plugin: name, client, input: await request.json(), authorization_header: request.headers.get('Authorization') })
    },
  }
}

describe('SeedLocalHttpGateway', () => {
  let gateway: SeedLocalHttpGateway | undefined

  afterEach(async () => gateway?.stop())

  it('exposes only explicitly registered plugin tools over Streamable HTTP', async () => {
    const invoke = vi.fn(async () => ({ answer: 42 }))
    let available = true
    const runtime = { configuration: () => null, invoke_host: vi.fn() } as unknown as CapsRuntimeService
    const host = {
      localApi: () => undefined,
      mcpTools: () => available ? [{ name: 'read_probe', plugin: { package_id: 'com.example.probe' },
        capability: { id: 'probe' }, method: { name: 'read_probe', risk: 'read',
          description: { en_US: 'Read probe', zh_Hans: '读取探针' },
          inputSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] },
        } }] : [],
      invoke,
    } as unknown as SeedPluginHost
    gateway = new SeedLocalHttpGateway(runtime, () => host, 0)
    await gateway.start()
    const url = new URL(`http://127.0.0.1:${gateway.port()}/mcp`)
    const client = new Client({ name: 'seed-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } })
    try {
      await client.connect(new StreamableHTTPClientTransport(url))
      expect(client.getProtocolEra()).toBe('modern')
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['read_probe'])
      expect(await client.callTool({ name: 'read_probe', arguments: { value: 3 } })).toMatchObject({
        content: [{ type: 'text', text: '{"answer":42}' }],
      })
      expect(invoke).toHaveBeenCalledWith('probe', 'read_probe', expect.objectContaining({
        provider_plugin_id: 'com.example.probe', arguments: { value: 3 },
      }))
      expect(await client.callTool({ name: 'read_probe', arguments: { value: 'bad' } }))
        .toMatchObject({ isError: true })
      expect(invoke).toHaveBeenCalledTimes(1)
      available = false
      expect((await client.listTools()).tools).toEqual([])
    } finally {
      await client.close()
    }
  })

  it('rejects foreign browser origins at the MCP entrance', async () => {
    const runtime = { configuration: () => null, invoke_host: vi.fn() } as unknown as CapsRuntimeService
    const host = { localApi: () => undefined, mcpTools: () => [] } as unknown as SeedPluginHost
    gateway = new SeedLocalHttpGateway(runtime, () => host, 0)
    await gateway.start()
    const response = await fetch(`http://127.0.0.1:${gateway.port()}/mcp`, {
      method: 'POST', headers: { Origin: 'https://other.example' }, body: '{}',
    })
    expect(response.status).toBe(403)
  })

  it('can stop on account logout and restart after a later sign-in', async () => {
    const runtime = {
      configuration: () => null,
      invoke_host: vi.fn(),
    } as unknown as CapsRuntimeService
    const host = { localApi: () => undefined } as unknown as SeedPluginHost
    gateway = new SeedLocalHttpGateway(runtime, () => host, 0)

    await gateway.start()
    expect(gateway.port()).toBeGreaterThan(0)
    await gateway.stop()
    expect(gateway.port()).toBe(0)
    await gateway.start()
    expect(gateway.port()).toBeGreaterThan(0)
  })

  it('keeps plugin-unavailable errors readable by browser clients without relaxing registered routes', async () => {
    const runtime = {
      configuration: () => null,
      invoke_host: vi.fn(),
    } as unknown as CapsRuntimeService
    const host = { localApi: () => undefined } as unknown as SeedPluginHost
    gateway = new SeedLocalHttpGateway(runtime, () => host, 0)
    await gateway.start()

    const unavailable = await fetch(`http://127.0.0.1:${gateway.port()}/v1/plugins/com.example.missing/status`, {
      headers: { Origin: origin },
    })
    expect(unavailable.status).toBe(404)
    expect(unavailable.headers.get('Access-Control-Allow-Origin')).toBe(origin)
    await expect(unavailable.json()).resolves.toEqual({
      error: { code: 'plugin_api_unavailable', message: 'The plugin local API is unavailable.' },
    })
  })

  it('closes active local client streams before restarting after sign-in', async () => {
    const registration: SeedLocalApiRegistration = {
      allowed_origins: [origin],
      allowed_client_ids: ['com.motusai.obsidian'],
      routes: [{ method: 'GET', path: '/events', public: true }],
      handle: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: ready\ndata: {}\n\n'))
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } }),
    }
    const runtime = {
      configuration: () => null,
      invoke_host: vi.fn(),
    } as unknown as CapsRuntimeService
    const host = {
      localApi: () => registration,
      withDiagnosticTrace: (_trace: unknown, work: () => Promise<unknown>) => work(),
    } as unknown as SeedPluginHost
    gateway = new SeedLocalHttpGateway(runtime, () => host, 0)
    await gateway.start()

    const response = await fetch(`http://127.0.0.1:${gateway.port()}/v1/plugins/com.example.plugin/events`)
    const reader = response.body!.getReader()
    await expect(reader.read()).resolves.toMatchObject({ done: false })

    await expect(gateway.stop()).resolves.toBeUndefined()
    await gateway.start()
    expect(gateway.port()).toBeGreaterThan(0)
    await reader.cancel().catch(() => undefined)
  })

  it('accepts request bodies larger than the previous 8 MiB limit', async () => {
    const registration: SeedLocalApiRegistration = {
      allowed_origins: [origin],
      allowed_client_ids: ['com.motusai.obsidian'],
      routes: [{ method: 'POST', path: '/upload', public: true }],
      handle: async (request) => Response.json({ size: (await request.arrayBuffer()).byteLength }),
    }
    const runtime = {
      configuration: () => null,
      invoke_host: vi.fn(),
    } as unknown as CapsRuntimeService
    const host = { localApi: () => registration, withDiagnosticTrace: (_trace: unknown, work: () => Promise<unknown>) => work() } as unknown as SeedPluginHost
    gateway = new SeedLocalHttpGateway(runtime, () => host, 0)
    await gateway.start()

    const body = new Uint8Array(8 * 1024 * 1024 + 1)
    const response = await fetch(`http://127.0.0.1:${gateway.port()}/v1/plugins/com.example.plugin/upload`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/octet-stream' },
      body,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ size: body.byteLength })
  })

  it('owns one port and dispatches namespaced plugin routes with shared security controls', async () => {
    const registrations = new Map([
      ['com.example.first', registration('first')],
      ['com.example.second', registration('second')],
    ])
    const invoke_host = vi.fn(async (service: string, input: Record<string, unknown>) => {
      if (service === 'seed.local-client.authorize') return { id: 'authorization-1', token: 'authorized-token' }
      if (service === 'seed.local-client.verify') {
        const authorized = input.token === 'authorized-token'
        return { authorized, ...(authorized ? { auth_id: 'authorization-1' } : {}) }
      }
      throw new Error(`Unexpected service: ${service}`)
    })
    const runtime: CapsRuntimeService = {
      configuration: () => null,
      invoke_host,
    }
    const host = {
      localApi: (packageId: string) => registrations.get(packageId),
      withDiagnosticTrace: (_trace: unknown, work: () => Promise<unknown>) => work(),
      localizeError: (_packageId: string, code: string, _params: Record<string, unknown>, locale: string, fallback: string) => (
        code === 'probe_failed' && locale.startsWith('en') ? 'Localized failure.' : fallback
      ),
    } as unknown as SeedPluginHost
    const activityListener = vi.fn()
    const diagnosticListener = vi.fn()
    gateway = new SeedLocalHttpGateway(runtime, () => host, 0, new GlobalTaskActivityObserver(activityListener), diagnosticListener)
    await gateway.start()
    const base = `http://127.0.0.1:${gateway.port()}`

    const systemStatus = await fetch(`${base}/v1/status`)
    await expect(systemStatus.json()).resolves.toMatchObject({ running: true, port: gateway.port() })

    const forbiddenOrigin = await fetch(`${base}/v1/plugins/com.example.first/status`, {
      headers: { Origin: 'https://example.test' },
    })
    expect(forbiddenOrigin.status).toBe(403)
    expect(forbiddenOrigin.headers.get('Access-Control-Allow-Origin')).toBeNull()

    const preflight = await fetch(`${base}/v1/plugins/com.example.first/echo`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type, x-seed-attachment-name',
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('PATCH')
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('X-Seed-Attachment-Name')

    const authorization = await fetch(`${base}/v1/plugins/com.example.first/clients/authorize`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: 'com.motusai.obsidian',
        installation_id: 'installation-test',
        display_name: 'MotusAI for Obsidian',
        device_name: 'Duzhijun MacBook Pro',
      }),
    })
    expect(authorization.status).toBe(201)
    expect(invoke_host).toHaveBeenCalledWith('seed.local-client.authorize', expect.objectContaining({
      package_id: 'com.example.first', client_id: 'com.motusai.obsidian', device_name: 'Duzhijun MacBook Pro', token: '',
    }))

    const expandedAuthorization = await fetch(`${base}/v1/plugins/com.example.second/clients/authorize`, {
      method: 'POST',
      headers: { Origin: origin, Authorization: 'Bearer authorized-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: 'com.motusai.obsidian', installation_id: 'installation-test', display_name: 'MotusAI for Obsidian',
      }),
    })
    expect(expandedAuthorization.status).toBe(201)
    expect(invoke_host).toHaveBeenCalledWith('seed.local-client.authorize', expect.objectContaining({
      package_id: 'com.example.second', token: 'authorized-token',
    }))

    const unauthorized = await fetch(`${base}/v1/plugins/com.example.first/echo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    expect(unauthorized.status).toBe(401)

    const first = await fetch(`${base}/v1/plugins/com.example.first/echo`, {
      method: 'POST',
      headers: { Origin: origin, Authorization: 'Bearer authorized-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 1 }),
    })
    await expect(first.json()).resolves.toMatchObject({
      plugin: 'first', client: { auth_id: 'authorization-1' }, input: { value: 1 }, authorization_header: null,
    })
    expect(first.headers.get('Access-Control-Allow-Origin')).toBe(origin)

    const events = await fetch(`${base}/v1/plugins/com.example.first/events`, {
      headers: { Origin: origin, Authorization: 'Bearer authorized-token' },
    })
    expect(events.headers.get('content-type')).toBe('text/event-stream')
    await expect(events.text()).resolves.toBe('event: ready\ndata: {"ok":true}\n\n')

    const second = await fetch(`${base}/v1/plugins/com.example.second/status`)
    await expect(second.json()).resolves.toEqual({ plugin: 'second' })

    const localizedError = await fetch(`${base}/v1/plugins/com.example.first/error`, {
      headers: { 'Accept-Language': 'en-US' },
    })
    await expect(localizedError.json()).resolves.toEqual({
      error: { code: 'probe_failed', message: 'Localized failure.', detail: 'fallback detail' },
    })

    const thrownError = await fetch(`${base}/v1/plugins/com.example.first/throw`)
    expect(thrownError.status).toBe(400)

    const legacyVersionedRoute = await fetch(`${base}/v1/plugins/com.example.second/v1/status`)
    expect(legacyVersionedRoute.status).toBe(404)

    const activities = activityListener.mock.calls.map(([event]) => event)
    expect(activities).toHaveLength(6)
    expect(activities.map((event) => ({
      phase: event.phase,
      operation: event.operation,
      paired: event.requestId === event.taskId,
    }))).toEqual([
      { phase: 'started', operation: 'com.example.first.local-api.post', paired: true },
      { phase: 'completed', operation: 'com.example.first.local-api.post', paired: true },
      { phase: 'started', operation: 'com.example.first.local-api.get', paired: true },
      { phase: 'failed', operation: 'com.example.first.local-api.get', paired: true },
      { phase: 'started', operation: 'com.example.first.local-api.get', paired: true },
      { phase: 'failed', operation: 'com.example.first.local-api.get', paired: true },
    ])
    const diagnostics = diagnosticListener.mock.calls.map(([event]) => event)
    expect(diagnostics).toHaveLength(10)
    for (let index = 0; index < diagnostics.length; index += 2) {
      expect(diagnostics[index]).toMatchObject({ event: 'local_api.request', phase: 'started' })
      expect(diagnostics[index + 1]).toMatchObject({ event: 'local_api.request',
        trace_id: diagnostics[index].trace_id,
        span_id: diagnostics[index].span_id, request_id: diagnostics[index].request_id })
      expect(diagnostics[index + 1].duration_ms).toBeGreaterThanOrEqual(0)
    }
    expect(diagnostics.filter((event) => event.details?.activity_visibility === 'technical').map((event) => event.operation))
      .toEqual(['GET /events', 'GET /events', 'GET /status', 'GET /status'])
    expect(diagnostics.at(-1).error_stack).toContain('plugin handler failed')
  })

  it('streams framework plugin lifecycle changes and scopes authorization events to one client installation', async () => {
    const runtime = {
      configuration: () => null,
      invoke_host: vi.fn(),
    } as unknown as CapsRuntimeService
    const host = { localApi: () => undefined } as unknown as SeedPluginHost
    gateway = new SeedLocalHttpGateway(runtime, () => host, 0)
    await gateway.start()
    gateway.updatePluginStates([{ plugin_id: 'com.example.plugin', version: '1.0.0', state: 'ready', configuration_revision: 'revision-1' }])
    const preflight = await fetch(`http://127.0.0.1:${gateway.port()}/v1/events`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin)
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
    const controller = new AbortController()
    const response = await fetch(
      `http://127.0.0.1:${gateway.port()}/v1/events?client_id=com.example.client&installation_id=install-1`,
      { signal: controller.signal },
    )
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const nextData = async () => {
      while (true) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary >= 0) {
          const block = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
          if (data) return JSON.parse(data) as Record<string, unknown>
          continue
        }
        const chunk = await reader.read()
        if (chunk.done) throw new Error('SSE stream closed before the expected event.')
        buffer += decoder.decode(chunk.value, { stream: true }).replaceAll('\r\n', '\n')
      }
    }

    await expect(nextData()).resolves.toMatchObject({
      type: 'gateway.ready',
      protocol_version: 1,
      plugins: [{ plugin_id: 'com.example.plugin', version: '1.0.0', state: 'ready', configuration_revision: 'revision-1' }],
    })
    gateway.updatePluginStates([
      { plugin_id: 'com.example.plugin', version: '1.0.0', state: 'ready', configuration_revision: 'revision-1' },
      { plugin_id: 'com.example.second', version: '1.0.0', state: 'ready' },
    ])
    await expect(nextData()).resolves.toMatchObject({
      type: 'plugin.runtime.changed',
      plugin: { plugin_id: 'com.example.second', version: '1.0.0', state: 'ready' },
    })
    gateway.updatePluginStates([
      { plugin_id: 'com.example.plugin', version: '1.0.0', state: 'ready', configuration_revision: 'revision-2' },
      { plugin_id: 'com.example.second', version: '1.0.0', state: 'ready' },
    ])
    await expect(nextData()).resolves.toEqual({
      type: 'plugin.configuration.changed', plugin_id: 'com.example.plugin', configuration_revision: 'revision-2',
    })
    gateway.publishStateEvent({
      type: 'client.authorization.changed', client_id: 'another-client', installation_id: 'install-2', plugin_ids: [], state: 'authorized',
    })
    gateway.publishStateEvent({
      type: 'client.authorization.changed', client_id: 'com.example.client', installation_id: 'install-1', plugin_ids: ['com.example.plugin'], state: 'authorized',
    })
    await expect(nextData()).resolves.toMatchObject({
      type: 'client.authorization.changed', client_id: 'com.example.client', installation_id: 'install-1', state: 'authorized',
    })
    gateway.updatePluginStates([])
    await expect(nextData()).resolves.toEqual({
      type: 'plugin.runtime.changed', plugin: { plugin_id: 'com.example.plugin', state: 'unavailable' },
    })
    controller.abort()
    await reader.cancel().catch(() => undefined)
  })
})
