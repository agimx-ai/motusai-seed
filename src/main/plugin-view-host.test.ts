import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginRpcPeer, type RpcMessage } from '@motus-ai/seed-sdk';
import type { SeedPluginRuntimeDefinition } from '../shared/contracts';
const state = vi.hoisted(() => ({ pick: vi.fn() }));
vi.mock('electron', () => ({ dialog: { showOpenDialog: state.pick } }));
import { SeedPluginViewHost, type PluginViewServices } from './plugin-view-host';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  state.pick.mockReset();
});
async function fixture(id = 'com.example.generic', overrides: Partial<PluginViewServices> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'seed-dom-host-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.js'), 'export const ready = true;');
  let resourceHandler!: (request: Request) => Promise<Response>;
  const session = {
    protocol: {
      handle: vi.fn((_scheme, handler) => {
        resourceHandler = handler;
      }),
    },
  };
  const owner = { isDestroyed: () => false, webContents: { session, send: vi.fn() } } as any;
  const plugin: SeedPluginRuntimeDefinition = {
    installation_id: 'test-installation',
    api_version: 2,
    sdk_manifest: {
      id,
      name: 'Generic',
      author: 'Example',
      version: '1.0.0',
      minAppVersion: '0.2.15',
      description: 'Fixture',
    },
    package_id: id,
    version: '1.0.0',
    publisher_type: 'official',
    runtime_kind: 'native-host',
    root_path: root,
    entry_path: join(root, 'main.js'),
    resources: ['main.js', 'escape.js'],
    sidecars: [],
    permissions: [],
    consumes: [],
    capabilities: [],
  };
  const services: PluginViewServices = {
    loadData: vi.fn(async () => ({ revision: 7, data: { original: true } })),
    saveData: vi.fn(async (_id, data, revision, assertActive) => {
      assertActive();
      return { revision: revision + 1, data };
    }),
    call: vi.fn(async (_id, _method, args) => args),
    ...overrides,
  };
  const host = new SeedPluginViewHost(plugin, services, { locale: 'en-US', theme: 'light' }, vi.fn());
  const token = crypto.randomUUID();
  const configuration = host.mount(owner, token);
  const client = new PluginRpcPeer(
    host.generation,
    (message) => {
      void host.receive(owner, token, message).catch(() => {});
    },
    async () => null,
  );
  owner.webContents.send.mockImplementation((_channel: string, event: any) => {
    if (event.type === 'message') void client.receive(event.message);
    if (event.type === 'stop') client.close();
  });
  cleanup.push(async () => {
    client.close();
    await host.destroy();
  });
  return {
    root,
    host,
    owner,
    token,
    configuration,
    client,
    services,
    resource: (url: string) => resourceHandler(new Request(url)),
  };
}

describe('trusted DOM plugin service/resource broker', () => {
  it('returns generation-owned module resources without constructing any native rendering surface', async () => {
    const { configuration, resource, host } = await fixture();
    expect(configuration.entryUrl).toBe('seed-plugin://' + host.generation + '/main.js');
    expect(configuration.installationId).toBe('test-installation');
    expect(await (await resource(configuration.entryUrl)).text()).toContain('export const ready');
    expect(configuration).not.toHaveProperty('bounds');
    expect(host).not.toHaveProperty('view');
  });
  it('limits resources to declared files and denies symlink escapes, unknown generations and withdrawn packages', async () => {
    const { configuration, resource, host, root } = await fixture();
    const outside = join(root, '../' + host.generation + '.js');
    await writeFile(outside, 'private');
    cleanup.push(() => rm(outside, { force: true }));
    await symlink(outside, join(root, 'escape.js'));
    expect((await resource(new URL('escape.js', configuration.entryUrl).href)).status).toBe(403);
    expect((await resource(new URL('private.json', configuration.entryUrl).href)).status).toBe(403);
    expect((await resource('seed-plugin://unknown/main.js')).status).toBe(403);
    await host.destroy();
    expect((await resource(configuration.entryUrl)).status).toBe(403);
    expect(await readFile(join(root, 'main.js'), 'utf8')).toContain('ready');
  });
  it('does not invent an installation identity for a local development source', async () => {
    const { host, owner, token } = await fixture();
    host.plugin.source = 'development';
    delete host.plugin.installation_id;
    expect(host.mount(owner, token).installationId).toBeUndefined();
  });
  it('binds data and private service calls to the actual plugin and preserves storage revisions', async () => {
    const { client, services } = await fixture();
    expect(await client.call('data.load')).toEqual({ revision: 7, data: { original: true } });
    expect(await client.call('data.save', { data: { kept: true }, revision: 7 })).toEqual({
      revision: 8,
      data: { kept: true },
    });
    await client.call('service.echo', { package_id: 'com.example.forged' });
    expect(services.call).toHaveBeenCalledWith(
      'com.example.generic',
      'echo',
      expect.any(Object),
      expect.any(AbortSignal),
    );
    await expect(client.call('data.save', { revision: -1 })).rejects.toThrow('revision');
  });
  it('rejects other owners/tokens and ignores old RPC generations', async () => {
    const { host, owner, token, services } = await fixture();
    const message: RpcMessage = { generation: host.generation, type: 'call', id: '1', method: 'data.load', args: {} };
    await expect(host.receive({} as any, token, message)).rejects.toThrow('owner');
    await expect(host.receive(owner, 'forged', message)).rejects.toThrow('owner');
    await host.receive(owner, token, { ...message, generation: 'old' });
    expect(services.loadData).not.toHaveBeenCalled();
  });
  it('hides only display resources and keeps private service calls alive', async () => {
    const { host, client } = await fixture();
    host.unmount();
    expect(host.active).toBe(true);
    expect(await client.call('service.echo', { value: 'still running' })).toEqual({ value: 'still running' });
    await expect(client.call('files.pick')).rejects.toThrow('mounted');
  });
  it('propagates cancellation and fences queued writes after generation withdrawal', async () => {
    let release!: () => void;
    let saved = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host, client, services } = await fixture('com.example.generic', {
      saveData: async (_id, data, revision, assertActive) => {
        await gate;
        assertActive();
        saved = true;
        return { data, revision };
      },
      call: vi.fn(
        async (_id, _method, _args, signal) =>
          new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
      ),
    });
    const abort = new AbortController();
    const pending = client.call('service.wait', {}, abort.signal).catch(() => 'cancelled');
    abort.abort();
    expect(await pending).toBe('cancelled');
    expect((services.call as any).mock.calls[0][3].aborted).toBe(true);
    const saving = client.call('data.save', { data: {}, revision: 7 }).catch(() => undefined);
    await host.destroy();
    release();
    await saving;
    expect(saved).toBe(false);
  });
  it('binds reload and file picking to the current owner and drops late picker results', async () => {
    const reloadService = vi.fn(async () => {});
    const { host, owner, client } = await fixture('com.example.generic', { reloadService });
    await client.call('runtime.reload', { package_id: 'forged' });
    expect(reloadService).toHaveBeenCalledExactlyOnceWith('com.example.generic');
    await expect(client.call('files.pick', { extensions: ['../private'] })).rejects.toThrow();
    state.pick.mockResolvedValueOnce({ canceled: false, filePaths: ['/chosen/one.pdf'] });
    expect(await client.call('files.pick', { extensions: ['pdf'] })).toEqual(['/chosen/one.pdf']);
    expect(state.pick).toHaveBeenCalledWith(owner, expect.any(Object));
    let finish!: (value: unknown) => void;
    state.pick.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = client.call('files.pick').catch(() => 'stopped');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await host.destroy();
    finish({ canceled: false, filePaths: ['/late.pdf'] });
    expect(await pending).toBe('stopped');
  });
});
