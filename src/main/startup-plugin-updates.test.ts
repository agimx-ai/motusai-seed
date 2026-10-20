import { describe, expect, it, vi } from 'vitest';
import type { SeedCatalogPlugin } from '../shared/contracts';

const host = vi.hoisted(() => ({ isPackaged: true }));
vi.mock('electron', () => ({ app: host, BrowserWindow: class {}, powerSaveBlocker: {}, shell: {}, ipcMain: {}, session: {} }));
vi.mock('./updater', () => ({ SeedUpdater: class {} }));
import { SeedRuntime } from './runtime';

function setup() {
  host.isPackaged = true;
  const automatic = vi.fn(async () => {});
  const runtime = Object.assign(Object.create(SeedRuntime.prototype) as SeedRuntime, {
    authStatus: { status: 'signed_in' }, installedPluginsStatus: 'ready', pluginCatalogStatus: 'loading',
    remotePluginCatalog: [], verifiedCatalogPlugins: new Map(), stopping: false,
    entitlementExpiresAt: Date.now() + 60_000,
    pluginUpdates: { automatic },
    store: { autoUpdatePlugins: vi.fn(() => true), setAutoUpdatePlugins: vi.fn(async () => {}) },
    publishSnapshot: vi.fn(async () => {}),
    readInstalledEntitlements: vi.fn(async () => {}),
    fetchPluginCatalog: vi.fn(async () => ({ items: [{ id: 'com.example.plugin' }] as SeedCatalogPlugin[] })),
  });
  return { runtime, automatic };
}

describe('Startup plugin update readiness', () => {
  it('respects a disabled preference and starts on re-enable only when the catalog is ready', async () => {
    const { runtime, automatic } = setup();
    const store = Reflect.get(runtime, 'store');
    let enabled = false;
    store.autoUpdatePlugins.mockImplementation(() => enabled);
    store.setAutoUpdatePlugins.mockImplementation(async (value: boolean) => { enabled = value; });
    const stopAutomatic = vi.fn();
    Reflect.get(runtime, 'pluginUpdates').stopAutomatic = stopAutomatic;
    await runtime.setAutoUpdatePlugins(true);
    expect(automatic).not.toHaveBeenCalled();
    await runtime.setAutoUpdatePlugins(false);
    expect(stopAutomatic).toHaveBeenCalledOnce();
    await runtime.refreshPluginCatalog();
    expect(automatic).not.toHaveBeenCalled();
    await runtime.setAutoUpdatePlugins(true);
    expect(automatic).toHaveBeenCalledExactlyOnceWith([{ id: 'com.example.plugin' }]);
    expect(store.setAutoUpdatePlugins.mock.calls).toEqual([[true], [false], [true]]);
  });

  it('starts only after publishing a complete catalog and successful installed entitlement refresh', async () => {
    const { runtime, automatic } = setup();
    let finish!: () => void;
    Reflect.set(runtime, 'readInstalledEntitlements', vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })));
    const request = runtime.refreshPluginCatalog();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(automatic).not.toHaveBeenCalled();
    finish();
    await request;
    expect(automatic).toHaveBeenCalledWith([{ id: 'com.example.plugin' }]);
    expect(Reflect.get(runtime, 'pluginCatalogStatus')).toBe('ready');
  });

  it.each(['signed_out', 'authorizing'])('does not update before account login (%s)', async (status) => {
    const { runtime, automatic } = setup();
    Reflect.set(runtime, 'authStatus', { status });
    await runtime.refreshPluginCatalog();
    expect(automatic).not.toHaveBeenCalled();
  });

  it('does not automatically update the real installation from a development client', async () => {
    const { runtime, automatic } = setup();
    host.isPackaged = false;
    await runtime.refreshPluginCatalog();
    expect(automatic).not.toHaveBeenCalled();
  });

  it('does not treat a failed catalog load as an empty successful synchronization', async () => {
    const { runtime, automatic } = setup();
    Reflect.set(runtime, 'fetchPluginCatalog', vi.fn(async () => { throw new Error('Offline'); }));
    await expect(runtime.refreshPluginCatalog()).rejects.toThrow('Offline');
    expect(automatic).not.toHaveBeenCalled();
  });

  it('waits for delayed entitlement readiness without adding a periodic update timer', async () => {
    const { runtime, automatic } = setup();
    Reflect.set(runtime, 'installedPluginsStatus', 'error');
    await runtime.refreshPluginCatalog({ refreshEntitlements: false });
    expect(automatic).not.toHaveBeenCalled();
    await Reflect.get(runtime, 'refreshInstalledEntitlements').call(runtime);
    expect(automatic).toHaveBeenCalledOnce();
    await Reflect.get(runtime, 'refreshInstalledEntitlements').call(runtime);
    expect(automatic).toHaveBeenCalledOnce();
  });

  it('does not complete an upgrade against expired authorization and resumes after renewal', async () => {
    const { runtime, automatic } = setup();
    Reflect.set(runtime, 'entitlementExpiresAt', 0);
    await runtime.refreshPluginCatalog({ refreshEntitlements: false });
    expect(automatic).not.toHaveBeenCalled();
    Reflect.set(runtime, 'readInstalledEntitlements', vi.fn(async () => {
      Reflect.set(runtime, 'entitlementExpiresAt', Date.now() + 60_000);
    }));
    await Reflect.get(runtime, 'refreshInstalledEntitlements').call(runtime);
    expect(automatic).toHaveBeenCalledOnce();
  });
});
