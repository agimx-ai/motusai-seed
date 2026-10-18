import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({
  app: { getPreferredSystemLanguages: () => ['en-US'], getLocale: () => 'en-US' },
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
    runtimePlugins: [one, two],
    installedPlugins: [],
    developmentPlugins: {
      refresh: vi.fn(async () => development),
      has: (id: string) => development.some((entry) => entry.installed.id === id),
      pruneSnapshots: vi.fn(),
    },
    pluginInstaller: {
      pruneInactiveVersions: vi.fn(),
      listInstalled: vi.fn(async () => [
        { id: one.package_id, source: 'installed' },
        { id: two.package_id, source: 'installed' },
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
    h.setDevelopment([{ installed: { id: h.one.package_id, source: 'development' }, runtime: next }]);
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
    h.setDevelopment([{ installed: { id: h.one.package_id, source: 'development' }, runtime: next }]);
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

  it('refreshes dependent service generations from the old provider contract before it is withdrawn', async () => {
    const h = fixture();
    h.two.consumes = [{ match: { method_annotation: 'agent.tool', equals: true } }] as any;
    h.runtime.pluginCapabilityCatalog.publish(h.one, [
      { id: 'probe', version: 1, methods: [{ name: 'read_probe', risk: 'read', annotations: { 'agent.tool': true } }] },
    ]);
    h.setDevelopment([
      {
        installed: { id: h.one.package_id, source: 'development' },
        runtime: { ...h.one, source: 'development', configuration_revision: 'new-code' },
      },
    ]);
    await h.runtime.reloadPlugins();
    expect(
      h.runtime.runtimePlugins.find((plugin: any) => plugin.package_id === h.two.package_id).configuration_revision,
    ).toEqual(expect.any(String));
    // Code is unchanged, so its view is preserved; only the service discovers the new provider contracts.
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
  });
});
