import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from 'electron';
vi.mock('electron', () => ({
  app: { isPackaged: false, getPreferredSystemLanguages: () => ['en-US'], getLocale: () => 'en-US' },
  BrowserWindow: class {},
  powerSaveBlocker: {},
  shell: {},
  ipcMain: {},
  session: {},
}));
vi.mock('./updater', () => ({ SeedUpdater: class {} }));
import { SeedRuntime } from './runtime';
import { PluginCapabilityCatalog } from './plugin-capability-catalog';

function fixture() {
  const one = {
    package_id: 'com.example.one',
    version: '1.0.0',
    runtime_kind: 'native-host',
    api_version: 2,
    consumes: [],
  };
  const two = { ...one, package_id: 'com.example.two' };
  let development: any[] = [];
  const stop = vi.fn(),
    cancelPlugin = vi.fn(),
    closePluginRelayStreams = vi.fn(),
    destroyOne = vi.fn(),
    destroyTwo = vi.fn();
  const runtime = Object.assign(Object.create(SeedRuntime.prototype), {
    stopping: false,
    pluginReloadWork: Promise.resolve(),
    developmentPluginStates: {},
    pluginServicesReady: Promise.resolve(),
    configureWorker: vi.fn(async () => {}),
    runtimePlugins: [one, two],
    installedPlugins: [],
    developmentPlugins: {
      failures: new Map(),
      refresh: vi.fn(async () => development),
      has: (id: string) => development.some((entry) => entry.installed.id === id),
      pruneSnapshots: vi.fn(),
    },
    pluginInstaller: {
      pruneInactiveVersions: vi.fn(),
      listInstalled: vi.fn(async () => [
        { id: one.package_id, version: one.version, source: 'installed' },
        { id: two.package_id, version: two.version, source: 'installed' },
      ]),
      listRuntimePlugins: vi.fn(async () => [one, two]),
    },
    authorizedInstalledPluginIds: new Set([one.package_id, two.package_id]),
    entitlementExpiresAt: Date.now() + 100_000,
    nativeHost: { stop },
    pluginBrowserAuthorization: { cancelPlugin },
    creditBilling: { closePluginRelayStreams },
    billedRelayStreams: new Map([
      ['one-stream', one.package_id],
      ['two-stream', two.package_id],
    ]),
    capabilityCalls: new Map(),
    sandboxCalls: new Map(),
    sandboxTasks: new Map(),
    pluginCapabilityCatalog: new PluginCapabilityCatalog(),
    pluginEvents: { closePlugin: vi.fn() },
    systemNotifications: { clear: vi.fn() },
    pluginViewHosts: new Map([
      [one.package_id, { plugin: one, destroy: destroyOne }],
      [two.package_id, { plugin: two, destroy: destroyTwo }],
    ]),
    sandboxHost: { configure: vi.fn() },
    store: { languagePreference: () => 'en-US' },
  });
  return {
    runtime,
    one,
    two,
    stop,
    cancelPlugin,
    closePluginRelayStreams,
    destroyOne,
    destroyTwo,
    setDevelopment: (entries: any[]) => {
      development = entries;
    },
  };
}
describe('one runtime with distinct plugin sources', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.assign(app, { isPackaged: false });
  });

  it('persists the original plugin startup failure in the error field', async () => {
    const h = fixture();
    h.runtime.store.addAudit = vi.fn(async () => {});
    h.runtime.publishSnapshot = vi.fn(async () => {});
    const message = 'Cannot load plugin service: missing module';
    await h.runtime.handleWorkerEvent({ type: 'plugin.runtime.failed', packageId: h.one.package_id, message });
    expect(h.runtime.store.addAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'system',
        operation: 'plugin.runtime.start',
        outcome: 'failed',
        errorMessage: message,
        metadata: { plugin_id: h.one.package_id },
      }),
    );
  });

  it('finishes activation before completing a reload or replacing the next plugin source', async () => {
    const h = fixture();
    let activate!: () => void;
    h.runtime.configureWorker.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          activate = resolve;
        }),
    );
    const completed = vi.fn();
    const first = h.runtime.reloadPlugins().then(completed);
    await vi.waitFor(() => expect(activate).toBeTypeOf('function'));
    const second = h.runtime.reloadPlugins();
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    expect(h.runtime.developmentPlugins.refresh).toHaveBeenCalledTimes(1);
    activate();
    await Promise.all([first, second]);
    expect(completed).toHaveBeenCalledOnce();
    expect(h.runtime.developmentPlugins.refresh).toHaveBeenCalledTimes(2);
    expect(h.runtime.configureWorker).toHaveBeenCalledTimes(2);
  });

  it('waits for existing service configuration before withdrawing its plugin sources', async () => {
    const h = fixture();
    let activate!: () => void;
    h.runtime.pluginServicesReady = new Promise<void>((resolve) => {
      activate = resolve;
    });
    const pending = h.runtime.reloadPlugins();
    await Promise.resolve();
    expect(h.runtime.developmentPlugins.refresh).not.toHaveBeenCalled();
    activate();
    await pending;
    expect(h.runtime.configureWorker).toHaveBeenCalledOnce();
  });

  it('can discover startup sources without activating services before account state is restored', async () => {
    const h = fixture();
    await h.runtime.reloadPlugins(false);
    expect(h.runtime.pluginInstaller.listInstalled).toHaveBeenCalledOnce();
    expect(h.runtime.configureWorker).not.toHaveBeenCalled();
  });

  it('withdraws the old frontend before stopping a changed service', async () => {
    const h = fixture();
    h.setDevelopment([
      {
        installed: { id: h.one.package_id, version: h.one.version, source: 'development' },
        runtime: { ...h.one, source: 'development', configuration_revision: 'new-code' },
      },
    ]);
    h.stop.mockImplementation(async () => {
      expect(h.destroyOne).toHaveBeenCalledTimes(1);
      expect(h.runtime.pluginViewHosts.has(h.one.package_id)).toBe(false);
    });
    await h.runtime.reloadPlugins();
    expect(h.destroyTwo).not.toHaveBeenCalled();
  });

  it('does not prewarm frontend brokers when backend sources are configured', async () => {
    const h = fixture();
    h.one.runtime_kind = 'sandboxed-web';
    h.runtime.pluginViewHosts.clear();
    h.runtime.ensurePluginView = vi.fn();
    await h.runtime.reloadPlugins();
    expect(h.runtime.ensurePluginView).not.toHaveBeenCalled();
    expect(h.runtime.pluginViewHosts.size).toBe(0);
    expect(h.runtime.sandboxHost.configure).toHaveBeenCalled();
  });
  it('overlays a development bundle without overwriting marketplace records or stopping unrelated plugins', async () => {
    const h = fixture(),
      next = { ...h.one, source: 'development', configuration_revision: 'new-build' };
    h.setDevelopment([
      { installed: { id: h.one.package_id, version: next.version, source: 'development' }, runtime: next },
    ]);
    await h.runtime.reloadPlugins();
    expect(h.runtime.runtimePlugins).toEqual([h.two, next]);
    expect(h.stop).toHaveBeenCalledExactlyOnceWith(h.one.package_id);
    expect(h.cancelPlugin).toHaveBeenCalledExactlyOnceWith(h.one.package_id);
    expect(h.closePluginRelayStreams).toHaveBeenCalledExactlyOnceWith(h.one.package_id);
    expect(h.destroyOne).toHaveBeenCalledTimes(1);
    expect(h.destroyTwo).not.toHaveBeenCalled();
    expect(h.runtime.billedRelayStreams).toEqual(new Map([['two-stream', h.two.package_id]]));
    h.setDevelopment([]);
    await h.runtime.reloadPlugins();
    expect(h.runtime.runtimePlugins).toEqual([h.one, h.two]);
  });
  it('keeps production entitlement checks intact, while developer sources do not require Cloud installation', async () => {
    const h = fixture();
    h.runtime.entitlementExpiresAt = 0;
    const next = { ...h.one, source: 'development' };
    h.setDevelopment([
      { installed: { id: h.one.package_id, version: next.version, source: 'development' }, runtime: next },
    ]);
    await h.runtime.reloadPlugins();
    expect(h.runtime.runtimePlugins).toEqual([next]);
    expect(h.runtime.pluginIsAuthorized(h.one.package_id)).toBe(true);
    expect(h.runtime.pluginIsAuthorized(h.two.package_id)).toBe(false);
    h.runtime.developmentPlugins = undefined;
    await h.runtime.reloadPlugins();
    expect(h.runtime.runtimePlugins).toEqual([]);
  });
  it('preserves a settings-only restart generation when another source is refreshed', async () => {
    const h = fixture();
    const configured = { ...h.one, configuration_revision: 'settings-reload' };
    h.runtime.runtimePlugins = [configured, h.two];
    await h.runtime.reloadPlugins();
    expect(h.runtime.runtimePlugins).toEqual([configured, h.two]);
    expect(h.stop).not.toHaveBeenCalled();
    expect(h.destroyOne).not.toHaveBeenCalled();
  });

  it('preserves dependent service generations when a provider is replaced', async () => {
    const h = fixture();
    h.two.consumes = [{ match: { method_annotation: 'agent.tool', equals: true } }] as any;
    h.runtime.pluginCapabilityCatalog.publish(h.one, [
      { id: 'probe', version: 1, methods: [{ name: 'read_probe', risk: 'read', annotations: { 'agent.tool': true } }] },
    ]);
    h.setDevelopment([
      {
        installed: { id: h.one.package_id, version: h.one.version, source: 'development' },
        runtime: { ...h.one, source: 'development', configuration_revision: 'new-code' },
      },
    ]);
    await h.runtime.reloadPlugins();
    expect(
      h.runtime.runtimePlugins.find((plugin: any) => plugin.package_id === h.two.package_id).configuration_revision,
    ).toBeUndefined();
    // Both consumer identities stay unchanged; capability discovery reads the live catalog.
    expect(h.destroyTwo).not.toHaveBeenCalled();
    expect(h.stop).toHaveBeenCalledExactlyOnceWith(h.one.package_id);
  });

  it('serializes overlapping source refreshes and does no work after shutdown', async () => {
    const h = fixture();
    await Promise.all([h.runtime.reloadPlugins(), h.runtime.reloadPlugins()]);
    expect(h.stop).not.toHaveBeenCalled();
    h.runtime.stopping = true;
    await h.runtime.reloadPlugins();
    expect(h.runtime.pluginInstaller.listInstalled).toHaveBeenCalledTimes(2);
    expect(h.runtime.configureWorker).toHaveBeenCalledTimes(2);
  });
  it.each([
    { startup: 'packaged client', isPackaged: true, devServer: undefined },
    { startup: 'source with Vite', isPackaged: false, devServer: 'http://localhost:5173' },
    { startup: 'source without Vite', isPackaged: false, devServer: undefined },
  ])(
    'uses the same development switch in $startup and restores installed sources when disabled',
    async (environment) => {
      Object.assign(app, { isPackaged: environment.isPackaged });
      vi.stubEnv('VITE_DEV_SERVER_URL', environment.devServer);
      const h = fixture();
      const source = { ...h.runtime.developmentPlugins, stop: vi.fn() };
      h.runtime.developmentPlugins = undefined;
      h.runtime.pluginDevelopmentWork = Promise.resolve();
      let enabled = false;
      h.runtime.store.pluginDevelopmentEnabled = () => enabled;
      h.runtime.store.setPluginDevelopmentEnabled = vi.fn(async (value: boolean) => {
        enabled = value;
      });
      h.runtime.publishSnapshot = vi.fn();
      h.runtime.startPluginDevelopment = vi.fn(async () => {
        h.runtime.developmentPlugins = source;
      });
      const next = { ...h.one, source: 'development', configuration_revision: 'new-build' };
      h.setDevelopment([
        {
          installed: {
            id: h.one.package_id,
            version: next.version,
            source: 'development',
            manifestDigest: 'new-build',
          },
          runtime: next,
        },
      ]);
      await expect(h.runtime.setPluginDevelopmentEnabled(true)).resolves.toBe(true);
      expect(h.runtime.runtimePlugins).toContainEqual(next);
      expect(enabled).toBe(true);
      await expect(h.runtime.setPluginDevelopmentEnabled(false)).resolves.toBe(false);
      expect(source.stop).toHaveBeenCalledOnce();
      expect(h.runtime.runtimePlugins).toEqual([h.one, h.two]);
      expect(enabled).toBe(false);
      expect(h.runtime.developmentPluginStates).toEqual({});
    },
  );

  it('serializes rapid mode changes and ignores readiness from an older build', async () => {
    const h = fixture();
    const source = { ...h.runtime.developmentPlugins, stop: vi.fn() };
    h.runtime.developmentPlugins = undefined;
    h.runtime.pluginDevelopmentWork = Promise.resolve();
    let enabled = false;
    h.runtime.store.pluginDevelopmentEnabled = () => enabled;
    h.runtime.store.setPluginDevelopmentEnabled = async (value: boolean) => {
      enabled = value;
    };
    h.runtime.publishSnapshot = vi.fn();
    h.runtime.startPluginDevelopment = async () => {
      h.runtime.developmentPlugins = source;
    };
    await Promise.all([h.runtime.setPluginDevelopmentEnabled(true), h.runtime.setPluginDevelopmentEnabled(false)]);
    expect(enabled).toBe(false);
    const current = { ...h.one, source: 'development', configuration_revision: 'current' };
    h.runtime.runtimePlugins = [current];
    h.runtime.installedPlugins = [{ id: h.one.package_id, manifestDigest: 'digest-current' }];
    await h.runtime.handleWorkerEvent({
      type: 'plugin.runtime.ready',
      packageId: h.one.package_id,
      configurationRevision: 'old',
    });
    expect(h.runtime.developmentPluginStates).toEqual({});
    await h.runtime.handleWorkerEvent({
      type: 'plugin.runtime.ready',
      packageId: h.one.package_id,
      configurationRevision: 'current',
    });
    expect(h.runtime.developmentPluginStates[h.one.package_id]).toEqual({
      state: 'loaded',
      manifestDigest: 'digest-current',
    });
  });
});
