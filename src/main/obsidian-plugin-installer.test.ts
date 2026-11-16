import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObsidianPluginInstaller, obsidianPluginId } from './obsidian-plugin-installer';

const repository = 'agimx-ai/motusai-obsidian-agent';
const version = '0.1.86';
const distribution = {
  'main.js': 'module.exports = class {};\n',
  'styles.css': 'body { color: inherit; }\n',
  'manifest.json': JSON.stringify({ id: obsidianPluginId, version }),
};

function officialRelease(options: { tamper?: string; beforeAsset?: () => Promise<void> } = {}) {
  return vi.fn(async (url: string) => {
    if (url === `https://api.github.com/repos/${repository}/releases/latest`) {
      return Response.json({
        tag_name: version,
        prerelease: false,
        draft: false,
        assets: Object.entries(distribution).map(([name, content]) => ({
          name,
          size: Buffer.byteLength(content),
          digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
          browser_download_url: `https://github.com/${repository}/releases/download/${version}/${name}`,
        })),
      });
    }
    await options.beforeAsset?.();
    const file = url.split('/').at(-1) as keyof typeof distribution;
    return new Response(file === options.tamper ? distribution[file].replace(/^./, 'X') : distribution[file]);
  });
}

describe('MotusAI for Obsidian installer', () => {
  let root: string;
  let vault: string;
  let plugin: string;
  const activate = vi.fn(async (_path: string, update: boolean) => update ? 'reload' as const : 'enable' as const);

  beforeEach(async () => {
    activate.mockClear();
    root = await mkdtemp(join(tmpdir(), 'seed-obsidian-test-'));
    vault = join(root, 'Test vault');
    await mkdir(join(vault, '.obsidian'), { recursive: true });
    plugin = join(vault, '.obsidian', 'plugins', obsidianPluginId);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const pluginAt = (path: string) => join(path, '.obsidian', 'plugins', obsidianPluginId);

  async function existing(path: string, installedVersion: string) {
    const directory = pluginAt(path);
    await mkdir(directory, { recursive: true });
    await Promise.all([
      writeFile(join(directory, 'manifest.json'), JSON.stringify({ id: obsidianPluginId, version: installedVersion })),
      writeFile(join(directory, 'main.js'), 'old script'),
      writeFile(join(directory, 'styles.css'), 'old styles'),
      writeFile(join(directory, 'data.json'), 'user settings'),
    ]);
  }

  it('installs and updates every registered vault in one batch while downloading each file once', async () => {
    const old = join(root, 'Old vault');
    const newer = join(root, 'Newer vault');
    const missing = join(root, 'Missing vault');
    const unregistered = join(root, 'Unregistered vault');
    const alias = join(root, 'Alias');
    await Promise.all([
      existing(old, '0.1.85'),
      existing(newer, '0.1.87'),
      mkdir(join(unregistered, '.obsidian'), { recursive: true }),
      symlink(vault, alias, 'junction'),
    ]);
    const fetchRelease = officialRelease();
    const service = new ObsidianPluginInstaller(fetchRelease, async () => [vault, old, newer, missing, alias], activate);

    await expect(service.installAll()).resolves.toMatchObject({
      ok: true,
      vaults: expect.arrayContaining([
        { path: expect.any(String), name: 'Test vault', status: 'installed', version, activation: 'enable' },
        { path: expect.any(String), name: 'Old vault', status: 'updated', version, activation: 'reload' },
        { path: expect.any(String), name: 'Newer vault', status: 'current', version: '0.1.87' },
        { path: expect.any(String), name: 'Missing vault', status: 'failed', error: 'invalidVault' },
      ]),
    });
    expect(fetchRelease).toHaveBeenCalledTimes(4);
    expect(activate).toHaveBeenCalledTimes(2);
    expect(await readFile(join(plugin, 'main.js'), 'utf8')).toBe(distribution['main.js']);
    expect(await readFile(join(pluginAt(old), 'data.json'), 'utf8')).toBe('user settings');
    expect(await readFile(join(pluginAt(newer), 'main.js'), 'utf8')).toBe('old script');
    expect(await readdir(join(unregistered, '.obsidian'))).toEqual([]);

    fetchRelease.mockClear();
    await expect(service.installAll()).resolves.toMatchObject({
      ok: true,
      vaults: expect.arrayContaining([expect.objectContaining({ name: 'Test vault', status: 'current', version })]),
    });
    expect(fetchRelease).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it('reports the aggregate action and checks the updated state after installing', async () => {
    const old = join(root, 'Old vault');
    const latest = join(root, 'Current vault');
    await Promise.all([existing(old, '0.1.85'), existing(latest, version)]);
    const paths = [old, latest];
    const fetchRelease = officialRelease();
    const service = new ObsidianPluginInstaller(fetchRelease, async () => paths, activate);

    await expect(service.status()).resolves.toEqual({ state: 'update' });
    expect(fetchRelease).toHaveBeenCalledTimes(1);
    paths.push(vault);
    await expect(service.status()).resolves.toEqual({ state: 'install' });
    expect(fetchRelease).toHaveBeenCalledTimes(1);

    await expect(service.installAll()).resolves.toMatchObject({ ok: true });
    await expect(service.status()).resolves.toEqual({ state: 'current' });
    expect(fetchRelease).toHaveBeenCalledTimes(5);
  });

  it('never reports up to date when release lookup fails', async () => {
    await existing(vault, version);
    const fetchRelease = vi.fn(async () => new Response(null, { status: 503 }));
    const service = new ObsidianPluginInstaller(fetchRelease, async () => [vault], activate);
    await expect(service.status()).resolves.toEqual({ state: 'error', error: 'releaseUnavailable' });
  });

  it('returns an empty result without requesting the release when there are no registered vaults', async () => {
    const fetchRelease = officialRelease();
    const service = new ObsidianPluginInstaller(fetchRelease, async () => [], activate);
    await expect(service.status()).resolves.toEqual({ state: 'noVaults' });
    await expect(service.installAll()).resolves.toEqual({ ok: true, vaults: [] });
    expect(fetchRelease).not.toHaveBeenCalled();
  });

  it('leaves installed files intact when package verification fails', async () => {
    await existing(vault, '0.1.85');
    const service = new ObsidianPluginInstaller(officialRelease({ tamper: 'main.js' }), async () => [vault], activate);
    await expect(service.installAll()).resolves.toEqual({ ok: false, error: 'downloadFailed' });
    expect(await readFile(join(plugin, 'main.js'), 'utf8')).toBe('old script');
    expect(await readFile(join(plugin, 'styles.css'), 'utf8')).toBe('old styles');
    expect(activate).not.toHaveBeenCalled();
  });

  it('shares concurrent requests and continues after a vault changes during the download', async () => {
    const other = join(root, 'Other vault');
    await mkdir(join(other, '.obsidian'), { recursive: true });
    const changeVault = vi.fn(async () => existing(vault, '0.1.87'));
    let changing: Promise<void> | undefined;
    const fetchRelease = officialRelease({ beforeAsset: () => { changing ??= changeVault(); return changing; } });
    const service = new ObsidianPluginInstaller(fetchRelease, async () => [vault, other], activate);
    const install = service.installAll();
    expect(service.installAll()).toBe(install);
    await expect(install).resolves.toMatchObject({
      ok: true,
      vaults: [
        { name: 'Test vault', status: 'failed', error: 'changed' },
        { name: 'Other vault', status: 'installed', version },
      ],
    });
    expect(await readFile(join(plugin, 'main.js'), 'utf8')).toBe('old script');
    expect(changeVault).toHaveBeenCalledTimes(1);
  });

  it('uses the official release page hashes when the API rate limit is reached', async () => {
    const release = officialRelease();
    const page = `https://github.com/${repository}/releases`;
    const fetchRelease = async (url: string) => {
      if (url.startsWith('https://api.github.com/')) return new Response('rate limit', { status: 403 });
      if (url === `${page}/latest`) {
        return new Response(`<include-fragment src="${page}/expanded_assets/${version}"></include-fragment>`);
      }
      if (url === `${page}/expanded_assets/${version}`) {
        return new Response(Object.entries(distribution).map(([name, content]) => `
          <li><a href="/${repository}/releases/download/${version}/${name}">${name}</a>
          <clipboard-copy value="sha256:${createHash('sha256').update(content).digest('hex')}"></clipboard-copy></li>
        `).join(''));
      }
      return release(url);
    };
    const service = new ObsidianPluginInstaller(fetchRelease, async () => [vault], activate);
    await expect(service.installAll()).resolves.toMatchObject({ ok: true, vaults: [{ status: 'installed', version }] });
    expect(await readFile(join(plugin, 'main.js'), 'utf8')).toBe(distribution['main.js']);
  });

  it('rejects a symlink substituting for the plugin directory', async () => {
    await mkdir(join(vault, '.obsidian', 'plugins'));
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, plugin, 'junction');
    const fetchRelease = officialRelease();
    const service = new ObsidianPluginInstaller(fetchRelease, async () => [vault], activate);
    await expect(service.status()).resolves.toEqual({ state: 'error', error: 'invalidVaults' });
    await expect(service.installAll()).resolves.toMatchObject({
      ok: true,
      vaults: [{ name: 'Test vault', status: 'failed', error: 'invalidInstallation' }],
    });
    expect(fetchRelease).not.toHaveBeenCalled();
    expect(await readdir(outside)).toEqual([]);
  });
});
