import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObsidianPluginInstaller, obsidianPluginId } from './obsidian-plugin-installer';

const cloudUrl = 'https://seed-cloud.example';
const releaseBase = `${cloudUrl}/api/v1/obsidian-plugin/releases`;
const version = '0.1.86';
const distribution = {
  'main.js': 'module.exports = class {};\n',
  'styles.css': 'body { color: inherit; }\n',
  'manifest.json': JSON.stringify({ id: obsidianPluginId, version }),
};

function officialRelease(options: { tamper?: string; beforeAsset?: () => Promise<void> } = {}) {
  return vi.fn(async (url: string) => {
    if (url === `${releaseBase}/latest`) {
      return Response.json({
        version,
        assets: Object.entries(distribution).map(([name, content]) => ({
          name,
          size: Buffer.byteLength(content),
          sha256: createHash('sha256').update(content).digest('hex'),
          url: 'https://untrusted.example/asset',

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

  beforeEach(async () => {
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
    const service = new ObsidianPluginInstaller(cloudUrl, fetchRelease, async () => [vault, old, newer, missing, alias]);

    await expect(service.installAll()).resolves.toMatchObject({
      ok: true,
      vaults: expect.arrayContaining([
        { path: expect.any(String), name: 'Test vault', status: 'installed', version },
        { path: expect.any(String), name: 'Old vault', status: 'updated', version },
        { path: expect.any(String), name: 'Newer vault', status: 'current', version: '0.1.87' },
        { path: expect.any(String), name: 'Missing vault', status: 'failed', error: 'invalidVault' },
      ]),
    });
    expect(fetchRelease).toHaveBeenCalledTimes(4);
    expect(await readFile(join(plugin, 'main.js'), 'utf8')).toBe(distribution['main.js']);
    await expect(readFile(join(plugin, 'seed-update.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(join(pluginAt(old), 'seed-update.json'), 'utf8'))).toEqual({ version });
    expect(await readFile(join(pluginAt(old), 'data.json'), 'utf8')).toBe('user settings');
    expect(await readFile(join(pluginAt(newer), 'main.js'), 'utf8')).toBe('old script');
    expect(await readdir(join(unregistered, '.obsidian'))).toEqual([]);

    fetchRelease.mockClear();
    await expect(service.installAll()).resolves.toMatchObject({
      ok: true,
      vaults: expect.arrayContaining([expect.objectContaining({ name: 'Test vault', status: 'current', version })]),
    });
    expect(fetchRelease).toHaveBeenCalledTimes(1);
  });

  it('reports the aggregate action and checks the updated state after installing', async () => {
    const old = join(root, 'Old vault');
    const latest = join(root, 'Current vault');
    await Promise.all([existing(old, '0.1.85'), existing(latest, version)]);
    const paths = [vault];
    const fetchRelease = officialRelease();
    const service = new ObsidianPluginInstaller(cloudUrl, fetchRelease, async () => paths);

    await expect(service.status()).resolves.toEqual({ state: 'install', updateAvailable: false });
    expect(fetchRelease).not.toHaveBeenCalled();
    paths.push(latest, old);
    const installedVersions = ['0.1.85', version];
    await expect(service.status()).resolves.toEqual({ state: 'install', updateAvailable: true, installedVersions, targetVersion: version });
    expect(fetchRelease).toHaveBeenCalledTimes(1);
    paths.shift();
    await expect(service.status()).resolves.toEqual({ state: 'update', installedVersions, targetVersion: version });
    expect(fetchRelease).toHaveBeenCalledTimes(1);

    paths.push(vault);
    await expect(service.installAll()).resolves.toMatchObject({ ok: true });
    await expect(service.status()).resolves.toEqual({ state: 'current', installedVersions: [version] });
    expect(fetchRelease).toHaveBeenCalledTimes(5);
  });

  it('never reports up to date when release lookup fails', async () => {
    await existing(vault, version);
    const fetchRelease = vi.fn(async () => new Response(null, { status: 503 }));
    const service = new ObsidianPluginInstaller(cloudUrl, fetchRelease, async () => [vault]);
    await expect(service.status()).resolves.toEqual({ state: 'error', error: 'releaseUnavailable', installedVersions: [version] });
  });

  it('returns an empty result without requesting the release when there are no registered vaults', async () => {
    const fetchRelease = officialRelease();
    const service = new ObsidianPluginInstaller(cloudUrl, fetchRelease, async () => []);
    await expect(service.status()).resolves.toEqual({ state: 'noVaults' });
    await expect(service.installAll()).resolves.toEqual({ ok: true, vaults: [] });
    expect(fetchRelease).not.toHaveBeenCalled();
  });

  it('leaves installed files intact when package verification fails', async () => {
    await existing(vault, '0.1.85');
    const service = new ObsidianPluginInstaller(cloudUrl, officialRelease({ tamper: 'main.js' }), async () => [vault]);
    await expect(service.installAll()).resolves.toEqual({ ok: false, error: 'downloadFailed' });
    expect(await readFile(join(plugin, 'main.js'), 'utf8')).toBe('old script');
    expect(await readFile(join(plugin, 'styles.css'), 'utf8')).toBe('old styles');
    await expect(readFile(join(plugin, 'seed-update.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rolls back the distribution when it cannot publish the reload marker', async () => {
    await existing(vault, '0.1.85');
    await mkdir(join(plugin, 'seed-update.json'));
    const service = new ObsidianPluginInstaller(cloudUrl, officialRelease(), async () => [vault]);
    await expect(service.installAll()).resolves.toMatchObject({
      ok: true,
      vaults: [{ name: 'Test vault', status: 'failed', error: 'installFailed' }],
    });
    expect(await readFile(join(plugin, 'main.js'), 'utf8')).toBe('old script');
    expect(JSON.parse(await readFile(join(plugin, 'manifest.json'), 'utf8')).version).toBe('0.1.85');
  });

  it('shares concurrent requests and continues after a vault changes during the download', async () => {
    const other = join(root, 'Other vault');
    await mkdir(join(other, '.obsidian'), { recursive: true });
    const changeVault = vi.fn(async () => existing(vault, '0.1.87'));
    let changing: Promise<void> | undefined;
    const fetchRelease = officialRelease({ beforeAsset: () => { changing ??= changeVault(); return changing; } });
    const service = new ObsidianPluginInstaller(cloudUrl, fetchRelease, async () => [vault, other]);
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

  it('pins version checks and all asset downloads to Seed Cloud and rejects redirects', async () => {
    const fixture = officialRelease();
    const fetchRelease = vi.fn((url: string, options?: RequestInit) => {
      if (url === `${releaseBase}/${version}/main.js`)
        return Promise.resolve(Response.redirect('https://untrusted.example/asset', 302));
      return fixture(url);
    });
    const service = new ObsidianPluginInstaller(cloudUrl, fetchRelease, async () => [vault]);
    await expect(service.installAll()).resolves.toEqual({ ok: false, error: 'downloadFailed' });
    expect(fetchRelease.mock.calls.map(([url]) => url).sort()).toEqual([
      `${releaseBase}/latest`,
      ...Object.keys(distribution).map((name) => `${releaseBase}/${version}/${name}`),
    ].sort());
    expect(fetchRelease.mock.calls.every(([, options]) => options?.redirect === 'error')).toBe(true);
    expect(await readdir(join(vault, '.obsidian'))).toEqual([]);
  });

  it('reads fresh Cloud metadata after the release cache is invalidated', async () => {
    await existing(vault, version);
    const fixture = officialRelease();
    let current = version;
    const fetchRelease = vi.fn(async (url: string) => {
      const response = await fixture(url);
      const metadata = await response.json();
      return Response.json({ ...metadata, version: current });
    });
    const service = new ObsidianPluginInstaller(cloudUrl, fetchRelease, async () => [vault]);
    await expect(service.status()).resolves.toEqual({ state: 'current', installedVersions: [version] });
    current = '0.1.87';
    service.invalidateRelease();
    await expect(service.status()).resolves.toEqual({ state: 'update', installedVersions: [version], targetVersion: current });
    expect(fetchRelease).toHaveBeenCalledTimes(2);
  });

  it('rejects a symlink substituting for the plugin directory', async () => {
    await mkdir(join(vault, '.obsidian', 'plugins'));
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, plugin, 'junction');
    const fetchRelease = officialRelease();
    const service = new ObsidianPluginInstaller(cloudUrl, fetchRelease, async () => [vault]);
    await expect(service.status()).resolves.toEqual({ state: 'error', error: 'invalidVaults' });
    await expect(service.installAll()).resolves.toMatchObject({
      ok: true,
      vaults: [{ name: 'Test vault', status: 'failed', error: 'invalidInstallation' }],
    });
    expect(fetchRelease).not.toHaveBeenCalled();
    expect(await readdir(outside)).toEqual([]);
  });
});
