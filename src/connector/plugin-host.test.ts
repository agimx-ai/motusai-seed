import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SeedPluginHost } from './plugin-host'
import { GlobalTaskActivityObserver } from './global-task-activity-observer'
import type { SeedPluginRuntimeDefinition, WorkerCommand } from '../shared/contracts'

const plugin: SeedPluginRuntimeDefinition = {
  package_id: 'com.example.schema',
  version: '1.0.0',
  name: { en_US: 'Schema', zh_Hans: '结构' },
  icon_data_url: 'data:image/svg+xml;base64,PHN2Zy8+',
  publisher_type: 'official',
  runtime_kind: 'sandboxed-web',
  root_path: '/installed/com.example.schema/1.0.0',
  entry_path: '/installed/com.example.schema/1.0.0/dist/index.mjs',
  sidecars: [],
  permissions: [],
  consumes: [],
  capabilities: [{
    id: 'probe',
    version: 1,
    exposure: 'terminal',
    errors: {
      probe_failed: { en_US: 'Probe {target} failed.', zh_Hans: '探测 {target} 失败。' },
    },
    methods: [{
      name: 'echo',
      risk: 'read',
      inputSchema: {
        type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
      },
      outputSchema: {
        type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
      },
    }],
  }],
}

const resourcePlugin: SeedPluginRuntimeDefinition = {
  ...plugin,
  package_id: 'com.example.resources',
  capabilities: [{
    id: 'workspace_resources',
    version: 1,
    annotations: {},
    methods: [{ name: 'roots', risk: 'read' }],
  }],
}

describe('SeedPluginHost protocol and Cordis runtime', () => {
  it('exports only explicit MCP tools and rejects duplicate names', async () => {
    const exported = { ...plugin, runtime_kind: 'native-host' as const,
      entry_path: '/does-not-exist/native-entry.mjs', capabilities: plugin.capabilities.map((capability) => ({
        ...capability, methods: capability.methods.map((method) => ({ ...method,
          annotations: { 'mcp.tool': true, 'mcp.tool_name': 'read_probe' },
        })),
      })) }
    const invoke_host = vi.fn(async (service: string) => {
      if (service === 'seed.native.start') return { capabilities: ['probe'], configurations: [], managementViews: [], connections: [] }
      if (service === 'seed.native.stop') return null
      throw new Error(`Unexpected service: ${service}`)
    })
    const host = new SeedPluginHost({ configuration: () => null, invoke_host },
      undefined, undefined, 'remote')
    await host.start([exported])
    expect(host.mcpTools().map((tool) => tool.name)).toEqual(['read_probe'])
    await expect(host.start([exported, { ...exported, package_id: 'com.example.other' }]))
      .rejects.toThrow('MCP 工具名称无效或重复')
    await host.start([])
    expect(host.mcpTools()).toEqual([])
    await host.stop()
  })

  it('intercepts paid capability calls in the host and requires trusted settlement before returning a result', async () => {
    const nativePlugin = {
      ...plugin,
      runtime_kind: 'native-host' as const,
      entry_path: '/does-not-exist/native-entry.mjs',
      capabilities: plugin.capabilities.map((capability) => ({
        ...capability,
        methods: capability.methods.map((method) => ({
          ...method,
          annotations: { 'billing.settlement': 'cloud_relay' },
        })),
      })),
    }
    let settled = false
    const diagnostic = vi.fn()
    const invoke_host = vi.fn(async (service: string, args: Record<string, unknown>): Promise<unknown> => {
      if (service === 'seed.native.start') return { capabilities: ['probe'], configurations: [], managementViews: [], connections: [] }
      if (service === 'seed.billing.prepare') return {
        billable: true, call_id: '0b0af977-b04c-47b6-b923-292121a3e508', amount: 7, price_revision: 1,
      }
      if (service === 'seed.native.invoke') {
        expect((args.invocation as { billing: unknown }).billing).toEqual({
          call_id: '0b0af977-b04c-47b6-b923-292121a3e508', amount: 7, price_revision: 1,
        })
        return { value: 'ok' }
      }
      if (service === 'seed.billing.status') return { state: settled ? 'settled' : 'prepared',
        ...(settled ? { charged_amount: 9 } : {}) }
      if (service === 'seed.billing.cancel' || service === 'seed.plugin.diagnostic') return null
      throw new Error(`Unexpected service: ${service}`)
    })
    const host = new SeedPluginHost({ configuration: () => null, invoke_host },
      undefined, undefined, 'remote', undefined, true, diagnostic)
    await host.start([nativePlugin])
    await expect(host.invoke('probe', 'echo', { request_id: 'first', arguments: { value: 'ok' } }))
      .rejects.toMatchObject({ code: 'credit_execution_unconfirmed' })
    expect(invoke_host).toHaveBeenCalledWith('seed.billing.cancel', { call_id: '0b0af977-b04c-47b6-b923-292121a3e508' })
    settled = true
    await expect(host.invoke('probe', 'echo', { request_id: 'second', arguments: { value: 'ok' } }))
      .resolves.toEqual({ value: 'ok' })
    await expect(host.invokeNativeWithChain('probe', 'echo', { request_id: 'nested', arguments: { value: 'ok' } },
      ['com.example.enterprise', nativePlugin.package_id])).resolves.toEqual({ value: 'ok' })
    const billingCalls = invoke_host.mock.calls.filter(([service]) => service === 'seed.billing.prepare')
    expect(billingCalls).toHaveLength(3)
    expect(billingCalls[0]?.[1].source_plugin_ids).toEqual([])
    expect(billingCalls[2]?.[1].source_plugin_ids).toEqual(['com.example.enterprise'])
    expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({
      request_id: 'second', phase: 'completed', details: expect.objectContaining({ credit_charged_amount: 9 }),
    }))
    await host.stop()
  })

  it('keeps free capability calls independent from Cloud billing availability', async () => {
    const nativePlugin = { ...plugin, runtime_kind: 'native-host' as const,
      entry_path: '/does-not-exist/native-entry.mjs' }
    const invoke_host = vi.fn(async (service: string, args: Record<string, unknown>): Promise<unknown> => {
      if (service === 'seed.native.start') return { capabilities: ['probe'], configurations: [], managementViews: [], connections: [] }
      if (service === 'seed.billing.prepare') throw new Error('Cloud billing is unavailable.')
      if (service === 'seed.native.invoke') return (args.invocation as { arguments: unknown }).arguments
      if (service === 'seed.native.stop' || service === 'seed.plugin.diagnostic') return null
      throw new Error(`Unexpected service: ${service}`)
    })
    const host = new SeedPluginHost({ configuration: () => null, invoke_host },
      undefined, undefined, 'remote', undefined, true)
    await host.start([nativePlugin])

    await expect(host.invoke('probe', 'echo', { request_id: 'free', arguments: { value: 'ok' } }))
      .resolves.toEqual({ value: 'ok' })
    expect(invoke_host).not.toHaveBeenCalledWith('seed.billing.prepare', expect.anything())
    await host.stop()
  })

  it('routes native plugins to an independent runtime and unmounts crashed contributions', async () => {
    const nativePlugin = { ...plugin, runtime_kind: 'native-host' as const,
      entry_path: '/does-not-exist/native-entry.mjs', permissions: ['local.http-api'] }
    const snapshot = { capabilities: ['probe'], configurations: [], managementViews: [], connections: [],
      localApi: { allowed_origins: ['app://probe'], allowed_client_ids: ['com.example.client'],
        routes: [{ method: 'GET', path: '/health', public: true }] } }
    let reads = 0
    const invoke_host = vi.fn(async (service: string, args: Record<string, unknown>): Promise<unknown> => {
      if (service === 'seed.native.start') return snapshot
      if (service === 'seed.native.invoke') return (args.invocation as { arguments: unknown }).arguments
      if (service === 'seed.native.local-api') return { status: 200, headers: [['content-type', 'application/json']], stream_id: 'stream-1' }
      if (service === 'seed.native.local-api.read') return reads++ === 0
        ? { done: false, chunk: new TextEncoder().encode('{"ok":true}') } : { done: true }
      if (service === 'seed.native.local-api.close') return null
      if (service === 'seed.native.stop' || service === 'seed.plugin.diagnostic') return null
      throw new Error(`Unexpected service: ${service}`)
    })
    const activities = vi.fn()
    let locale = 'en-US'
    const host = new SeedPluginHost({ configuration: () => ({ type: 'configure',
      appVersion: '1.0.0', locale, backupRoot: '/backup', pluginDataRoot: '/data', plugins: [] }),
    invoke_host },
      new GlobalTaskActivityObserver(activities), undefined, 'remote')
    await host.start([nativePlugin])
    expect(invoke_host).toHaveBeenCalledWith('seed.native.start', expect.objectContaining({ package_id: nativePlugin.package_id }))
    expect(host.supports('probe', 'echo')).toBe(true)
    await expect(host.invoke('probe', 'echo', { request_id: 'native-1', arguments: { value: 'text' } }))
      .resolves.toEqual({ value: 'text' })
    expect(activities).not.toHaveBeenCalled()
    await expect(host.localApi(nativePlugin.package_id)!.handle(new Request('http://127.0.0.1/health'), null)
      .then((response) => response.json())).resolves.toEqual({ ok: true })
    host.applyRemoteSnapshot(nativePlugin.package_id, null)
    expect(host.supports('probe', 'echo')).toBe(false)
    expect(host.localApi(nativePlugin.package_id)).toBeUndefined()
    host.applyRemoteSnapshot(nativePlugin.package_id, snapshot)
    expect(host.supports('probe', 'echo')).toBe(true)
    await host.start([nativePlugin])
    expect(invoke_host.mock.calls.filter(([service]) => service === 'seed.native.start')).toHaveLength(1)
    locale = 'zh-CN'
    await host.start([nativePlugin])
    expect(invoke_host.mock.calls.filter(([service]) => service === 'seed.native.start')).toHaveLength(2)
    await host.stop()
  })

  it('publishes the new remote native contributions after a plugin version update', async () => {
    const oldText = { en_US: 'Old models', zh_Hans: '旧模型' }
    const newText = { en_US: 'New models', zh_Hans: '新模型' }
    const declaration = (text: typeof oldText) => ({
      id: 'models', schemaVersion: 1 as const, renderer: 'seed.profiles' as const,
      title: text, description: text, fields: [],
      profiles: {
        idPrefix: 'model', minItems: 1, maxItems: 2, defaultRequired: true,
        summaryFields: ['name'], fields: [{ key: 'name', type: 'text' as const, label: text }],
        actions: { save: { label: text } },
      },
    })
    const nativePlugin = {
      ...plugin,
      runtime_kind: 'native-host' as const,
      entry_path: '/does-not-exist/native-entry.mjs',
    }
    const contributionsChanged = vi.fn()
    const invoke_host = vi.fn(async (service: string, args: Record<string, unknown>): Promise<unknown> => {
      if (service === 'seed.native.start') {
        const runtimePlugin = args.plugin as SeedPluginRuntimeDefinition
        return {
          capabilities: ['probe'],
          configurations: [declaration(runtimePlugin.version === '2.0.0' ? newText : oldText)],
          managementViews: [],
          connections: [],
        }
      }
      if (service === 'seed.native.stop' || service === 'seed.plugin.diagnostic') return null
      throw new Error(`Unexpected service: ${service}`)
    })
    const host = new SeedPluginHost(
      { configuration: () => null, invoke_host },
      undefined,
      contributionsChanged,
      'remote',
    )

    await host.start([{ ...nativePlugin, version: '1.0.0' }])
    contributionsChanged.mockClear()
    await host.start([{ ...nativePlugin, version: '2.0.0' }])

    expect(contributionsChanged).not.toHaveBeenCalledWith(nativePlugin.package_id, {
      configurations: [],
      managementViews: [],
    })
    expect(contributionsChanged).toHaveBeenCalledWith(nativePlugin.package_id, expect.objectContaining({
      configurations: [expect.objectContaining({ title: newText })],
    }))
    await host.stop()
  })

  it('keeps failed native declarations unavailable until their supervised process recovers', async () => {
    const nativePlugin = { ...plugin, runtime_kind: 'native-host' as const,
      entry_path: '/does-not-exist/native-entry.mjs' }
    const invoke_host = vi.fn(async (service: string) => {
      if (service === 'seed.native.start') throw new Error('Process exited during startup.')
      return null
    })
    const host = new SeedPluginHost({ configuration: () => null, invoke_host },
      undefined, undefined, 'remote')
    expect(await host.start([nativePlugin])).toMatchObject([{ packageId: nativePlugin.package_id }])
    expect(host.supports('probe', 'echo')).toBe(false)
    host.applyRemoteSnapshot(nativePlugin.package_id, {
      capabilities: ['probe'], configurations: [], managementViews: [], connections: [],
    })
    expect(host.supports('probe', 'echo')).toBe(true)
    await host.stop()
  })
  it('validates declarations and delegates execution without importing package code', async () => {
    const invoke_host = vi.fn(async (_service: string, argumentsValue: Record<string, unknown>) => {
      return (argumentsValue.invocation as { arguments: unknown }).arguments
    })
    const activityListener = vi.fn()
    const host = new SeedPluginHost(
      { configuration: () => null, invoke_host },
      new GlobalTaskActivityObserver(activityListener),
    )
    await host.start([plugin])
    await expect(host.invoke('probe', 'echo', { request_id: '1', arguments: { value: 42 } }))
      .rejects.toMatchObject({ code: 'invalid_arguments' })
    await expect(host.invoke('probe', 'echo', { request_id: '2', arguments: { value: 'text' } }))
      .resolves.toEqual({ value: 'text' })
    expect(invoke_host).toHaveBeenCalledWith('seed.plugin.invoke', expect.objectContaining({ package_id: plugin.package_id }))
    expect(activityListener.mock.calls.map(([event]) => event)).toEqual([
      { type: 'task.changed', requestId: '2', taskId: '2', phase: 'started', operation: 'probe.echo' },
      { type: 'task.changed', requestId: '2', taskId: '2', phase: 'completed', operation: 'probe.echo' },
    ])
  })

  it('uses plugin-owned error text in the configured client language', async () => {
    const failure = Object.assign(new Error('fallback'), { code: 'probe_failed', params: { target: 'clock' } })
    const configuration = {
      type: 'configure', appVersion: '1.0.0', locale: 'en-US',
      backupRoot: '', pluginDataRoot: '', plugins: [],
    } satisfies Extract<WorkerCommand, { type: 'configure' }>
    const activityListener = vi.fn()
    const host = new SeedPluginHost(
      {
        configuration: () => configuration,
        invoke_host: vi.fn(async () => { throw failure }),
      },
      new GlobalTaskActivityObserver(activityListener),
    )
    await host.start([plugin])
    await expect(host.invoke('probe', 'echo', { request_id: 'localized-1', arguments: { value: 'text' } }))
      .rejects.toMatchObject({ code: 'probe_failed', message: 'Probe clock failed.', params: { target: 'clock' } })
    expect(activityListener.mock.calls.map(([event]) => event.phase)).toEqual(['started', 'failed'])
  })

  it('records the original plugin error before presenting a localized failure', async () => {
    const failure = new Error('raw provider failure')
    const diagnostic = vi.fn()
    const invoke_host = vi.fn(async (service: string) => {
      if (service === 'seed.plugin.invoke') throw failure
      return undefined
    })
    const host = new SeedPluginHost({ configuration: () => null, invoke_host },
      undefined, undefined, 'local', undefined, false, diagnostic)
    await host.start([plugin])
    await expect(host.invoke('probe', 'echo', { request_id: 'raw-1', arguments: { value: 'text' } })).rejects.toThrow()
    expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({
      event: 'capability.execute', phase: 'failed', request_id: 'raw-1', plugin_id: plugin.package_id,
      message: failure.message, error_stack: failure.stack,
    }))
    expect(invoke_host).not.toHaveBeenCalledWith('seed.plugin.diagnostic', expect.anything())
  })

  it('marks framework management queries as technical without hiding management actions', async () => {
    const diagnostic = vi.fn()
    const activity = vi.fn()
    const invoke_host = vi.fn(async (service: string, argumentsValue: Record<string, unknown>) => {
      if (service === 'seed.plugin.invoke') return (argumentsValue.invocation as { arguments: unknown }).arguments
      return undefined
    })
    const host = new SeedPluginHost({ configuration: () => null, invoke_host },
      new GlobalTaskActivityObserver(activity), undefined, 'local', undefined, false, diagnostic)
    await host.start([plugin])
    await host.invoke('probe', 'echo', {
      request_id: 'management-query', arguments: { value: 'query' },
      context: { source: 'seed.management', data_source_id: 'primary' },
      principal: { kind: 'seed', surface: 'management' },
    })
    await host.invoke('probe', 'echo', {
      request_id: 'management-action', arguments: { value: 'action' },
      context: { source: 'seed.management', action_id: 'save' },
      principal: { kind: 'seed', surface: 'management' },
    })
    await host.withDiagnosticTrace({
      trace_id: 'background-trace', span_id: 'background-parent', activity_visibility: 'technical',
    }, () => host.invoke('probe', 'echo', {
      request_id: 'background-child', arguments: { value: 'background' },
    }))
    const started = diagnostic.mock.calls.map(([event]) => event)
      .filter((event) => event.phase === 'started')
    expect(started).toEqual([
      expect.objectContaining({ request_id: 'management-query', details: expect.objectContaining({ activity_visibility: 'technical' }) }),
      expect.objectContaining({ request_id: 'management-action', details: expect.not.objectContaining({ activity_visibility: 'technical' }) }),
      expect.objectContaining({ request_id: 'background-child', details: expect.objectContaining({ activity_visibility: 'technical' }) }),
    ])
    expect(activity.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({ requestId: 'management-action', phase: 'started' }),
      expect.objectContaining({ requestId: 'management-action', phase: 'completed' }),
    ])
  })

  it('loads a native-host plugin without a package dependency', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-native-plugin-'))
    const dataRoot = join(directory, 'plugin-data')
    const entryPath = join(directory, 'runtime.mjs')
    await writeFile(entryPath, [
      "import { mkdir, writeFile } from 'node:fs/promises'",
      "import { join } from 'node:path'",
      'export async function apply(context) {',
      '  await mkdir(context.package.data_path, { recursive: true })',
      "  context.effect(() => context.localApi.register({ allowed_origins: ['app://test'], allowed_client_ids: ['com.example.client'], routes: [{ method: 'GET', path: '/status', public: true }], handle: () => Response.json({ ok: true }) }))",
      "  await context.audit.record({ operation: 'workspace.registered', outcome: 'allowed', metadata: { workspace_id: 'vault-test' } })",
      "  await writeFile(join(context.package.data_path, 'started.json'), JSON.stringify({ package_id: context.package.package_id }))",
      "  context.effect(() => context.capabilities.register('native_probe', { invoke: async (method, invocation) => ({ method, value: invocation.arguments.value }) }))",
      '}',
    ].join('\n'))
    try {
      const invokeHost = vi.fn(async () => ({ authorized: true }))
      const host = new SeedPluginHost({
        configuration: () => ({
          type: 'configure',
          appVersion: '1.0.0',
          locale: 'en-US',
          backupRoot: join(directory, 'backups'),
          pluginDataRoot: dataRoot,
          plugins: [],
        }),
        invoke_host: invokeHost,
      })
      await host.start([{
        ...plugin,
        package_id: 'com.motusai.seed.native-probe',
        publisher_type: 'official',
        runtime_kind: 'native-host',
        entry_path: entryPath,
        permissions: ['local.http-api'],
        capabilities: [{ id: 'native_probe', version: 1, methods: [{ name: 'echo', risk: 'read' }] }],
      }])
      await expect(host.invoke('native_probe', 'echo', { request_id: 'native-1', arguments: { value: 'ok' } }))
        .resolves.toEqual({ method: 'echo', value: 'ok' })
      await expect(readFile(join(dataRoot, 'com.motusai.seed.native-probe', 'started.json'), 'utf8'))
        .resolves.toContain('"package_id":"com.motusai.seed.native-probe"')
      expect(invokeHost).toHaveBeenCalledWith('seed.plugin.audit', {
        entry: { operation: 'workspace.registered', outcome: 'allowed', metadata: { workspace_id: 'vault-test' } },
        package_id: 'com.motusai.seed.native-probe',
        plugin_version: '1.0.0',
      })
      const localApi = host.localApi('com.motusai.seed.native-probe')
      expect(localApi).toMatchObject({ allowed_origins: ['app://test'], allowed_client_ids: ['com.example.client'] })
      await expect(Promise.resolve(localApi!.handle(new Request('http://127.0.0.1/status'), null)).then((response) => response.json()))
        .resolves.toEqual({ ok: true })
      await host.stop()
      expect(host.localApi('com.motusai.seed.native-probe')).toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('requires a declared authorization standard before opening the browser', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-native-authorization-'))
    const entryPath = join(directory, 'runtime.mjs')
    await writeFile(entryPath, [
      'export async function apply(context) {',
      "  context.effect(() => context.capabilities.register('auth_probe', { invoke: () => context.authorization.authorize({ standard: 'oauth2.authorization_code.pkce', authorization_endpoint: 'https://accounts.example.com/authorize', client_id: 'public-client', scope: 'read' }) }))",
      '}',
    ].join('\n'))
    const invokeHost = vi.fn(async (service: string) => service === 'seed.plugin-authorization'
      ? { code: 'auth-code', code_verifier: 'verifier', redirect_uri: 'com.motusai.seed:/plugin/oauth/callback' }
      : {})
    const host = new SeedPluginHost({
      configuration: () => ({ type: 'configure', appVersion: '1.0.0', locale: 'en-US', backupRoot: directory, pluginDataRoot: directory, plugins: [] }),
      invoke_host: invokeHost,
    })
    const authPlugin: SeedPluginRuntimeDefinition = {
      ...plugin,
      package_id: 'com.example.auth-probe',
      publisher_type: 'official',
      runtime_kind: 'native-host',
      entry_path: entryPath,
      capabilities: [{ id: 'auth_probe', version: 1, methods: [{ name: 'authorize', risk: 'read' }] }],
    }
    try {
      await host.start([authPlugin])
      await expect(host.invoke('auth_probe', 'authorize', { request_id: 'auth-denied', arguments: {} }))
        .rejects.toThrow('未声明对应标准')
      expect(invokeHost).not.toHaveBeenCalledWith('seed.plugin-authorization', expect.anything())
      await host.start([{ ...authPlugin, permissions: ['authorization.oauth2.pkce'] }])
      await expect(host.invoke('auth_probe', 'authorize', { request_id: 'auth-allowed', arguments: {} }))
        .resolves.toMatchObject({ code: 'auth-code' })
      expect(invokeHost).toHaveBeenCalledWith('seed.plugin-authorization', expect.objectContaining({
        operation: 'start', package_id: authPlugin.package_id,
      }))
    } finally {
      await host.stop()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('tracks plugin-owned network connections and closes them with the Fiber on reload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-native-connection-'))
    const dataRoot = join(directory, 'plugin-data')
    const entryPath = join(directory, 'runtime.mjs')
    const lifecyclePath = join(directory, 'connection-lifecycle.txt')
    await writeFile(entryPath, [
      "import { appendFile } from 'node:fs/promises'",
      `const lifecyclePath = ${JSON.stringify(lifecyclePath)}`,
      'export async function apply(context) {',
      "  context.configuration.register({ id: 'accounts', schema_version: 1, renderer: 'seed.profiles', title: { en_US: 'Accounts', zh_Hans: '账户' }, description: { en_US: 'Accounts', zh_Hans: '账户' }, profiles: { id_prefix: 'account', min_items: 1, max_items: 2, default_required: true, summary_fields: ['name'], status: { source: 'connections' }, fields: [{ key: 'name', type: 'text', label: { en_US: 'Name', zh_Hans: '名称' } }], actions: { save: { label: { en_US: 'Save', zh_Hans: '保存' } } } } })",
      '  let connection',
      '  connection = context.connections.register({',
      "    id: 'primary', transport: 'websocket', permission: 'network.connect.internet',",
      "    label: { en_US: 'Primary', zh_Hans: '主连接' },",
      "    profile: { configuration_id: 'accounts', profile_id: 'account-main' },",
      "    reconnect: () => appendFile(lifecyclePath, 'reconnect\\n'),",
      "    close: () => appendFile(lifecyclePath, `close:${connection.signal.aborted}\\n`),",
      '  })',
      "  connection.update({ state: 'connected' })",
      '}',
    ].join('\n'))
    try {
      const host = new SeedPluginHost({
        configuration: () => ({
          type: 'configure', appVersion: '1.0.0', locale: 'en-US',
          backupRoot: join(directory, 'backups'), pluginDataRoot: dataRoot, plugins: [],
        }),
        invoke_host: vi.fn(),
      })
      const connectionPlugin: SeedPluginRuntimeDefinition = {
        ...plugin,
        package_id: 'com.motusai.seed.connection-probe',
        publisher_type: 'official',
        runtime_kind: 'native-host',
        entry_path: entryPath,
        permissions: ['network.connect.internet'],
      }

      await expect(host.start([connectionPlugin])).resolves.toEqual([])
      expect(host.connectionSnapshots(connectionPlugin.package_id)).toMatchObject([{
        plugin_id: connectionPlugin.package_id,
        id: 'primary',
        transport: 'websocket',
        permission: 'network.connect.internet',
        profile: { configuration_id: 'accounts', profile_id: 'account-main' },
        reconnectable: true,
        state: 'connected',
      }])

      await expect(host.reconnectProfileConnection(connectionPlugin.package_id, 'accounts', 'account-main')).resolves.toBeUndefined()
      expect(await readFile(lifecyclePath, 'utf8')).toBe('reconnect\n')
      await host.start([])
      expect(host.connectionSnapshots(connectionPlugin.package_id)).toEqual([])
      expect(await readFile(lifecyclePath, 'utf8')).toBe('reconnect\nclose:true\n')
      await host.stop()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects connection registration without the network permission', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-native-connection-permission-'))
    const entryPath = join(directory, 'runtime.mjs')
    await writeFile(entryPath, [
      'export function apply(context) {',
      "  context.connections.register({ id: 'primary', transport: 'websocket', permission: 'network.connect.internet', close() {} })",
      '}',
    ].join('\n'))
    try {
      const host = new SeedPluginHost({
        configuration: () => ({
          type: 'configure', appVersion: '1.0.0', locale: 'en-US',
          backupRoot: join(directory, 'backups'), pluginDataRoot: join(directory, 'plugin-data'), plugins: [],
        }),
        invoke_host: vi.fn(),
      })
      const failures = await host.start([{
        ...plugin,
        package_id: 'com.motusai.seed.connection-without-permission',
        publisher_type: 'official',
        runtime_kind: 'native-host',
        entry_path: entryPath,
      }])
      expect(failures).toEqual([expect.objectContaining({
        packageId: 'com.motusai.seed.connection-without-permission',
        message: expect.stringContaining('network.connect.internet'),
      })])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('mounts one package Fiber that can register multiple capabilities', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-native-multi-capability-'))
    const dataRoot = join(directory, 'plugin-data')
    const entryPath = join(directory, 'runtime.mjs')
    const lifecyclePath = join(directory, 'lifecycle.txt')
    await writeFile(entryPath, [
      "import { appendFile } from 'node:fs/promises'",
      `const lifecyclePath = ${JSON.stringify(lifecyclePath)}`,
      "export async function apply(context) { await appendFile(lifecyclePath, 'start\\n')",
      "  const handler = { invoke: async (method, invocation) => ({ capability: invocation.capability, method }) }",
      "  context.effect(() => context.capabilities.register('first_capability', handler))",
      "  context.effect(() => context.capabilities.register('second_capability', handler))",
      "  context.effect(() => () => appendFile(lifecyclePath, 'stop\\n'))",
      '}',
    ].join('\n'))
    try {
      const host = new SeedPluginHost({
        configuration: () => ({
          type: 'configure', appVersion: '1.0.0', locale: 'en-US',
          backupRoot: join(directory, 'backups'), pluginDataRoot: dataRoot, plugins: [],
        }),
        invoke_host: vi.fn(),
      })
      await host.start([{
        ...plugin,
        package_id: 'com.motusai.seed.multi-native',
        publisher_type: 'official',
        runtime_kind: 'native-host',
        entry_path: entryPath,
        capabilities: [
          { id: 'first_capability', version: 1, methods: [{ name: 'status', risk: 'read' }] },
          { id: 'second_capability', version: 1, methods: [{ name: 'status', risk: 'read' }] },
        ],
      }])
      await expect(host.invoke('first_capability', 'status', { request_id: 'first', arguments: {} }))
        .resolves.toEqual({ capability: 'first_capability', method: 'status' })
      await expect(host.invoke('second_capability', 'status', { request_id: 'second', arguments: {} }))
        .resolves.toEqual({ capability: 'second_capability', method: 'status' })
      expect(await readFile(lifecyclePath, 'utf8')).toBe('start\n')
      await host.stop()
      expect(await readFile(lifecyclePath, 'utf8')).toBe('start\nstop\n')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('preserves unchanged native runtimes when another plugin is added', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-native-plugin-reconfigure-'))
    const dataRoot = join(directory, 'plugin-data')
    const entryPath = join(directory, 'runtime.mjs')
    const lifecyclePath = join(directory, 'lifecycle.txt')
    await writeFile(entryPath, [
      "import { appendFile } from 'node:fs/promises'",
      `const lifecyclePath = ${JSON.stringify(lifecyclePath)}`,
      "export async function apply(context) { await appendFile(lifecyclePath, 'start\\n')",
      "  context.effect(() => context.capabilities.register('stable_native', { invoke: async () => ({ ok: true }) }))",
      "  context.effect(() => () => appendFile(lifecyclePath, 'stop\\n'))",
      '}',
    ].join('\n'))
    const nativePlugin: SeedPluginRuntimeDefinition = {
      ...plugin,
      package_id: 'com.motusai.seed.stable-native',
      publisher_type: 'official',
      runtime_kind: 'native-host',
      entry_path: entryPath,
      capabilities: [{ id: 'stable_native', version: 1, methods: [{ name: 'status', risk: 'read' }] }],
    }
    try {
      const host = new SeedPluginHost({
        configuration: () => ({
          type: 'configure', appVersion: '1.0.0', locale: 'en-US',
          backupRoot: join(directory, 'backups'), pluginDataRoot: dataRoot, plugins: [],
        }),
        invoke_host: vi.fn(),
      })
      await host.start([nativePlugin])
      await host.start([nativePlugin, plugin])
      expect(await readFile(lifecyclePath, 'utf8')).toBe('start\n')
      await host.stop()
      expect(await readFile(lifecyclePath, 'utf8')).toBe('start\nstop\n')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('reuses native modules and keeps configuration contributions mounted during a runtime refresh', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-native-plugin-refresh-'))
    const dataRoot = join(directory, 'plugin-data')
    const entryPath = join(directory, 'runtime.mjs')
    const lifecyclePath = join(directory, 'lifecycle.txt')
    await writeFile(entryPath, [
      "import { appendFile } from 'node:fs/promises'",
      `const lifecyclePath = ${JSON.stringify(lifecyclePath)}`,
      "await appendFile(lifecyclePath, 'import\\n')",
      "const text = { en_US: 'Models', zh_Hans: '模型' }",
      'export async function apply(context) {',
      "  await appendFile(lifecyclePath, 'start\\n')",
      "  context.effect(() => context.configuration.register({ id: 'models', schema_version: 1, renderer: 'seed.profiles', title: text, description: text, fields: [], profiles: { id_prefix: 'model', min_items: 1, max_items: 2, default_required: true, summary_fields: ['name'], fields: [{ key: 'name', type: 'text', label: text, required: true, default: 'test' }], actions: { save: { label: text } } } }))",
      "  context.effect(() => context.capabilities.register('refreshable_native', { invoke: async () => ({ ok: true }) }))",
      "  context.effect(() => () => appendFile(lifecyclePath, 'stop\\n'))",
      '}',
    ].join('\n'))
    const contributionsChanged = vi.fn()
    const nativePlugin: SeedPluginRuntimeDefinition = {
      ...plugin,
      package_id: 'com.motusai.seed.refreshable-native',
      publisher_type: 'official',
      runtime_kind: 'native-host',
      entry_path: entryPath,
      configuration_revision: 'revision-1',
      capabilities: [{ id: 'refreshable_native', version: 1, methods: [{ name: 'status', risk: 'read' }] }],
    }
    try {
      const host = new SeedPluginHost({
        configuration: () => ({
          type: 'configure', appVersion: '1.0.0', locale: 'en-US',
          backupRoot: join(directory, 'backups'), pluginDataRoot: dataRoot, plugins: [],
        }),
        invoke_host: vi.fn(),
      }, undefined, contributionsChanged)

      await host.start([nativePlugin])
      contributionsChanged.mockClear()
      await host.start([{ ...nativePlugin, configuration_revision: 'revision-2' }])

      expect(await readFile(lifecyclePath, 'utf8')).toBe('import\nstart\nstop\nstart\n')
      expect(contributionsChanged).not.toHaveBeenCalledWith(nativePlugin.package_id, {
        configurations: [],
        managementViews: [],
      })
      await host.stop()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('makes validated configuration available during the first native plugin startup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-native-plugin-config-bootstrap-'))
    const entryPath = join(directory, 'runtime.mjs')
    await writeFile(entryPath, [
      "const text = { en_US: 'Service', zh_Hans: '服务' }",
      'export async function apply(context) {',
      "  context.effect(() => context.configuration.register({ id: 'service', schema_version: 1, renderer: 'seed.profiles', title: text, description: text, profiles: { summary_fields: ['url'], fields: [{ key: 'url', type: 'text', label: text, placeholder: text }], actions: { save: { label: text } } } }))",
      "  const direct = await context.invokeHost('seed.configuration', { configuration_id: 'service' }).catch((error) => String(error))",
      "  if (!direct.includes('必须通过已注册的配置接口')) throw new Error('Direct configuration access was not rejected')",
      "  await context.configuration.get('service')",
      '}',
    ].join('\n'))
    const invokeHost = vi.fn(async (service: string, args: Record<string, unknown>) => {
      if (service !== 'seed.configuration') throw new Error(`Unexpected service: ${service}`)
      expect(args.declaration).toMatchObject({ id: 'service', profiles: { fields: [{ key: 'url', placeholder: { en_US: 'Service', zh_Hans: '服务' } }] } })
      return { schema_version: 1, profiles: [], default_profile_id: '', values: {} }
    })
    const contributionsChanged = vi.fn()
    const nativePlugin: SeedPluginRuntimeDefinition = {
      ...plugin,
      package_id: 'com.motusai.seed.config-bootstrap',
      publisher_type: 'official',
      runtime_kind: 'native-host',
      entry_path: entryPath,
      capabilities: [],
    }
    try {
      const host = new SeedPluginHost({
        configuration: () => ({ type: 'configure', appVersion: '1.0.0', locale: 'en-US', backupRoot: join(directory, 'backups'), pluginDataRoot: join(directory, 'data'), plugins: [] }),
        invoke_host: invokeHost,
      }, undefined, contributionsChanged)
      expect(await host.start([nativePlugin])).toEqual([])
      expect(invokeHost).toHaveBeenCalledTimes(1)
      expect(contributionsChanged).toHaveBeenCalledWith(nativePlugin.package_id, expect.objectContaining({ configurations: [expect.objectContaining({ id: 'service' })] }))
      await host.stop()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('routes generic dynamic options only through the owning plugin resolver', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-native-plugin-options-'))
    const entryPath = join(directory, 'runtime.mjs')
    await writeFile(entryPath, [
      "const text = { en_US: 'Source', zh_Hans: '来源' }",
      'export async function apply(context) {',
      "  context.effect(() => context.configuration.register({ id: 'source', schema_version: 1, renderer: 'seed.profiles', title: text, description: text, fields: [], profiles: { id_prefix: 'source', min_items: 1, max_items: 2, default_required: true, summary_fields: ['value'], fields: [{ key: 'kind', type: 'text', label: text }, { key: 'value', type: 'text', label: text, dynamic_options: { depends_on: ['kind'] } }], actions: { save: { label: text } } } }))",
      "  context.effect(() => context.configuration.registerOptionsResolver('source', 'value', (values) => [{ value: `${values.kind}-one` }, { value: `${values.kind}-one` }, { value: 'two', label: 'Second', icon_data_url: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', icon_dark_data_url: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', badges: [{ prefix: 'x', label: '1.00', suffix: '→ x0.50', tone: 'info', strikethrough: true }] }, { value: 'invalid-icon', icon_data_url: 'file:///tmp/logo.svg' }]))",
      '}',
    ].join('\n'))
    const nativePlugin: SeedPluginRuntimeDefinition = {
      ...plugin,
      package_id: 'com.motusai.seed.dynamic-options',
      runtime_kind: 'native-host',
      entry_path: entryPath,
      capabilities: [],
    }
    const host = new SeedPluginHost({
      configuration: () => ({
        type: 'configure', appVersion: '1.0.0', locale: 'en-US',
        backupRoot: join(directory, 'backups'), pluginDataRoot: join(directory, 'data'), plugins: [],
      }),
      invoke_host: vi.fn(),
    })
    try {
      await host.start([nativePlugin])
      await expect(host.resolveConfigurationOptions(nativePlugin.package_id, 'source', 'value', { id: 'source-1', kind: 'remote', value: '' })).resolves.toEqual([
        { value: 'remote-one', label: 'remote-one' },
        { value: 'two', label: 'Second', iconDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', iconDarkDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', badges: [{ prefix: 'x', label: '1.00', suffix: '→ x0.50', tone: 'info', strikethrough: true }] },
        { value: 'invalid-icon', label: 'invalid-icon' },
      ])
      await expect(host.resolveConfigurationOptions(nativePlugin.package_id, 'source', 'value', { unknown: 'value' })).rejects.toThrow('未声明字段')
    } finally {
      await host.stop()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('restarts annotation-matched native consumers when a matching provider changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-native-plugin-dependency-'))
    const dataRoot = join(directory, 'plugin-data')
    const entryPath = join(directory, 'runtime.mjs')
    const lifecyclePath = join(directory, 'lifecycle.txt')
    await writeFile(entryPath, [
      "import { appendFile } from 'node:fs/promises'",
      `const lifecyclePath = ${JSON.stringify(lifecyclePath)}`,
      "export async function apply(context) { await appendFile(lifecyclePath, 'start\\n')",
      "  context.effect(() => context.capabilities.register('native_consumer', { invoke: async () => ({ ok: true }) }))",
      "  context.effect(() => () => appendFile(lifecyclePath, 'stop\\n'))",
      '}',
    ].join('\n'))
    const consumer: SeedPluginRuntimeDefinition = {
      ...plugin,
      package_id: 'com.motusai.seed.native-consumer',
      publisher_type: 'official',
      runtime_kind: 'native-host',
      entry_path: entryPath,
      consumes: [{ match: { method_annotation: 'agent.tool', equals: true } }],
      capabilities: [{ id: 'native_consumer', version: 1, methods: [{ name: 'status', risk: 'read' }] }],
    }
    const toolProvider: SeedPluginRuntimeDefinition = {
      ...plugin,
      capabilities: [{
        ...plugin.capabilities[0]!,
        methods: [{ ...plugin.capabilities[0]!.methods[0]!, annotations: { 'agent.tool': true } }],
      }],
    }
    try {
      const host = new SeedPluginHost({
        configuration: () => ({
          type: 'configure', appVersion: '1.0.0', locale: 'en-US',
          backupRoot: join(directory, 'backups'), pluginDataRoot: dataRoot, plugins: [],
        }),
        invoke_host: vi.fn(),
      })
      await host.start([consumer])
      await host.start([toolProvider, consumer])
      expect(await readFile(lifecyclePath, 'utf8')).toBe('start\nstop\nstart\n')
      await host.stop()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('brokers only declared plugin capabilities and records the provider call', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-capability-consumer-'))
    const dataRoot = join(directory, 'plugin-data')
    const entryPath = join(directory, 'consumer.mjs')
    await writeFile(entryPath, [
      "import { writeFile } from 'node:fs/promises'",
      "import { join } from 'node:path'",
      'export async function apply(context) {',
      '  const available = await context.capabilities.list()',
      "  const result = await context.capabilities.invoke({ capability: 'probe', method: 'echo', arguments: { value: 'through-broker' }, request_id: 'broker-request-1' })",
      "  await writeFile(join(context.package.data_path, 'broker.json'), JSON.stringify({ available, result }))",
      "  context.effect(() => context.capabilities.register('consumer_probe', { invoke: async () => null }))",
      '}',
    ].join('\n'))
    try {
      const invokeHost = vi.fn(async (service: string, argumentsValue: Record<string, unknown>) => {
        if (service === 'seed.plugin.invoke') return (argumentsValue.invocation as { arguments: unknown }).arguments
        if (service === 'seed.plugin.audit') return { recorded: true }
        throw new Error(`Unexpected service: ${service}`)
      })
      const consumer: SeedPluginRuntimeDefinition = {
        ...plugin,
        package_id: 'com.example.consumer',
        runtime_kind: 'native-host',
        entry_path: entryPath,
        consumes: [{ capability: 'probe', methods: ['echo'] }],
        capabilities: [{ id: 'consumer_probe', version: 1, exposure: 'local', methods: [{ name: 'noop', risk: 'read' }] }],
      }
      const activityListener = vi.fn()
      const host = new SeedPluginHost(
        {
          configuration: () => ({
            type: 'configure', appVersion: '1.0.0', locale: 'en-US',
            backupRoot: join(directory, 'backups'), pluginDataRoot: dataRoot, plugins: [],
          }),
          invoke_host: invokeHost,
        },
        new GlobalTaskActivityObserver(activityListener),
      )
      const provider = { ...plugin, capabilities: plugin.capabilities.map((capability) => ({ ...capability, exposure: 'plugin' as const })) }
      await host.start([provider, consumer])
      const stored = JSON.parse(await readFile(join(dataRoot, consumer.package_id, 'broker.json'), 'utf8'))
      expect(stored.result).toEqual({ value: 'through-broker' })
      expect(stored.available).toEqual([expect.objectContaining({
        id: 'probe',
        provider_plugin_id: plugin.package_id,
        provider_plugin: {
          plugin_id: plugin.package_id,
          name: 'Schema',
          icon_data_url: plugin.icon_data_url,
        },
      })])
      expect(invokeHost).toHaveBeenCalledWith('seed.plugin.audit', expect.objectContaining({
        package_id: consumer.package_id,
        entry: expect.objectContaining({ operation: 'capability.probe.echo', outcome: 'allowed' }),
      }))
      expect(invokeHost).toHaveBeenCalledWith('seed.plugin.invoke', expect.objectContaining({
        invocation: expect.objectContaining({ principal: { kind: 'plugin', plugin_id: consumer.package_id } }),
      }))
      expect(activityListener.mock.calls.map(([event]) => event)).toEqual([
        { type: 'task.changed', requestId: 'broker-request-1', taskId: 'broker-request-1', phase: 'started', operation: 'probe.echo' },
        { type: 'task.changed', requestId: 'broker-request-1', taskId: 'broker-request-1', phase: 'completed', operation: 'probe.echo' },
      ])
      await host.stop()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('discovers interchangeable providers and requires an exact provider when their contracts overlap', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-multiple-providers-'))
    const dataRoot = join(directory, 'plugin-data')
    const entryPath = join(directory, 'consumer.mjs')
    await writeFile(entryPath, [
      "import { writeFile } from 'node:fs/promises'",
      "import { join } from 'node:path'",
      'export async function apply(context) {',
      '  const available = await context.capabilities.list()',
      "  let ambiguous = ''",
      "  try { await context.capabilities.invoke({ capability: 'agent_sessions', method: 'sessions.open', arguments: {} }) } catch (error) { ambiguous = error.code || error.message }",
      "  const selected = await context.capabilities.invoke({ provider_plugin_id: 'com.example.cloud-agent', capability: 'agent_sessions', method: 'sessions.open', arguments: {} })",
      "  let unavailable = ''",
      "  try { await context.capabilities.invoke({ provider_plugin_id: 'com.example.missing-agent', capability: 'agent_sessions', method: 'sessions.open', arguments: {} }) } catch (error) { unavailable = error.code || error.message }",
      "  await writeFile(join(context.package.data_path, 'providers.json'), JSON.stringify({ available, ambiguous, selected, unavailable }))",
      "  context.effect(() => context.capabilities.register('consumer_probe', { invoke: async () => null }))",
      '}',
    ].join('\n'))
    const agentCapability = {
      id: 'agent_sessions', version: 1, exposure: 'plugin' as const,
      methods: [{ name: 'sessions.open', risk: 'read' as const }],
    }
    const localProvider: SeedPluginRuntimeDefinition = {
      ...plugin, package_id: 'com.example.local-agent', capabilities: [agentCapability],
    }
    const cloudProvider: SeedPluginRuntimeDefinition = {
      ...plugin, package_id: 'com.example.cloud-agent', capabilities: [agentCapability],
    }
    const consumer: SeedPluginRuntimeDefinition = {
      ...plugin,
      package_id: 'com.example.connector',
      publisher_type: 'official',
      runtime_kind: 'native-host',
      entry_path: entryPath,
      consumes: [{ capability: 'agent_sessions', methods: ['sessions.open'] }],
      capabilities: [{ id: 'consumer_probe', version: 1, exposure: 'local', methods: [{ name: 'noop', risk: 'read' }] }],
    }
    try {
      const invokeHost = vi.fn(async (service: string, argumentsValue: Record<string, unknown>) => {
        if (service === 'seed.plugin.invoke') return { provider_plugin_id: argumentsValue.package_id }
        if (service === 'seed.plugin.audit') return { recorded: true }
        throw new Error(`Unexpected service: ${service}`)
      })
      const host = new SeedPluginHost({
        configuration: () => ({
          type: 'configure', appVersion: '1.0.0', locale: 'en-US',
          backupRoot: join(directory, 'backups'), pluginDataRoot: dataRoot, plugins: [],
        }),
        invoke_host: invokeHost,
      })
      expect(await host.start([localProvider, cloudProvider, consumer])).toEqual([])
      const stored = JSON.parse(await readFile(join(dataRoot, consumer.package_id, 'providers.json'), 'utf8'))
      expect(stored.available.map((item: { provider_plugin_id: string }) => item.provider_plugin_id)).toEqual([
        localProvider.package_id,
        cloudProvider.package_id,
      ])
      expect(stored.ambiguous).toBe('capability_provider_required')
      expect(stored.selected).toEqual({ provider_plugin_id: cloudProvider.package_id })
      expect(stored.unavailable).toBe('capability_provider_unavailable')
      await host.stop()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects duplicate plugin ids before mounting runtimes', async () => {
    const host = new SeedPluginHost({ configuration: () => null, invoke_host: vi.fn() })
    await expect(host.start([plugin, { ...plugin }])).rejects.toMatchObject({ code: 'duplicate_plugin_id' })
  })

  it('lets a declared plugin consumer discover terminal capabilities selected by a generic annotation matcher', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seed-capability-selector-'))
    const dataRoot = join(directory, 'plugin-data')
    const entryPath = join(directory, 'consumer.mjs')
    await writeFile(entryPath, [
      "import { writeFile } from 'node:fs/promises'",
      "import { join } from 'node:path'",
      'export async function apply(context) {',
      '  const available = await context.capabilities.list()',
      "  const result = await context.capabilities.invoke({ capability: 'probe', method: 'echo', arguments: { value: 'selected' }, request_id: 'selector-1' })",
      "  let rejected = ''",
      "  try { await context.capabilities.invoke({ capability: 'probe', method: 'internal', arguments: {}, request_id: 'selector-2' }) } catch (error) { rejected = error.code || error.message }",
      "  await writeFile(join(context.package.data_path, 'selector.json'), JSON.stringify({ available, result, rejected }))",
      "  context.effect(() => context.capabilities.register('consumer_probe', { invoke: async () => null }))",
      '}',
    ].join('\n'))
    const provider: SeedPluginRuntimeDefinition = {
      ...plugin,
      capabilities: [{
        ...plugin.capabilities[0]!,
        exposure: 'terminal',
        methods: [
          { ...plugin.capabilities[0]!.methods[0]!, annotations: { 'agent.tool': true } },
          { name: 'internal', risk: 'read' },
        ],
      }],
    }
    const consumer: SeedPluginRuntimeDefinition = {
      ...plugin,
      package_id: 'com.example.selector-consumer',
      publisher_type: 'official',
      runtime_kind: 'native-host',
      entry_path: entryPath,
      consumes: [{ match: { method_annotation: 'agent.tool', equals: true } }],
      capabilities: [{ id: 'consumer_probe', version: 1, exposure: 'local', methods: [{ name: 'noop', risk: 'read' }] }],
    }
    try {
      const invokeHost = vi.fn(async (service: string, argumentsValue: Record<string, unknown>) => {
        if (service === 'seed.plugin.invoke') return (argumentsValue.invocation as { arguments: unknown }).arguments
        if (service === 'seed.plugin.audit') return { recorded: true }
        throw new Error(`Unexpected service: ${service}`)
      })
      const host = new SeedPluginHost({
        configuration: () => ({
          type: 'configure', appVersion: '1.0.0', locale: 'en-US',
          backupRoot: join(directory, 'backups'), pluginDataRoot: dataRoot, plugins: [],
        }),
        invoke_host: invokeHost,
      })
      await host.start([provider, consumer])
      const stored = JSON.parse(await readFile(join(dataRoot, consumer.package_id, 'selector.json'), 'utf8'))
      expect(stored.available).toEqual([expect.objectContaining({
        id: 'probe',
        methods: [expect.objectContaining({ name: 'echo', annotations: { 'agent.tool': true } })],
      })])
      expect(stored.result).toEqual({ value: 'selected' })
      expect(stored.rejected).toBe('capability_not_declared')
      await host.stop()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('requires one-time approval for write and control capability calls', async () => {
    const writeProvider: SeedPluginRuntimeDefinition = {
      ...plugin,
      capabilities: [{ id: 'probe', version: 1, exposure: 'terminal', methods: [{ name: 'change', risk: 'write' }] }],
    }
    const consumer: SeedPluginRuntimeDefinition = {
      ...plugin,
      package_id: 'com.example.consumer',
      consumes: [{ capability: 'probe', methods: ['change'] }],
      capabilities: [{ id: 'consumer_probe', version: 1, exposure: 'local', methods: [{ name: 'noop', risk: 'read' }] }],
    }
    const invokeHost = vi.fn(async (service: string) => {
      if (service === 'seed.plugin-capability.approve') return { allowed: false }
      if (service === 'seed.plugin.audit') return { recorded: true }
      throw new Error(`Unexpected service: ${service}`)
    })
    const host = new SeedPluginHost({ configuration: () => null, invoke_host: invokeHost })
    await host.start([writeProvider, consumer])
    const broker = (host as unknown as { invokeConsumedCapability: Function }).invokeConsumedCapability.bind(host)
    await expect(broker(consumer, { capability: 'probe', method: 'change', arguments: {} }))
      .rejects.toMatchObject({ code: 'plugin_capability_denied' })
    expect(invokeHost).toHaveBeenCalledWith('seed.plugin-capability.approve', expect.objectContaining({
      risk: 'write',
      capability_version: 1,
      arguments_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(invokeHost).not.toHaveBeenCalledWith('seed.plugin.invoke', expect.anything())
  })

  it('keeps local capabilities unavailable to other plugins even when consumes matches', async () => {
    const localProvider: SeedPluginRuntimeDefinition = {
      ...plugin,
      capabilities: [{ id: 'local_probe', version: 1, exposure: 'local', methods: [{ name: 'read', risk: 'read', annotations: { 'agent.tool': true } }] }],
    }
    const consumer: SeedPluginRuntimeDefinition = {
      ...plugin,
      package_id: 'com.example.consumer',
      consumes: [{ match: { method_annotation: 'agent.tool', equals: true } }],
      capabilities: [{ id: 'consumer_probe', version: 1, exposure: 'local', methods: [{ name: 'noop', risk: 'read' }] }],
    }
    const host = new SeedPluginHost({ configuration: () => null, invoke_host: vi.fn() })
    await host.start([localProvider, consumer])
    const broker = (host as unknown as { invokeConsumedCapability: Function }).invokeConsumedCapability.bind(host)
    expect((host as unknown as { consumedCapabilities(value: SeedPluginRuntimeDefinition): unknown[] }).consumedCapabilities(consumer)).toEqual([])
    await expect(broker(consumer, { capability: 'local_probe', method: 'read', arguments: {} }))
      .rejects.toMatchObject({ code: 'capability_unavailable' })
    await host.stop()
  })

  it('keeps healthy capabilities available when a native-host plugin fails to load', async () => {
    const invokeHost = vi.fn(async () => ({ value: 'local' }))
    const host = new SeedPluginHost({ configuration: () => null, invoke_host: invokeHost })
    const failures = await host.start([{
      ...plugin,
      package_id: 'com.motusai.seed.broken-native',
      publisher_type: 'official',
      runtime_kind: 'native-host',
      entry_path: '/missing/seed-plugin-runtime.mjs',
      capabilities: [{ id: 'broken_native', version: 1, methods: [{ name: 'echo', risk: 'read' }] }],
    }, plugin])

    expect(failures).toEqual([expect.objectContaining({ packageId: 'com.motusai.seed.broken-native' })])
    expect(host.supports('broken_native', 'echo')).toBe(false)
    expect(host.supports('probe', 'echo')).toBe(true)
    await expect(host.invoke('probe', 'echo', { request_id: 'healthy-1', arguments: { value: 'healthy' } })).resolves.toEqual({ value: 'local' })
  })
})
