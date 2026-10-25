import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityDefinition } from '@motus-ai/seed-sdk';
import type { SeedPluginRuntimeDefinition, WorkerCommand } from '../shared/contracts';
import { SeedPluginHost } from './plugin-host';
import { GlobalTaskActivityObserver } from './global-task-activity-observer';
import { capabilityProtocolDescriptor } from '../shared/plugin-capability';

const roots: string[] = [],
  hosts: SeedPluginHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const schema = {
  type: 'object',
  properties: { value: { type: 'string' } },
  required: ['value'],
  additionalProperties: false,
};
const capability = (id = 'probe', risk: 'read' | 'write' | 'control' = 'read'): CapabilityDefinition => ({
  id,
  version: 1,
  methods: [{ name: 'echo', risk, inputSchema: schema, outputSchema: schema }],
});
async function fixture(
  id = 'probe',
  setup?: string,
  definitions = [capability(id)],
  extra: Partial<SeedPluginRuntimeDefinition> = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'seed-class-runtime-'));
  roots.push(root);
  const manifest = {
    id: 'com.example.' + id,
    name: id,
    version: '1.0.0',
    minAppVersion: '0.2.15',
    description: id,
    author: 'Example',
  };
  await writeFile(
    join(root, 'main.mjs'),
    `export const seedPluginBundleVersion = 2;
export function loadService(modules) {
  const { PluginService, SeedPluginError } = modules['@motus-ai/seed-sdk'];
  const definitions = ${JSON.stringify(definitions)};
  return class extends PluginService { async onload() {
    ${setup ?? 'this.addCapability(definitions[0], { invoke: async (_method, request) => request.arguments });'}
  } };
}
export function loadView(modules) { return class extends modules['@motus-ai/seed-sdk'].Plugin {}; }`,
  );
  return {
    api_version: 2,
    has_service: true,
    resources: ['main.mjs'],
    sdk_manifest: manifest,
    package_id: manifest.id,
    version: manifest.version,
    publisher_type: 'official',
    runtime_kind: 'native-host',
    root_path: root,
    entry_path: join(root, 'main.mjs'),
    sidecars: [],
    permissions: [],
    consumes: [],
    capabilities: [],
    ...extra,
  } as SeedPluginRuntimeDefinition;
}
function runtime(
  invoke = vi.fn(async (_service: string, _args: Record<string, unknown>): Promise<unknown> => null),
  observer?: GlobalTaskActivityObserver,
  billing = false,
  diagnostic?: (event: import('../shared/diagnostic-trace').HostDiagnosticEvent) => void,
) {
  const configuration: Extract<WorkerCommand, { type: 'configure' }> = {
    type: 'configure',
    appVersion: '0.2.15',
    locale: 'en-US',
    backupRoot: '/tmp/seed-fixture-backups',
    pluginDataRoot: roots[0] ?? '/tmp',
    plugins: [],
  };
  const host = new SeedPluginHost(
    { configuration: () => configuration, invoke_host: invoke },
    observer,
    'local',
    undefined,
    billing,
    diagnostic,
  );
  hosts.push(host);
  return { host, invoke };
}
const request = (value: unknown = 'ok') => ({ request_id: crypto.randomUUID(), arguments: { value } });

async function routedRuntime(plugins: SeedPluginRuntimeDefinition[], broker: (service: string, args: any) => Promise<unknown>) {
  const locals = new Map<string, SeedPluginHost>();
  let central!: SeedPluginHost;
  for (const plugin of plugins) {
    const local = new SeedPluginHost({
      configuration: () => ({ locale: 'en-US', pluginDataRoot: roots[0], plugins: [plugin] }) as never,
      invoke_host: async (service, args) => {
        if (service === 'seed.capabilities.invoke') return central.invokeConsumedByPackage(plugin.package_id, args.invocation as never, args.chain as string[], args.invocation_scope_id as string | undefined);
        if (service === 'seed.capabilities.list') return central.consumedCapabilitiesByPackage(plugin.package_id);
        return broker(service, args);
      },
    }, undefined, 'local', () => {});
    hosts.push(local);
    await local.start([plugin]);
    locals.set(plugin.package_id, local);
  }
  central = new SeedPluginHost({ configuration: () => ({ plugins }) as never, invoke_host: async (service, args) => {
    const local = locals.get(String(args.package_id));
    if (service === 'seed.native.start') return local!.runtimeSnapshot(String(args.package_id));
    if (service === 'seed.native.invoke') return local!.invokeNativeWithChain(String(args.capability), String(args.method), args.invocation as never, args.chain as string[], args.trace as never, args.invocation_scope_id as string | undefined);
    if (service === 'seed.native.stop') return null;
    return broker(service, args);
  } }, undefined, 'remote');
  hosts.push(central);
  await central.start(plugins);
  return central;
}

describe('class-only service lifecycle', () => {
  it('correlates capture with the actual invocation task and ignores plugin-authored activity IDs', async () => {
    const plugin = await fixture('capture', `
      const capture = () => this.app.invokeHost('seed.audio', { operation: 'capture.stop', activity_task_id: 'spoofed' });
      this.addCapability(definitions[0], { invoke: async (_method, request) => { await capture(); return request.arguments; } });
      this.registerMethod('capture', capture);
    `);
    const { host, invoke } = runtime();
    await host.start([plugin]);
    await host.invoke('capture', 'echo', { ...request(), context: { task_id: 'actual-task' } });
    expect(invoke).toHaveBeenCalledWith('seed.audio', expect.objectContaining({ activity_task_id: 'actual-task' }));
    await host.callService(plugin.package_id, 'capture', {});
    expect(invoke).toHaveBeenLastCalledWith('seed.audio', expect.objectContaining({ activity_task_id: undefined }));
  });

  it('does not falsely mark sandbox downstream billing as complete when async attribution is unavailable', async () => {
    const browser = await fixture('browser', '', [], {
      runtime_kind: 'sandboxed-web',
      consumes: [{ capability: 'probe', methods: ['echo'] }],
      capabilities: [capabilityProtocolDescriptor(capability('browser'))],
    });
    const { host } = runtime(vi.fn(async () => ({ value: 'ok' })));
    await host.start([browser]);
    expect(await host.withBillingReceipt(() => host.invoke('browser', 'echo', request()))).toEqual({
      result: { value: 'ok' },
      billing: { version: 1, complete: false, charges: [] },
    });
  });
  it('allows an authorized consumer to discover ready providers during its own initialization', async () => {
    const provider = await fixture('provider'),
      consumer = await fixture('consumer', '', [], { consumes: [{ capability: 'provider', methods: ['echo'] }] });
    const { host } = runtime();
    Reflect.get(host, 'runtime').configuration().plugins = [provider, consumer];
    await host.start([provider]);
    expect(host.consumedCapabilitiesByPackage(consumer.package_id).map((item) => item.id)).toEqual(['provider']);
    await expect(
      host.invokeConsumedByPackage(
        consumer.package_id,
        { capability: 'provider', method: 'echo', arguments: { value: 'ready' } },
        [],
      ),
    ).resolves.toEqual({ value: 'ready' });
  });
  it('keeps independent concurrent requests separate from genuine cross-process call cycles', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const a = await fixture('a', undefined, [capability('a')], { consumes: [{ capability: 'b', methods: ['echo'] }] });
    const b = await fixture(
      'b',
      "this.addCapability(definitions[0], { invoke: async (_method, request) => { await this.app.invokeHost('probe.wait', {}); return request.arguments; } });",
      [capability('b')],
      { consumes: [{ capability: 'a', methods: ['echo'] }] },
    );
    const broker = vi.fn(async (service: string, _args: any) => {
      if (service === 'probe.wait') await gate;
      return null;
    });
    const host = await routedRuntime([a, b], broker);
    const pending = host.invokeConsumedByPackage(
      a.package_id,
      { capability: 'b', method: 'echo', arguments: { value: 'ok' } },
      [],
    );
    await vi.waitFor(() => expect(broker).toHaveBeenCalledWith('probe.wait', expect.any(Object)));
    await expect(
      host.invokeConsumedByPackage(b.package_id, { capability: 'a', method: 'echo', arguments: { value: 'ok' } }, []),
    ).resolves.toEqual({ value: 'ok' });
    release();
    expect(await pending).toEqual({ value: 'ok' });
    expect(
      await host.invokeConsumedByPackage(
        b.package_id,
        { capability: 'a', method: 'echo', arguments: { value: 'ok' } },
        [],
      ),
    ).toEqual({ value: 'ok' });
  });

  it('blocks an awaited cross-process A -> B -> A call and audits the rejection', async () => {
    const a = await fixture('a', undefined, [capability('a')], { consumes: [{ capability: 'b', methods: ['echo'] }] });
    const b = await fixture('b', `this.addCapability(definitions[0], { invoke: async (_method, request) => this.app.capabilities.invoke({ capability: 'a', method: 'echo', arguments: request.arguments }) });`, [capability('b')], { consumes: [{ capability: 'a', methods: ['echo'] }] });
    const audit = vi.fn(async (_service: string, _args: any): Promise<unknown> => null);
    const host = await routedRuntime([a, b], audit);
    await expect(host.invokeConsumedByPackage(a.package_id, { capability: 'b', method: 'echo', arguments: { value: 'cycle' } }, [])).rejects.toMatchObject({ code: 'capability_cycle' });
    expect(audit.mock.calls.some(([service, args]) => service === 'seed.plugin.audit' && args.entry.outcome === 'denied' && args.entry.error_code === 'capability_cycle')).toBe(true);
  });

  it('expires returned invocation ancestry for background work while a separate progress read is pending', async () => {
    let releaseBackground!: () => void, releaseProgress!: () => void;
    const background = new Promise<void>((resolve) => { releaseBackground = resolve; });
    const progress = new Promise<void>((resolve) => { releaseProgress = resolve; });
    const a = await fixture('a', undefined, [capability('a')], { consumes: [{ capability: 'b', methods: ['echo'] }] });
    const b = await fixture('b', `this.addCapability(definitions[0], { invoke: async (_method, request) => {
      if (request.arguments.value === 'start') {
        void (async () => { await this.app.invokeHost('probe.background', {});
          try { const result = await this.app.capabilities.invoke({ capability: 'a', method: 'echo', arguments: { value: 'background result' } }); await this.app.invokeHost('probe.result', { result }); }
          catch (error) { await this.app.invokeHost('probe.error', { message: String(error) }); }
        })();
        return { value: 'accepted' };
      }
      await this.app.invokeHost('probe.progress', {}); return { value: 'done' };
    } });`, [capability('b')], { consumes: [{ capability: 'a', methods: ['echo'] }] });
    const broker = vi.fn(async (service: string, _args: any): Promise<unknown> => {
      if (service === 'probe.background') await background;
      if (service === 'probe.progress') await progress;
      return null;
    });
    const host = await routedRuntime([a, b], broker);
    await expect(host.invokeConsumedByPackage(a.package_id, { capability: 'b', method: 'echo', arguments: { value: 'start' } }, [])).resolves.toEqual({ value: 'accepted' });
    const pending = host.invokeConsumedByPackage(a.package_id, { capability: 'b', method: 'echo', arguments: { value: 'progress' }, activity: 'background' }, []);
    try {
      await vi.waitFor(() => expect(broker.mock.calls.some(([service]) => service === 'probe.progress')).toBe(true));
      releaseBackground();
      await vi.waitFor(() => expect(broker).toHaveBeenCalledWith('probe.result', expect.objectContaining({ result: { value: 'background result' } })));
      expect(broker.mock.calls.some(([service]) => service === 'probe.error')).toBe(false);
    } finally { releaseBackground(); releaseProgress(); await pending; }
  });
  it('rejects old exports without executing them', async () => {
    const plugin = await fixture(),
      marker = join(plugin.root_path, 'executed');
    await writeFile(
      plugin.entry_path,
      `import { writeFileSync } from 'node:fs'; export function apply() { writeFileSync(${JSON.stringify(marker)}, 'bad'); }`,
    );
    const { host } = runtime();
    expect(await host.start([plugin])).toEqual([
      expect.objectContaining({ message: 'Invalid Seed plugin bundle v2.' }),
    ]);
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('validates inputs and outputs and withdraws capability routes on unload', async () => {
    const plugin = await fixture(),
      { host } = runtime();
    expect(await host.start([plugin])).toEqual([]);
    expect(await host.invoke('probe', 'echo', request())).toEqual({ value: 'ok' });
    await expect(host.invoke('probe', 'echo', request(1))).rejects.toMatchObject({ code: 'invalid_arguments' });
    await host.stop();
    expect(host.supports('probe', 'echo')).toBe(false);
    const invalid = await fixture(
      'invalid',
      'this.addCapability(definitions[0], { invoke: async () => ({ value: 1 }) });',
    );
    expect(await host.start([invalid])).toEqual([]);
    await expect(host.invoke('invalid', 'echo', request())).rejects.toMatchObject({ code: 'invalid_result' });
  });
  it('cleans failed initialization once without stopping a healthy service', async () => {
    const good = await fixture(),
      bad = await fixture(
        'bad',
        "this.register(() => this.app.invokeHost('fixture.cleanup', {})); this.addCapability(definitions[0], { invoke: async () => ({ value: 'bad' }) }); throw new Error('startup failed');",
      );
    const { host, invoke } = runtime();
    expect(await host.start([good, bad])).toEqual([expect.objectContaining({ message: 'startup failed' })]);
    expect(host.supports('bad', 'echo')).toBe(false);
    expect(await host.invoke('probe', 'echo', request())).toEqual({ value: 'ok' });
    await host.stop();
    expect(invoke.mock.calls.filter(([service]) => service === 'fixture.cleanup')).toHaveLength(1);
  });
  it('preserves unchanged instances while replacing changed generations', async () => {
    const plugin = await fixture(
      'probe',
      "this.registerMethod('identity', () => this.identity ??= crypto.randomUUID()); this.register(() => this.app.invokeHost('fixture.cleanup', {}));",
    );
    const other = await fixture('other'),
      { host, invoke } = runtime();
    await host.start([plugin]);
    const identity = await host.callService(plugin.package_id, 'identity', {});
    await host.start([plugin, other]);
    expect(await host.callService(plugin.package_id, 'identity', {})).toBe(identity);
    await host.start([{ ...plugin, configuration_revision: 'changed' }, other]);
    expect(await host.callService(plugin.package_id, 'identity', {})).not.toBe(identity);
    expect(invoke.mock.calls.filter(([service]) => service === 'fixture.cleanup')).toHaveLength(1);
  });
  it('drains every service and withdraws all routes even when one cleanup fails', async () => {
    const bad = await fixture(
        'bad',
        "this.addCapability(definitions[0], { invoke: async (_method, request) => request.arguments }); this.register(() => { throw new Error('cleanup failed'); });",
      ),
      good = await fixture(
        'good',
        "this.addCapability(definitions[0], { invoke: async (_method, request) => request.arguments }); this.register(() => this.app.invokeHost('fixture.cleanup', {}));",
      );
    const { host, invoke } = runtime();
    await host.start([bad, good]);
    await expect(host.stop()).rejects.toThrow('Plugin cleanup failed');
    expect(host.supports('bad', 'echo')).toBe(false);
    expect(host.supports('good', 'echo')).toBe(false);
    expect(invoke.mock.calls.filter(([service]) => service === 'fixture.cleanup')).toHaveLength(1);
    await expect(host.stop()).resolves.toBeUndefined();
  });
  it('rejects duplicate plugin identities before startup', async () => {
    const plugin = await fixture(),
      { host } = runtime();
    await expect(host.start([plugin, plugin])).rejects.toMatchObject({ code: 'duplicate_plugin_id' });
  });
  it('isolates private RPC by plugin and propagates cancellation', async () => {
    const plugin = await fixture(
      'probe',
      "this.registerMethod('wait', (_args, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })));",
    );
    const { host } = runtime();
    await host.start([plugin]);
    await expect(host.callService('com.example.other', 'wait', {})).rejects.toThrow('not running');
    const controller = new AbortController(),
      waiting = host.callService(plugin.package_id, 'wait', {}, controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(waiting).rejects.toThrow('cancelled');
    await host.start([]);
    await expect(host.callService(plugin.package_id, 'wait', {})).rejects.toThrow('not running');
  });
  it('requires network permission and closes each connection once on reload', async () => {
    const setup =
      "const connection = this.registerConnection({ id: 'primary', transport: 'websocket', permission: 'network.connect.internet', close: () => this.app.invokeHost('fixture.closed', {}) }); connection.update({ state: 'connected' });";
    const denied = await fixture('denied', setup, []),
      allowed = await fixture('allowed', setup, [], { permissions: ['network.connect.internet'] });
    const { host, invoke } = runtime();
    expect(await host.start([denied, allowed])).toHaveLength(1);
    expect(host.connectionSnapshots(allowed.package_id)).toEqual([expect.objectContaining({ state: 'connected' })]);
    await host.start([]);
    expect(host.connectionSnapshots()).toEqual([]);
    expect(invoke.mock.calls.filter(([service]) => service === 'fixture.closed')).toHaveLength(1);
  });
  it('requires a declared browser authorization standard', async () => {
    const plugin = await fixture(
      'probe',
      "this.registerMethod('authorize', (_args, signal) => this.app.authorization.authorize({ standard: 'oauth2.authorization_code.pkce' }, signal));",
    );
    const { host, invoke } = runtime();
    await host.start([plugin]);
    await expect(host.callService(plugin.package_id, 'authorize', {})).rejects.toThrow('权限');
    expect(invoke.mock.calls.some(([service]) => service === 'seed.plugin-authorization')).toBe(false);
  });
  it('owns Local HTTP registrations and checks their permissions', async () => {
    const setup =
      "this.registerLocalApi({ allowed_origins: ['app://test'], allowed_client_ids: ['com.example.client'], routes: [{ method: 'GET', path: '/state' }], handle: () => new Response('ready') });";
    const denied = await fixture('denied', setup, []),
      allowed = await fixture('allowed', setup, [], { permissions: ['local.http-api'] });
    const { host } = runtime();
    expect(await host.start([denied, allowed])).toHaveLength(1);
    expect(
      await (await host.localApi(allowed.package_id)!.handle(new Request('http://localhost/state'), null)).text(),
    ).toBe('ready');
    await host.start([]);
    expect(host.localApi(allowed.package_id)).toBeUndefined();
  });
  it('keeps background task activity until completion or unload', async () => {
    const plugin = await fixture(
      'probe',
      "this.addCapability(definitions[0], { invoke: async (_method, request) => { this.app.tasks.start({ id: 'background' }); return request.arguments; } });",
    );
    const events = vi.fn(),
      { host } = runtime(undefined, new GlobalTaskActivityObserver(events));
    await host.start([plugin]);
    await host.invoke('probe', 'echo', request());
    expect(events.mock.calls.map(([event]) => event.phase)).toEqual(['started']);
    await host.stop();
    expect(events.mock.calls.map(([event]) => event.phase)).toEqual(['started', 'failed']);
  });
  it('keeps plugin background reads in diagnostics without adding user activity', async () => {
    const provider = await fixture('provider'),
      consumer = await fixture('consumer', '', [], { consumes: [{ capability: 'provider', methods: ['echo'] }] });
    const activities = vi.fn(),
      diagnostics = vi.fn(),
      { host } = runtime(undefined, new GlobalTaskActivityObserver(activities), false, diagnostics);
    await host.start([provider, consumer]);

    await expect(
      host.invokeConsumedByPackage(
        consumer.package_id,
        { capability: 'provider', method: 'echo', arguments: { value: 'quiet' }, activity: 'background' },
        [],
      ),
    ).resolves.toEqual({ value: 'quiet' });

    expect(activities).not.toHaveBeenCalled();
    expect(
      diagnostics.mock.calls
        .map(([event]) => event)
        .filter((event) => event.operation === 'provider.echo')
        .map((event) => event.details?.activity_visibility),
    ).toEqual(['technical', 'technical']);
  });
  it('keeps a nested native execution in the same trace as a technical implementation span', async () => {
    const provider = await fixture('provider');
    const diagnostics = vi.fn();
    const { host } = runtime(undefined, undefined, false, diagnostics);
    await host.start([provider]);

    await host.withDiagnosticTrace(
      { trace_id: 'request-trace', span_id: 'outer-invocation' },
      () => host.invoke('provider', 'echo', request('nested')),
    );

    const spans = diagnostics.mock.calls.map(([event]) => event);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({
      event: 'capability.execute',
      trace_id: 'request-trace',
      parent_span_id: 'outer-invocation',
      details: { activity_visibility: 'technical' },
    });
    expect(spans[0]!.activity_visibility).toBeUndefined();
    expect(spans[1]).toMatchObject({
      span_id: spans[0]!.span_id,
      phase: 'completed',
      details: { activity_visibility: 'technical' },
    });
  });
  it('does not let a background hint hide plugin write activity', async () => {
    const provider = await fixture('provider', undefined, [capability('provider', 'write')]),
      consumer = await fixture('consumer', '', [], { consumes: [{ capability: 'provider', methods: ['echo'] }] });
    const activities = vi.fn(),
      { host } = runtime(undefined, new GlobalTaskActivityObserver(activities));
    await host.start([provider, consumer]);

    await expect(
      host.invokeConsumedByPackage(
        consumer.package_id,
        { capability: 'provider', method: 'echo', arguments: { value: 'visible' }, activity: 'background' },
        [],
      ),
    ).resolves.toEqual({ value: 'visible' });

    expect(activities.mock.calls.map(([event]) => event.phase)).toEqual(['started', 'completed']);
  });
});

describe('code-registered public contracts', () => {
  it('enforces consumes, hides local capabilities and requires an exact provider', async () => {
    const one = await fixture('one', undefined, [capability('shared')]),
      two = await fixture('two', undefined, [capability('shared')]);
    const local = await fixture('local', undefined, [{ ...capability('private'), exposure: 'local' }]);
    const consumer = await fixture('consumer', '', [], {
      consumes: [
        { capability: 'shared', methods: ['echo'] },
        { capability: 'private', methods: ['echo'] },
      ],
    });
    const denied = await fixture('denied', '', []),
      { host } = runtime();
    expect(await host.start([one, two, local, consumer, denied])).toEqual([]);
    expect(host.consumedCapabilitiesByPackage(consumer.package_id).map((entry) => entry.id)).toEqual([
      'shared',
      'shared',
    ]);
    expect(host.consumedCapabilitiesByPackage(denied.package_id)).toEqual([]);
    await expect(
      host.invokeConsumedByPackage(
        consumer.package_id,
        { capability: 'shared', method: 'echo', arguments: { value: 'ok' } },
        [],
      ),
    ).rejects.toMatchObject({ code: 'capability_provider_required' });
    expect(
      await host.invokeConsumedByPackage(
        consumer.package_id,
        { capability: 'shared', method: 'echo', provider_plugin_id: two.package_id, arguments: { value: 'ok' } },
        [],
      ),
    ).toEqual({ value: 'ok' });
    await expect(
      host.invokeConsumedByPackage(
        denied.package_id,
        { capability: 'shared', method: 'echo', arguments: { value: 'ok' } },
        [],
      ),
    ).rejects.toThrow();
  });
  it('discovers replaced and removed providers without restarting their consumers', async () => {
    const definition = capability();
    definition.methods[0]!.annotations = { 'agent.tool': true };
    const provider = await fixture('probe', undefined, [definition]);
    const consumer = await fixture(
      'consumer',
      "this.registerMethod('identity', () => this.identity ??= crypto.randomUUID());",
      [],
      { consumes: [{ match: { method_annotation: 'agent.tool', equals: true } }] },
    );
    const { host } = runtime();
    await host.start([provider, consumer]);
    const identity = await host.callService(consumer.package_id, 'identity', {});
    expect(host.consumedCapabilitiesByPackage(consumer.package_id)).toHaveLength(1);
    await host.start([{ ...provider, configuration_revision: 'changed' }, consumer]);
    expect(await host.callService(consumer.package_id, 'identity', {})).toBe(identity);
    expect(host.consumedCapabilitiesByPackage(consumer.package_id)).toHaveLength(1);
    await host.start([consumer]);
    expect(await host.callService(consumer.package_id, 'identity', {})).toBe(identity);
    expect(host.consumedCapabilitiesByPackage(consumer.package_id)).toEqual([]);
    await host.start([provider, consumer]);
    expect(await host.callService(consumer.package_id, 'identity', {})).toBe(identity);
    expect(host.consumedCapabilitiesByPackage(consumer.package_id)).toHaveLength(1);
  });
  it('exposes explicit MCP tools and rejects duplicate names from a second provider', async () => {
    const definition = capability();
    definition.methods[0] = {
      ...definition.methods[0]!,
      descriptionKey: 'echo.description',
      annotations: { 'mcp.tool': true, 'mcp.tool_name': 'echo_probe' },
    };
    const one = await fixture('one', undefined, [definition]),
      two = await fixture('two', undefined, [definition]);
    one.sdk_manifest.translations = two.sdk_manifest.translations = {
      defaultLocale: 'en-US',
      resources: { 'en-US': { echo: { description: 'Echo value' } }, 'zh-CN': { echo: { description: '回显' } } },
    };
    const { host } = runtime();
    await host.start([one]);
    expect(host.mcpTools().map((tool) => tool.name)).toEqual(['echo_probe']);
    expect(await host.start([one, two])).toHaveLength(1);
  });
});

describe('billing and isolated process recovery', () => {
  it('retains nested relay receipts without changing business results', async () => {
    const provider = await fixture(
      'probe',
      "this.addCapability(definitions[0], { invoke: async (_method, request) => { const reply = await this.app.invokeHost('seed.cloud.relay', { payload: request.arguments }); return reply.payload; } });",
      [capability()],
      { permissions: ['cloud.relay'] },
    );
    const middle = await fixture(
      'middle',
      "this.addCapability(definitions[0], { invoke: async (_method, request) => this.app.capabilities.invoke({ capability: 'probe', method: 'echo', arguments: request.arguments }) });",
      [capability('middle')],
      { consumes: [{ capability: 'probe', methods: ['echo'] }] },
    );
    const consumer = await fixture('consumer', '', [], { consumes: [{ capability: 'middle', methods: ['echo'] }] });
    const { host } = runtime(
      vi.fn(async (service, args) =>
        service === 'seed.cloud.relay'
          ? { payload: args.payload, billing: { state: 'settled', call_id: 'billed', charged_amount: 2 } }
          : null,
      ),
    );
    await host.start([provider, middle, consumer]);
    expect(
      await host.invokeConsumedByPackage(
        consumer.package_id,
        { capability: 'middle', method: 'echo', arguments: { value: 'ok' }, include_billing: true },
        [],
      ),
    ).toEqual({
      result: { value: 'ok' },
      billing: { version: 1, complete: true, charges: [{ call_id: 'billed', charged_amount: 2 }] },
    });
  });
  it.each(['released', 'settled', 'uncertain'] as const)('keeps failure billing authoritative (%s)', async (state) => {
    const definition = capability();
    definition.methods[0]!.annotations = {
      'billing.settlement': 'cloud_relay',
      'billing.relay_template': 'probe',
      'billing.product': 'probe.echo',
    };
    const plugin = await fixture(
      'probe',
      "this.addCapability(definitions[0], { invoke: async () => { throw new Error('business failed'); } });",
      [definition],
    );
    const { host } = runtime(
      vi.fn(async (service) =>
        service === 'seed.billing.prepare'
          ? { billable: true, call_id: 'billed', amount: 2, price_revision: 1 }
          : service === 'seed.billing.cancel'
            ? { state, charged_amount: state === 'settled' ? 2 : state === 'released' ? 0 : null }
            : null,
      ),
      undefined,
      true,
    );
    await host.start([plugin]);
    await expect(host.withBillingReceipt(() => host.invoke('probe', 'echo', request()))).rejects.toMatchObject({
      billing: {
        complete: state !== 'uncertain',
        charges: state === 'uncertain' ? [] : [{ call_id: 'billed', charged_amount: state === 'settled' ? 2 : 0 }],
      },
    });
  });
  it('withdraws remote capabilities on exit and accepts validated recovery', async () => {
    const plugin = await fixture(),
      { host: local } = runtime();
    await local.start([plugin]);
    const snapshot = local.runtimeSnapshot(plugin.package_id),
      invoke = vi.fn(async (service: string) => (service === 'seed.native.start' ? snapshot : null));
    const remote = new SeedPluginHost({ configuration: () => null, invoke_host: invoke }, undefined, 'remote');
    hosts.push(remote);
    await remote.start([plugin]);
    expect(remote.supports('probe', 'echo')).toBe(true);
    expect(() =>
      remote.applyRemoteSnapshot(plugin.package_id, {
        ...snapshot,
        capabilities: ['replacement'],
        capabilityDefinitions: [capability('replacement')],
        localApi: { allowed_origins: ['*'], allowed_client_ids: [], routes: [] },
      }),
    ).toThrow();
    expect(remote.supports('probe', 'echo')).toBe(true);
    expect(remote.supports('replacement', 'echo')).toBe(false);
    expect(() =>
      remote.applyRemoteSnapshot(plugin.package_id, {
        ...snapshot,
        connections: [
          { plugin_id: 'com.example.forged', permission: 'network.connect.internet', state: 'connected' } as any,
        ],
      }),
    ).toThrow();
    expect(remote.supports('probe', 'echo')).toBe(true);
    await remote.start([{ ...plugin, configuration_revision: 'new-generation' }]);
    expect(invoke.mock.calls.filter(([service]) => service === 'seed.native.stop')).toHaveLength(1);
    expect(invoke.mock.calls.filter(([service]) => service === 'seed.native.start')).toHaveLength(2);
    expect(() => remote.applyRemoteSnapshot(plugin.package_id, { ...snapshot, capabilities: ['forged'] })).toThrow();
    expect(remote.supports('probe', 'echo')).toBe(true);
    remote.applyRemoteSnapshot(plugin.package_id, null);
    expect(remote.supports('probe', 'echo')).toBe(false);
    remote.applyRemoteSnapshot(plugin.package_id, snapshot);
    expect(remote.supports('probe', 'echo')).toBe(true);
    let finish!: () => void;
    invoke.mockImplementation(async (service) => {
      if (service === 'seed.native.stop')
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      return null;
    });
    const stopping = remote.stop();
    let finished = false;
    void stopping.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    finish();
    await stopping;
    expect(remote.supports('probe', 'echo')).toBe(false);
  });
});
