import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({
  app: {},
  BrowserWindow: class {},
  powerSaveBlocker: {},
  shell: {},
  ipcMain: {},
  session: {},
}));
vi.mock('./updater', () => ({ SeedUpdater: class {} }));
import { SeedRuntime } from './runtime';

function fixture(kind = 'sandboxed-web') {
  const runtime = Object.assign(Object.create(SeedRuntime.prototype), {
    runtimePlugins: ['one', 'two'].map((name) => ({
      package_id: 'com.example.' + name,
      api_version: 2,
      runtime_kind: kind,
      has_service: true,
    })),
    capabilityCalls: new Map(),
    sandboxCalls: new Map(),
    sandboxTasks: new Map(),
    connector: { queryPluginCapabilities: vi.fn(async () => []), invokePluginCapability: vi.fn() },
    handleWorkerEvent: vi.fn(async () => undefined),
    pluginCapabilityCatalog: { publish: vi.fn() },
    configureWorker: vi.fn(),
  });
  const call = (owner: string, service: string, args: Record<string, unknown>) =>
    Reflect.get(runtime, 'invokePluginBroker').call(runtime, 'com.example.' + owner, service, args);
  return { runtime, call };
}
describe('generic plugin SDK brokers', () => {
  it('refreshes sandbox code registrations and withdrawals without requiring an app restart', async () => {
    const { runtime, call } = fixture();
    await call('one', 'seed.plugin-capabilities', { definitions: [] });
    expect(runtime.pluginCapabilityCatalog.publish).toHaveBeenCalledWith(runtime.runtimePlugins[0], []);
    expect(runtime.configureWorker).toHaveBeenCalledTimes(1);
  });
  it.each(['native-host', 'sandboxed-web'])('uses the same authoritative capability router for %s', async (kind) => {
    const { runtime, call } = fixture(kind);
    await call('one', 'seed.capabilities.list', {});
    expect(runtime.connector.queryPluginCapabilities).toHaveBeenCalledExactlyOnceWith('com.example.one');
    const id = crypto.randomUUID();
    runtime.connector.invokePluginCapability.mockImplementation(
      async (_owner: string, _args: unknown, _chain: unknown, signal: AbortSignal) => {
        return await new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('Cancelled'), { code: 'provider_cancelled' })),
            { once: true },
          ),
        );
      },
    );
    const pending = call('one', 'seed.capabilities.invoke', {
      call_id: id,
      invocation: { capability: 'probe', method: 'read', arguments: {} },
    });
    await call('two', 'seed.capabilities.cancel', { call_id: id });
    expect(runtime.connector.invokePluginCapability.mock.calls[0][3].aborted).toBe(false);
    await call('one', 'seed.capabilities.cancel', { call_id: id });
    await expect(pending).rejects.toMatchObject({ code: 'provider_cancelled' });
    expect(runtime.capabilityCalls.size).toBe(0);
  });
  it('reports owned tasks once and cleans only that plugin on reload or process loss', async () => {
    const { runtime, call } = fixture();
    await call('one', 'seed.plugin-task', { id: 'task', phase: 'started', label: 'Work' });
    await call('two', 'seed.plugin-task', { id: 'task', phase: 'started', label: 'Other' });
    await expect(call('one', 'seed.plugin-task', { id: 'task', phase: 'started' })).rejects.toThrow('Duplicate');
    await runtime.releasePluginWork('com.example.one', true);
    expect(runtime.sandboxTasks.size).toBe(1);
    expect(runtime.handleWorkerEvent.mock.calls.map(([event]: any[]) => event.phase)).toEqual([
      'started',
      'started',
      'failed',
    ]);
    await call('one', 'seed.plugin-task', { id: 'task', phase: 'completed' });
    expect(runtime.handleWorkerEvent).toHaveBeenCalledTimes(3);
    await call('two', 'seed.plugin-task', { id: 'task', phase: 'completed' });
    expect(runtime.sandboxTasks.size).toBe(0);
    expect(runtime.handleWorkerEvent.mock.calls[3][0].requestId).toBe(
      runtime.handleWorkerEvent.mock.calls[1][0].requestId,
    );
  });
});
