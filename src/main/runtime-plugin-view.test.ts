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

function fixture() {
  const plugin = { package_id: 'com.example.generic', api_version: 2 };
  const configuration = { generation: 'generation', entryUrl: 'seed-plugin://generation/main.js' };
  const host = {
    plugin,
    active: true,
    mount: vi.fn(() => configuration),
    unmount: vi.fn(),
    owns: vi.fn(() => true),
    receive: vi.fn(async () => {}),
  };
  const owner = { isDestroyed: () => false, webContents: { send: vi.fn() } };
  const runtime = Object.assign(Object.create(SeedRuntime.prototype), {
    runtimePlugins: [plugin],
    pluginIsAuthorized: () => true,
    ensurePluginView: vi.fn(() => host),
    pluginViewHosts: new Map([[plugin.package_id, host]]),
    pluginViewMounts: new Map(),
  });
  const input = { pluginId: plugin.package_id, token: 'mount-one' };
  return { runtime, host, owner, plugin, input, configuration };
}
describe('product page DOM mounting', () => {
  it('creates a broker only when opened and reuses it without starting backend work', async () => {
    const { runtime, owner, plugin, input } = fixture();
    Object.assign(plugin, {
      sdk_manifest: {
        id: plugin.package_id,
        name: 'Generic',
        version: '1.0.0',
        author: 'Example',
        minAppVersion: '0.2.15',
        description: 'Fixture',
      },
      resources: ['main.js'],
      runtime_kind: 'native-host',
      has_service: true,
    });
    Object.assign(owner.webContents, { session: { protocol: { handle: vi.fn() } } });
    runtime.stopping = false;
    runtime.store = { themePreference: () => 'light', languagePreference: () => 'en-US' };
    runtime.nativeHost = { start: vi.fn(), call: vi.fn() };
    runtime.pluginViewHosts.clear();
    delete runtime.ensurePluginView;
    expect(runtime.pluginViewHosts.size).toBe(0);
    const first = runtime.mountPluginView(owner, input);
    const broker = runtime.pluginViewHosts.get(plugin.package_id);
    try {
      const second = runtime.mountPluginView(owner, { ...input, token: 'mount-two' });
      expect(runtime.pluginViewHosts.size).toBe(1);
      expect(runtime.pluginViewHosts.get(plugin.package_id)).toBe(broker);
      expect(first.generation).toBe(second.generation);
      expect(runtime.nativeHost.start).not.toHaveBeenCalled();
      expect(runtime.nativeHost.call).not.toHaveBeenCalled();
    } finally {
      await broker.destroy();
    }
  });
  it('returns a module descriptor synchronously without starting a rendering process', () => {
    const { runtime, host, owner, input, configuration } = fixture();
    expect(runtime.mountPluginView(owner, input)).toEqual(configuration);
    expect(host.mount).toHaveBeenCalledExactlyOnceWith(owner, input.token);
  });
  it('keeps current mounts intact when an older page sends a stale unmount token', () => {
    const { runtime, host, owner, input } = fixture();
    runtime.mountPluginView(owner, input);
    runtime.mountPluginView(owner, { ...input, token: 'mount-two' });
    expect(host.mount).toHaveBeenCalledTimes(2);
    runtime.unmountPluginView(owner, 'mount-one');
    expect(host.unmount).not.toHaveBeenCalled();
    runtime.unmountPluginView(owner, 'mount-two');
    expect(host.unmount).toHaveBeenCalledTimes(1);
  });
  it('dispatches RPC only through an authorized current token owner', async () => {
    const { runtime, host, owner } = fixture();
    const message = { generation: 'generation', type: 'cancel', id: '1' };
    await runtime.sendPluginViewMessage(owner, 'token', message);
    expect(host.receive).toHaveBeenCalledExactlyOnceWith(owner, 'token', message);
    host.owns.mockReturnValue(false);
    await expect(runtime.sendPluginViewMessage(owner, 'stale', message)).rejects.toThrow('unavailable');
    host.owns.mockReturnValue(true);
    runtime.pluginIsAuthorized = () => false;
    await expect(runtime.sendPluginViewMessage(owner, 'token', message)).rejects.toThrow('unavailable');
  });
});
