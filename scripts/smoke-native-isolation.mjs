import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { NativePluginManager } from '../dist/electron/main/native-plugin-manager.js'
import { SeedPluginHost } from '../dist/electron/connector/plugin-host.js'

const root = await mkdtemp(join(tmpdir(), 'seed-native-isolation-'))
app.setPath('userData', root)
const watchdog = setTimeout(() => {
  process.stderr.write('Native isolation smoke timed out.\n')
  process.exit(2)
}, 30_000)

function runtime(name, entryPath) {
  return {
    package_id: `com.example.${name}`, version: '1.0.0', name: { en_US: name, zh_Hans: name },
    publisher_type: 'official', runtime_kind: 'native-host', root_path: join(root, name), entry_path: entryPath,
    sidecars: [], permissions: name === 'one' ? ['local.http-api', 'network.connect.loopback'] : [],
    consumes: name === 'one' ? [{ capability: 'probe_two', methods: ['echo'] }] : [],
    capabilities: [{ id: `probe_${name}`, version: 1, exposure: 'terminal',
      methods: [{ name: 'echo', risk: 'read' }, { name: 'crash', risk: 'read' },
        ...(name === 'one' ? [{ name: 'delegate', risk: 'read' }] : [])] }],
  }
}

function invocation(id, argumentsValue = {}) { return { request_id: id, arguments: argumentsValue } }

app.whenReady().then(async () => {
  let manager
  let router
  let failed = false
  try {
    const entries = []
    for (const name of ['one', 'two']) {
      const directory = join(root, name)
      await mkdir(directory, { recursive: true })
      const entry = join(directory, 'index.mjs')
      const contributions = name === 'one' ? `
        const text = { en_US: 'Source', zh_Hans: '来源' }
        ctx.configuration.register({ id: 'source', schema_version: 1, renderer: 'seed.profiles', title: text, description: text,
          fields: [], profiles: { id_prefix: 'source', min_items: 1, max_items: 2, default_required: true,
            summary_fields: ['value'], status: { source: 'connections' },
            fields: [{ key: 'kind', type: 'text', label: text },
              { key: 'value', type: 'text', label: text, dynamic_options: { depends_on: ['kind'] } }],
            actions: { save: { label: text } } } })
        ctx.configuration.registerOptionsResolver('source', 'value', (values) => [{ value: values.kind + '-one' }])
        ctx.localApi.register({ allowed_origins: ['app://test'], allowed_client_ids: ['com.example.client'],
          routes: [{ method: 'GET', path: '/events', public: true }],
          handle: () => new Response(new ReadableStream({ start(controller) {
            controller.enqueue(new TextEncoder().encode('data: ready\\n\\n'))
            controller.close()
          } }), { headers: { 'content-type': 'text/event-stream' } }) })
        const connection = ctx.connections.register({ id: 'primary', transport: 'websocket',
          permission: 'network.connect.loopback', profile: { configuration_id: 'source', profile_id: 'source-1' },
          close() {}, reconnect() {} })
        connection.update({ state: 'connected' })
      ` : ''
      await writeFile(entry, `export function apply(ctx) {
        ctx.effect(() => ctx.capabilities.register('probe_${name}', {
          invoke: async (method, request) => {
            if (method === 'crash') process.exit(7)
            if (method === 'delegate') return await ctx.capabilities.invoke({ capability: 'probe_two', method: 'echo', arguments: request.arguments })
            return request.arguments
          },
        }))
        ${contributions}
      }`)
      entries.push(runtime(name, entry))
    }
    const snapshots = []
    manager = new NativePluginManager('Seed Smoke', async (packageId, service, args) => {
      if (service === 'seed.native.capabilities.list') return router.consumedCapabilitiesByPackage(packageId)
      if (service === 'seed.native.capabilities.invoke') return router.invokeConsumedByPackage(packageId, args.invocation, args.chain)
      return undefined
    },
      (packageId, snapshot) => {
        snapshots.push(`${packageId}:${snapshot ? 'ready' : 'gone'}`)
        router?.applyRemoteSnapshot(packageId, snapshot)
      },
      () => undefined, () => undefined, () => undefined)
    const configuration = { type: 'configure', serverUrl: 'https://example.test', terminalId: 'test', token: 'not-for-child',
      grants: [], appVersion: '0.0.0', locale: 'en-US', backupRoot: join(root, 'backups'),
      pluginDataRoot: join(root, 'data'), plugins: entries }
    const [firstSnapshot] = await Promise.all(entries.map((plugin) => manager.start(plugin, configuration)))
    router = new SeedPluginHost({ configuration: () => configuration,
      invoke_host: async (service, args) => {
        const packageId = args.package_id
        if (service === 'seed.native.start') return manager.start(args.plugin, args.configuration)
        if (service === 'seed.native.stop') return manager.stop(packageId)
        if (service === 'seed.native.invoke') return manager.call(packageId, { type: 'invoke',
          capability: args.capability, method: args.method, invocation: args.invocation, chain: args.chain }, args.invocation.request_id)
        if (service === 'seed.native.cancel') return manager.cancel(packageId, args.request_id)
        if (service === 'seed.plugin.diagnostic' || service === 'seed.plugin.audit') return undefined
        throw new Error(`Unexpected routing service: ${service}`)
      } }, undefined, undefined, 'remote')
    const failures = await router.start(entries)
    if (failures.length) throw new Error(`Router startup failed: ${JSON.stringify(failures)}`)
    const delegated = await router.invoke('probe_one', 'delegate', { request_id: 'delegated',
      arguments: { cross_process: true } })
    if (delegated?.cross_process !== true) throw new Error('Cross-plugin capability routing failed.')
    if (firstSnapshot.configurations[0]?.id !== 'source' || firstSnapshot.connections[0]?.state !== 'connected'
      || firstSnapshot.localApi?.routes[0]?.path !== '/events') throw new Error('Native runtime contributions were not transferred.')
    const options = await manager.call(entries[0].package_id, { type: 'configuration-options',
      configuration_id: 'source', field_key: 'value', values: { id: 'source-1', kind: 'remote', value: '' } })
    if (options?.[0]?.value !== 'remote-one') throw new Error('Configuration option RPC failed.')
    await manager.call(entries[0].package_id, { type: 'reconnect', configuration_id: 'source', profile_id: 'source-1' })
    const local = await manager.call(entries[0].package_id, { type: 'local-api', url: 'http://127.0.0.1/events',
      method: 'GET', headers: [], client: null })
    if (!local?.stream_id || local.status !== 200) throw new Error('Local API stream did not open.')
    const chunk = await manager.call(entries[0].package_id, { type: 'local-api-read', stream_id: local.stream_id })
    if (new TextDecoder().decode(chunk?.chunk) !== 'data: ready\n\n') throw new Error('Local API stream chunk was lost.')
    const end = await manager.call(entries[0].package_id, { type: 'local-api-read', stream_id: local.stream_id })
    if (!end?.done) throw new Error('Local API stream did not close.')
    const result = await manager.call(entries[1].package_id, { type: 'invoke', capability: 'probe_two', method: 'echo',
      invocation: invocation('healthy-before', { ok: true }), chain: [] })
    if (result?.ok !== true) throw new Error('Second plugin did not answer before crash.')
    await manager.call(entries[0].package_id, { type: 'invoke', capability: 'probe_one', method: 'crash',
      invocation: invocation('crash'), chain: [] }).then(() => { throw new Error('Crashed plugin unexpectedly returned.') }, () => undefined)
    if (router.supports('probe_one', 'echo') || !router.supports('probe_two', 'echo')) {
      throw new Error('Router did not remove only the crashed plugin.')
    }
    const readyBeforeRestart = snapshots.filter((value) => value === 'com.example.one:ready').length
    const after = await manager.call(entries[1].package_id, { type: 'invoke', capability: 'probe_two', method: 'echo',
      invocation: invocation('healthy-after', { ok: true }), chain: [] })
    if (after?.ok !== true) throw new Error('Second plugin stopped after first plugin crashed.')
    const deadline = Date.now() + 5_000
    while (snapshots.filter((value) => value === 'com.example.one:ready').length <= readyBeforeRestart && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!snapshots.includes('com.example.one:gone') || snapshots.filter((value) => value === 'com.example.one:ready').length <= readyBeforeRestart) {
      throw new Error(`Native restart was not observed: ${snapshots.join(', ')}`)
    }
    if (!router.supports('probe_one', 'echo') || !router.supports('probe_two', 'echo')) {
      throw new Error('Router did not recover the crashed plugin while retaining the healthy one.')
    }
    process.stdout.write('Independent native processes, crash isolation, and restart passed.\n')
  } catch (error) {
    failed = true
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  } finally {
    try { if (router) await router.stop() }
    catch (error) { failed = true; process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`) }
    try { if (manager) await manager.stopAll() }
    catch (error) { failed = true; process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`) }
    try { await rm(root, { recursive: true, force: true }) }
    catch (error) { failed = true; process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`) }
    clearTimeout(watchdog)
    app.exit(failed ? 1 : 0)
  }
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exit(1)
})
