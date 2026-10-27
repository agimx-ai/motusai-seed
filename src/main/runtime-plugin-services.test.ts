import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({
  app: {
    getLoginItemSettings: () => ({ openAtLogin: false }),
    getVersion: () => '0.2.15',
    getPreferredSystemLanguages: () => ['en-US'],
    getLocale: () => 'en-US',
  },
  BrowserWindow: class {},
  powerSaveBlocker: {},
  shell: { openExternal: vi.fn(async () => undefined) },
  ipcMain: {},
  session: { defaultSession: { resolveProxy: vi.fn(async () => 'PROXY 127.0.0.1:7890') } },
}));
vi.mock('./updater', () => ({ SeedUpdater: class {} }));
import { SeedRuntime } from './runtime';
import { session, shell } from 'electron';

beforeEach(() => vi.mocked(shell.openExternal).mockReset().mockResolvedValue(undefined));

function fixture(kind = 'sandboxed-web') {
  const runtime = Object.assign(Object.create(SeedRuntime.prototype), {
    runtimePlugins: ['one', 'two'].map((name) => ({
      package_id: 'com.example.' + name,
      api_version: 2,
      runtime_kind: kind,
      has_service: true,
      permissions: [],
    })),
    capabilityCalls: new Map(),
    sandboxCalls: new Map(),
    sandboxTasks: new Map(),
    connector: { queryPluginCapabilities: vi.fn(async () => []), invokePluginCapability: vi.fn() },
    handleWorkerEvent: vi.fn(async () => undefined),
    pluginCapabilityCatalog: { publish: vi.fn() },
    pluginEvents: { reconcile: vi.fn(), closePlugin: vi.fn() },
    systemNotifications: { invoke: vi.fn(async () => 'sent'), clear: vi.fn() },
    pluginIsAuthorized: vi.fn(() => true),
    store: { systemNotificationsEnabled: vi.fn(() => true) },
    window: vi.fn(() => null),
    requestNavigation: vi.fn(async () => undefined),
    diagnostics: { record: vi.fn() },
    configureWorker: vi.fn(),
  });
  const call = (owner: string, service: string, args: Record<string, unknown>) =>
    Reflect.get(runtime, 'invokePluginBroker').call(runtime, 'com.example.' + owner, service, args);
  return { runtime, call };
}
describe('generic plugin SDK brokers', () => {
  it.each(['native-host', 'sandboxed-web'])(
    'opens HTTP LAN and HTTPS pages in the system browser for %s',
    async (kind) => {
      const { runtime, call } = fixture(kind);
      runtime.runtimePlugins[0].permissions = ['shell.open-url'];
      for (const url of ['http://192.168.2.58:18182/authorize?state=private-state', 'https://example.com/login']) {
        await expect(call('one', 'seed.shell.open-url', { url, package_id: 'com.example.two' })).resolves.toEqual({
          opened: true,
        });
        expect(shell.openExternal).toHaveBeenLastCalledWith(url);
      }
      expect(runtime.diagnostics.record).not.toHaveBeenCalled();
    },
  );

  it('rejects missing browser permission and revoked owners before opening any URL', async () => {
    const { runtime, call } = fixture();
    for (const owner of ['one', 'missing'])
      await expect(call(owner, 'seed.shell.open-url', { url: 'https://example.com' })).rejects.toMatchObject({
        code: 'broker_permission_denied',
      });
    runtime.runtimePlugins[0].permissions = ['shell.open-url'];
    runtime.pluginIsAuthorized.mockReturnValue(false);
    await expect(call('one', 'seed.shell.open-url', { url: 'https://example.com' })).rejects.toMatchObject({
      code: 'broker_permission_denied',
    });
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('rejects unsafe browser targets without disclosing the supplied URL', async () => {
    const { runtime, call } = fixture();
    runtime.runtimePlugins[0].permissions = ['shell.open-url'];
    for (const url of [
      'file:///private/file',
      'javascript:alert(1)',
      'mailto:private@example.com',
      'https://user:private-token@example.com',
      '/relative',
      'https://example.com/\nprivate-token',
      'https://example.com/' + 'x'.repeat(16384),
    ]) {
      const error = await call('one', 'seed.shell.open-url', { url }).catch((cause: unknown) => cause);
      expect(error).toMatchObject({ code: 'broker_url_denied' });
      expect(String(error)).not.toContain('private-token');
    }
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('sanitizes system browser launch failures and suppresses success after an owner changes', async () => {
    const { runtime, call } = fixture();
    runtime.runtimePlugins[0].permissions = ['shell.open-url'];
    vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('private-token from OS'));
    const error = await call('one', 'seed.shell.open-url', { url: 'https://example.com?token=private-token' }).catch(
      (cause: unknown) => cause,
    );
    expect(error).toMatchObject({ code: 'broker_open_url_failed' });
    expect(String(error)).not.toContain('private-token');
    vi.mocked(shell.openExternal).mockImplementationOnce(async () => {
      runtime.runtimePlugins = [runtime.runtimePlugins[1]];
    });
    await expect(call('one', 'seed.shell.open-url', { url: 'https://example.com' })).rejects.toMatchObject({
      code: 'broker_owner_inactive',
    });
  });

  it('resolves OS proxy routes only for active plugins with network permission, without forwarding URL secrets', async () => {
    const { runtime, call } = fixture('native-host');
    await expect(call('one', 'seed.network.resolve-proxy', { url: 'https://example.com' })).rejects.toMatchObject({
      code: 'broker_permission_denied',
    });
    runtime.runtimePlugins[0].permissions = ['network.connect.internet'];
    await expect(
      call('one', 'seed.network.resolve-proxy', { url: 'https://example.com/path?token=private' }),
    ).resolves.toEqual({ proxy: 'PROXY 127.0.0.1:7890' });
    expect(session.defaultSession.resolveProxy).toHaveBeenCalledWith('https://example.com');
    await expect(call('one', 'seed.network.resolve-proxy', { url: 'https://user:secret@example.com' })).rejects.toThrow(
      'without credentials',
    );
    await expect(call('one', 'seed.network.resolve-proxy', { url: 'file:///tmp/private' })).rejects.toThrow('HTTP(S)');
  });
  it.each(['native-host', 'sandboxed-web'])(
    'routes notification identity, permission and optional navigation for %s',
    async (kind) => {
      const { runtime, call } = fixture(kind);
      runtime.runtimePlugins[0].permissions = ['system.notifications'];
      const window = {
        isDestroyed: () => false,
        isMinimized: () => true,
        restore: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
      };
      runtime.window.mockReturnValue(window);
      const request = { version: 1, operation: 'show', id: crypto.randomUUID(), notification: { title: 'Complete' } };
      expect(await call('one', 'seed.notifications', { ...request, package_id: 'com.example.two' })).toBe('sent');
      const [owner, input, context] = runtime.systemNotifications.invoke.mock.calls[0];
      expect(owner).toBe('com.example.one');
      expect(input).toEqual(request);
      expect(context.plugin).toBe(runtime.runtimePlugins[0]);
      expect(context.enabled()).toBe(true);
      expect(runtime.requestNavigation).not.toHaveBeenCalled();
      const target = { destination: 'plugins', pluginId: 'com.example.target', query: 'details' };
      context.activate(target);
      expect(window.restore).toHaveBeenCalledOnce();
      expect(window.show).toHaveBeenCalledOnce();
      expect(window.focus).toHaveBeenCalledOnce();
      expect(runtime.requestNavigation).toHaveBeenCalledExactlyOnceWith(target);
      runtime.store.systemNotificationsEnabled.mockReturnValue(false);
      expect(context.enabled()).toBe(false);
      await runtime.releasePluginWork('com.example.one');
      expect(runtime.systemNotifications.clear).toHaveBeenCalledExactlyOnceWith('com.example.one');
      runtime.runtimePlugins = [runtime.runtimePlugins[1]];
      expect(() => context.assertActive()).toThrow('no longer running');
    },
  );
  it('checks plugin notification permission before touching the notification service', async () => {
    const { runtime, call } = fixture();
    for (const owner of ['one', 'missing'])
      await expect(call(owner, 'seed.notifications', { version: 1, operation: 'is-supported' })).rejects.toMatchObject({
        code: 'broker_permission_denied',
      });
    runtime.runtimePlugins[0].permissions = ['system.notifications'];
    runtime.pluginIsAuthorized.mockReturnValue(false);
    await expect(call('one', 'seed.notifications', { version: 1, operation: 'is-supported' })).rejects.toMatchObject({
      code: 'broker_permission_denied',
    });
    expect(runtime.systemNotifications.invoke).not.toHaveBeenCalled();
  });
  it('persists notification disable and clears pending handles', async () => {
    const { runtime } = fixture();
    runtime.store.setSystemNotificationsEnabled = vi.fn();
    runtime.publishSnapshot = vi.fn();
    expect(await runtime.setSystemNotificationsEnabled(false)).toBe(false);
    expect(runtime.store.setSystemNotificationsEnabled).toHaveBeenCalledWith(false);
    expect(runtime.systemNotifications.clear).toHaveBeenCalledExactlyOnceWith();
    expect(runtime.publishSnapshot).toHaveBeenCalledOnce();
  });
  it('counts only a real active capture task, deduplicating repeated requests for the same task', () => {
    const runtime = Object.assign(Object.create(SeedRuntime.prototype), {
      store: {
        audit: () => [],
        preventSystemSleep: () => false,
        autoUpdatePlugins: () => true,
        pluginDevelopmentEnabled: () => false,
        systemNotificationsEnabled: () => true,
        languagePreference: () => 'en-US',
        themePreference: () => 'light',
      },
      audioService: { snapshot: () => ({ state: 'stopping', duration_ms: 0, task_id: 'capture-task' }) },
      activeTaskIds: new Map([
        ['first', 'capture-task'],
        ['second', 'capture-task'],
        ['other', 'unrelated-task'],
      ]),
      installedPlugins: [],
      updater: { snapshot: () => ({}) },
    });
    expect(runtime.snapshot().audio.relatedTaskCount).toBe(1);
    expect(runtime.snapshot().mascot.activeTaskCount).toBe(2);
    runtime.activeTaskIds.delete('first');
    runtime.activeTaskIds.delete('second');
    expect(runtime.snapshot().audio.relatedTaskCount).toBe(0);
    expect(runtime.snapshot().mascot.activeTaskCount).toBe(1);
  });

  it.each(['native-host', 'sandboxed-web'])('accepts only host-attributed audio activity for %s', async (kind) => {
    const { runtime, call } = fixture(kind);
    runtime.runtimePlugins[0].permissions = ['device.audio.capture'];
    runtime.audioService = { invoke: vi.fn() };
    await call('one', 'seed.audio', { operation: 'capture.stop', activity_task_id: 'actual-task' });
    expect(runtime.audioService.invoke).toHaveBeenCalledWith(
      { operation: 'capture.stop', activity_task_id: 'actual-task' },
      'com.example.one',
      kind === 'native-host' ? 'actual-task' : undefined,
    );
  });

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
  it('keeps the originating trace when the native broker routes a consumed capability', async () => {
    const { runtime } = fixture('native-host');
    const trace = { trace_id: 'request-trace', span_id: 'broker-span' };
    const scopeId = crypto.randomUUID();
    await Reflect.get(runtime, 'invokePluginBroker').call(
      runtime,
      'com.example.one',
      'seed.capabilities.invoke',
      {
        call_id: crypto.randomUUID(),
        invocation: { capability: 'probe', method: 'read', arguments: {} },
        invocation_scope_id: scopeId,
      },
      undefined,
      trace,
    );
    expect(runtime.connector.invokePluginCapability).toHaveBeenCalledWith(
      'com.example.one',
      { capability: 'probe', method: 'read', arguments: {} },
      [],
      expect.any(AbortSignal),
      trace,
      scopeId,
    );
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
