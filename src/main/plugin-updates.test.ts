import { describe, expect, it, vi } from 'vitest';
import type { SeedCatalogPlugin, SeedInstalledPlugin } from '../shared/contracts';
import { PluginUpdates } from './plugin-updates';

const installed = (id: string, patch: Partial<SeedInstalledPlugin> = {}) => ({
  id, version: '1.0.0', status: 'ready', source: 'installed', enabled: true,
  name: { en_US: id, zh_Hans: id }, ...patch,
}) as SeedInstalledPlugin;
const catalog = (id: string, patch: Partial<SeedCatalogPlugin> = {}) => ({
  id, name: { en_US: id, zh_Hans: id }, latestVersion: '2.0.0', compatible: true,
  publisherType: 'official', versions: [{ version: '2.0.0', runtimeKind: 'native-host' }], ...patch,
}) as SeedCatalogPlugin;

function setup() {
  const checkpoints = new Map<string, unknown>();
  let account: string | undefined = 'alice';
  let automaticEnabled = true;
  let local = [installed('first'), installed('second')];
  let offered = [catalog('first'), catalog('second')];
  const install = vi.fn(async (id: string, version: string, _signal: AbortSignal) => {
    local = local.map((plugin) => plugin.id === id ? { ...plugin, version, status: 'ready' } : plugin);
    return true;
  });
  const options = {
    appVersion: '0.3.6', account: () => account, installed: () => local, canUpdate: vi.fn(() => true),
    automaticEnabled: () => automaticEnabled,
    refreshCatalog: vi.fn(async () => offered),
    read: vi.fn(async (key: string) => structuredClone(checkpoints.get(key))),
    write: vi.fn(async (key: string, value: unknown) => { checkpoints.set(key, structuredClone(value)); }),
    install, changed: vi.fn(),
  };
  return {
    options, checkpoints, install, create: (version = options.appVersion) => new PluginUpdates({ ...options, appVersion: version }),
    offered: () => offered,
    setCatalog: (value: SeedCatalogPlugin[]) => { offered = value; },
    setInstalled: (value: SeedInstalledPlugin[]) => { local = value; },
    setAccount: (value: string | undefined) => { account = value; },
    setAutomaticEnabled: (value: boolean) => { automaticEnabled = value; },
  };
}

describe('PluginUpdates', () => {
  it('does not read or mark automatic completion when disabled, while allowing manual updates', async () => {
    const h = setup();
    h.setAutomaticEnabled(false);
    const coordinator = h.create();
    await coordinator.automatic(h.offered());
    expect(h.options.read).not.toHaveBeenCalled();
    expect(h.options.write).not.toHaveBeenCalled();
    expect(h.install).not.toHaveBeenCalled();
    await coordinator.updateAll();
    expect(h.install).toHaveBeenCalledTimes(2);
  });

  it('cancels automatic downloads without discarding pending items and resumes after re-enabling', async () => {
    const h = setup();
    h.install.mockImplementationOnce((_id, _version, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve(false), { once: true });
    }));
    const coordinator = h.create();
    const work = coordinator.automatic(h.offered());
    await vi.waitFor(() => expect(h.install).toHaveBeenCalledOnce());
    h.setAutomaticEnabled(false);
    coordinator.stopAutomatic();
    await work;
    expect(h.checkpoints.get('alice')).toEqual({ appVersion: '0.3.6', pending: ['first', 'second'] });
    expect(coordinator.snapshot()).toEqual({ running: false });
    h.setAutomaticEnabled(true);
    await coordinator.automatic(h.offered());
    expect(h.install.mock.calls.map(([id]) => id)).toEqual(['first', 'first', 'second']);
    await coordinator.automatic(h.offered());
    expect(h.install).toHaveBeenCalledTimes(3);
  });

  it('finishes an atomic installation before continuing a quickly re-enabled batch', async () => {
    const h = setup();
    let finish!: (value: boolean) => void;
    h.install.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const coordinator = h.create();
    const work = coordinator.automatic(h.offered());
    await vi.waitFor(() => expect(h.install).toHaveBeenCalledOnce());
    h.setAutomaticEnabled(false);
    coordinator.stopAutomatic();
    h.setAutomaticEnabled(true);
    const resumed = coordinator.automatic(h.offered());
    h.setInstalled([installed('first', { version: '2.0.0' }), installed('second')]);
    finish(true);
    await Promise.all([work, resumed]);
    expect(h.install.mock.calls.map(([id]) => id)).toEqual(['first', 'second']);
    expect(h.checkpoints.get('alice')).toEqual({ appVersion: '0.3.6', pending: [] });
  });

  it('does not cancel a manual batch when automatic updates are disabled', async () => {
    const h = setup();
    let finish!: (value: boolean) => void;
    h.install.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const coordinator = h.create();
    const work = coordinator.updateAll();
    await vi.waitFor(() => expect(h.install).toHaveBeenCalledOnce());
    h.setAutomaticEnabled(false);
    coordinator.stopAutomatic();
    expect(h.install.mock.calls[0][2].aborted).toBe(false);
    finish(true);
    await work;
    expect(h.install.mock.calls.map(([id]) => id)).toEqual(['first', 'second']);
  });

  it('updates installed plugins once per app version, including across restart', async () => {
    const h = setup();
    await h.create().automatic(h.offered());
    expect(h.install.mock.calls.map(([id]) => id)).toEqual(['first', 'second']);
    expect(h.options.refreshCatalog).not.toHaveBeenCalled();
    expect(h.checkpoints.get('alice')).toEqual({ appVersion: '0.3.6', pending: [] });
    h.setCatalog([catalog('first', { latestVersion: '3.0.0', versions: [{ version: '3.0.0', runtimeKind: 'native-host' }] as SeedCatalogPlugin['versions'] })]);
    await h.create().automatic(h.offered());
    expect(h.install).toHaveBeenCalledTimes(2);
    await h.create('0.3.7').automatic(h.offered());
    expect(h.install).toHaveBeenCalledTimes(3);
    expect(h.install.mock.lastCall?.slice(0, 2)).toEqual(['first', '3.0.0']);
  });

  it('does not install catalog plugins for a new user or touch development plugins', async () => {
    const h = setup();
    h.setInstalled([installed('first', { source: 'development' })]);
    await h.create().automatic(h.offered());
    expect(h.install).not.toHaveBeenCalled();
    h.setAccount('bob');
    h.setInstalled([]);
    await h.create().automatic(h.offered());
    expect(h.install).not.toHaveBeenCalled();
    expect(h.checkpoints.get('bob')).toEqual({ appVersion: '0.3.6', pending: [] });
  });

  it('does no work before login and isolates completion by account', async () => {
    const h = setup();
    h.setAccount(undefined);
    await h.create().automatic(h.offered());
    expect(h.options.read).not.toHaveBeenCalled();
    h.setAccount('alice');
    await h.create().automatic(h.offered());
    h.setInstalled([installed('first')]);
    h.setAccount('bob');
    await h.create().automatic(h.offered());
    expect(h.install).toHaveBeenCalledTimes(3);
    expect(h.checkpoints.size).toBe(2);
  });

  it('stops the previous account batch and runs a queued account independently', async () => {
    const h = setup();
    let finish!: (value: boolean) => void;
    h.install.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const coordinator = h.create();
    const first = coordinator.automatic(h.offered());
    await vi.waitFor(() => expect(h.install).toHaveBeenCalledOnce());
    h.setAccount('bob');
    h.setInstalled([installed('first', { version: '2.0.0' }), installed('second')]);
    const second = coordinator.automatic(h.offered());
    finish(true);
    await Promise.all([first, second]);
    expect(h.checkpoints.get('alice')).toEqual({ appVersion: '0.3.6', pending: ['second'] });
    expect(h.checkpoints.get('bob')).toEqual({ appVersion: '0.3.6', pending: [] });
    expect(h.install.mock.calls.map(([id]) => id)).toEqual(['first', 'second']);
  });

  it('continues after failure and cancellation, then resumes only failed items', async () => {
    const h = setup();
    h.setInstalled([installed('first'), installed('second'), installed('third')]);
    h.setCatalog([catalog('first'), catalog('second'), catalog('third')]);
    h.install.mockRejectedValueOnce(new Error('Download failed')).mockResolvedValueOnce(false);
    const first = h.create();
    await first.automatic(h.offered());
    expect(first.snapshot().result).toMatchObject({ updated: 1, cancelled: 1, failed: [{ pluginId: 'first', reason: 'Download failed' }] });
    expect(h.checkpoints.get('alice')).toEqual({ appVersion: '0.3.6', pending: ['first'] });
    await h.create().automatic(h.offered());
    expect(h.install.mock.calls.map(([id]) => id)).toEqual(['first', 'second', 'third', 'first']);
    expect(h.checkpoints.get('alice')).toEqual({ appVersion: '0.3.6', pending: [] });
  });

  it('waits for each installation and coalesces manual and automatic requests', async () => {
    const h = setup();
    let finish!: (value: boolean) => void;
    h.install.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const coordinator = h.create();
    const first = coordinator.automatic(h.offered());
    await vi.waitFor(() => expect(h.install).toHaveBeenCalledOnce());
    expect(coordinator.snapshot().running).toBe(true);
    expect(coordinator.updateAll()).toBe(first);
    finish(true);
    await first;
    expect(h.install.mock.calls.map(([id]) => id)).toEqual(['first', 'second']);
    expect(coordinator.snapshot().running).toBe(false);
  });

  it('does not mark a failed catalog request complete and allows a later retry', async () => {
    const h = setup();
    h.options.refreshCatalog.mockRejectedValueOnce(new Error('Offline'));
    const coordinator = h.create();
    await coordinator.updateAll();
    expect(coordinator.snapshot().result?.error).toBe('Offline');
    expect(h.options.write).not.toHaveBeenCalled();
    await coordinator.automatic(h.offered());
    expect(h.install).toHaveBeenCalledTimes(2);
  });

  it('keeps incompatible plugins pending until a compatible release is available', async () => {
    const h = setup();
    h.setInstalled([installed('first', { status: 'incompatible', enabled: false })]);
    await h.create().automatic([catalog('first', { compatible: false })]);
    expect(h.install).not.toHaveBeenCalled();
    expect(h.checkpoints.get('alice')).toEqual({ appVersion: '0.3.6', pending: ['first'] });
    await h.create().automatic(h.offered());
    expect(h.install).toHaveBeenCalledOnce();
  });

  it('does not discard a pending update that is temporarily absent from the catalog', async () => {
    const h = setup();
    h.checkpoints.set('alice', { appVersion: '0.3.6', pending: ['first'] });
    await h.create().automatic([]);
    expect(h.checkpoints.get('alice')).toEqual({ appVersion: '0.3.6', pending: ['first'] });
    expect(h.install).not.toHaveBeenCalled();
    await h.create().automatic(h.offered());
    expect(h.install.mock.calls.map(([id]) => id)).toEqual(['first']);
  });

  it('keeps existing pending items when their entitlement temporarily expires', async () => {
    const h = setup();
    h.checkpoints.set('alice', { appVersion: '0.3.6', pending: ['first'] });
    h.options.canUpdate.mockReturnValue(false);
    await h.create().automatic(h.offered());
    expect(h.install).not.toHaveBeenCalled();
    expect(h.checkpoints.get('alice')).toEqual({ appVersion: '0.3.6', pending: ['first'] });
    h.options.canUpdate.mockReturnValue(true);
    await h.create().automatic(h.offered());
    expect(h.install).toHaveBeenCalledOnce();
  });

  it('removes uninstalled targets and catches up with individually completed updates', async () => {
    const h = setup();
    h.checkpoints.set('alice', { appVersion: '0.3.6', pending: ['first', 'second'] });
    h.setInstalled([installed('second', { version: '2.0.0' })]);
    await h.create().automatic(h.offered());
    expect(h.install).not.toHaveBeenCalled();
    expect(h.checkpoints.get('alice')).toEqual({ appVersion: '0.3.6', pending: [] });
  });

  it('aborts work on shutdown and retains pending items for the next launch', async () => {
    const h = setup();
    h.install.mockImplementationOnce((_id, _version, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve(false), { once: true });
    }));
    const coordinator = h.create();
    const work = coordinator.automatic(h.offered());
    await vi.waitFor(() => expect(h.install).toHaveBeenCalledOnce());
    await coordinator.stop();
    await work;
    expect(coordinator.snapshot()).toEqual({ running: false });
    expect(h.install).toHaveBeenCalledOnce();
    expect(h.checkpoints.get('alice')).toEqual({ appVersion: '0.3.6', pending: ['first', 'second'] });
    await h.create().automatic(h.offered());
    expect(h.install.mock.calls.map(([id]) => id)).toEqual(['first', 'first', 'second']);
  });

  it('allows manual updates after automatic completion without resetting that completion', async () => {
    const h = setup();
    h.checkpoints.set('alice', { appVersion: '0.3.6', pending: [] });
    await h.create().updateAll();
    expect(h.options.refreshCatalog).toHaveBeenCalledOnce();
    expect(h.install).toHaveBeenCalledTimes(2);
    await h.create().automatic(h.offered());
    expect(h.install).toHaveBeenCalledTimes(2);
  });

  it('does not rewrite completion on client downgrade or overwrite corrupt saved state', async () => {
    const h = setup();
    h.checkpoints.set('alice', { appVersion: '0.3.7', pending: [] });
    await h.create().automatic(h.offered());
    expect(h.install).not.toHaveBeenCalled();
    expect(h.options.write).not.toHaveBeenCalled();
    h.checkpoints.set('alice', { appVersion: 'invalid', pending: [] });
    const coordinator = h.create();
    await coordinator.automatic(h.offered());
    expect(coordinator.snapshot().result?.error).toBeTruthy();
    expect(h.options.write).not.toHaveBeenCalled();
  });
});
