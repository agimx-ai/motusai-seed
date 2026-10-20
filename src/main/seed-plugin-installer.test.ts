import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeJsonPluginManifest, seedPluginJsonManifestSchema } from '../shared/plugin-json-manifest';
import { responseBuffer, SeedPluginInstaller } from './seed-plugin-installer';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function createInstaller(userData: string, currentSeedVersion = '0.1.67') {
  let state: unknown;
  return {
    installer: new SeedPluginInstaller(
      userData,
      'https://example.test',
      {
        read: async () => state,
        write: async (nextState) => {
          state = structuredClone(nextState);
        },
      },
      currentSeedVersion,
    ),
    state: () => state as { plugins: Array<{ active_version: string; versions: Array<{ version: string }> }> },
  };
}

function createFailingInstaller(userData: string) {
  let state: unknown;
  let rejectWrites = false;
  return {
    installer: new SeedPluginInstaller(
      userData,
      'https://example.test',
      {
        read: async () => state,
        write: async (nextState) => {
          if (rejectWrites) throw new Error('state write failed');
          state = structuredClone(nextState);
        },
      },
      '0.1.67',
    ),
    rejectWrites: () => {
      rejectWrites = true;
    },
  };
}

const icon = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const main = Buffer.from('export const seedPluginBundleVersion = 2; export function loadView() {}');
const hash = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const manifestSource = JSON.stringify(
  {
    id: 'com.example.seed.clock',
    name: { $t: 'plugin.name' },
    description: { $t: 'plugin.description' },
    author: 'com.example',
    version: '1.0.0',
    minAppVersion: '0.1.67',
    apiVersion: 2,
    runtime: 'sandboxed-web',
    service: false,
    icon: 'assets/icon.svg',
    iconDark: 'assets/icon-dark.svg',
    i18n: { defaultLocale: 'en-US', resources: { 'en-US': 'locales/en-US.json', 'zh-CN': 'locales/zh-CN.json' } },
    resources: [],
  },
  null,
  2,
);
function packageFiles(source: string) {
  const files = new Map([
    ['main.js', main],
    ['assets/icon.svg', icon],
    ['assets/icon-dark.svg', icon],
    [
      'locales/en-US.json',
      Buffer.from(JSON.stringify({ plugin: { name: 'Local Clock', description: 'Read the current device time.' } })),
    ],
    [
      'locales/zh-CN.json',
      Buffer.from(JSON.stringify({ plugin: { name: '本地时钟', description: '读取当前设备时间。' } })),
    ],
  ]);
  const document = {
    ...JSON.parse(source),
    resources: [...files].map(([path, body]) => ({ path, sha256: hash(body) })),
  };
  files.set('manifest.json', Buffer.from(JSON.stringify(document)));
  return files;
}
function resolvedManifest(version = '1.0.0') {
  const files = packageFiles(manifestSource.replace('"version": "1.0.0"', '"version": "' + version + '"'));
  return normalizeJsonPluginManifest(
    seedPluginJsonManifestSchema.parse(JSON.parse(files.get('manifest.json')!.toString())),
    {
      defaultLocale: 'en-US',
      resources: {
        'en-US': JSON.parse(files.get('locales/en-US.json')!.toString()),
        'zh-CN': JSON.parse(files.get('locales/zh-CN.json')!.toString()),
      },
    },
  );
}

describe('Seed plugin installer', () => {
  it('upgrades the same plugin identity to v2 without moving its private data and anchors installed hashes outside the package', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-v2-upgrade-'));
    temporaryDirectories.push(userData);
    const { installer, state } = createInstaller(userData, '0.2.15');
    await installer.install(
      {
        manifest: resolvedManifest(),
        packageSha256: 'a'.repeat(64),
        files: packageFiles(manifestSource),
      },
      { publisherType: 'official' },
    );
    const privateRoot = join(userData, 'plugin-data/com.example.seed.clock');
    await mkdir(privateRoot, { recursive: true });
    await writeFile(join(privateRoot, 'session.json'), '{"pending":true}');
    const main = Buffer.from(
      'export const seedPluginBundleVersion = 2; export function loadView() {} export function loadService() {}',
    );
    const document = {
      id: 'com.example.seed.clock',
      name: 'Clock',
      description: 'Clock',
      author: 'Example',
      version: '1.0.1',
      minAppVersion: '0.2.15',
      apiVersion: 2,
      runtime: 'native-host',
      service: true,
      resources: [{ path: 'main.js', sha256: createHash('sha256').update(main).digest('hex') }],
    };
    const files = new Map([
      ['manifest.json', Buffer.from(JSON.stringify(document))],
      ['main.js', main],
    ]);
    await installer.install(
      {
        manifest: normalizeJsonPluginManifest(seedPluginJsonManifestSchema.parse(document)),
        packageSha256: 'b'.repeat(64),
        files,
      },
      { publisherType: 'official', labels: ['utilities'] },
    );
    expect((await installer.listInstalled())[0]).toMatchObject({
      id: document.id,
      version: '1.0.1',
      publisher: 'Example',
      labels: ['utilities'],
    });
    const restarted = new SeedPluginInstaller(
      userData,
      'https://example.test',
      {
        read: async () => state(),
        write: async () => {
          throw new Error('Unexpected state write');
        },
      },
      '0.2.15',
    );
    expect((await restarted.listInstalled())[0]).toMatchObject({ labels: ['utilities'], publisher: 'Example' });
    expect((await installer.listRuntimePlugins())[0]).toMatchObject({
      api_version: 2,
      package_id: document.id,
      entry_path: await realpath(join(userData, 'plugins/installed', document.id, document.version, 'main.js')),
    });
    expect(await readFile(join(privateRoot, 'session.json'), 'utf8')).toBe('{"pending":true}');
    const installed = join(userData, 'plugins/installed', document.id, document.version);
    const changed = Buffer.from('changed together with its self-declared hash');
    document.resources[0].sha256 = createHash('sha256').update(changed).digest('hex');
    await writeFile(join(installed, 'main.js'), changed);
    await writeFile(join(installed, 'manifest.json'), JSON.stringify(document));
    expect(await installer.listRuntimePlugins()).toEqual([]);
    expect(await readFile(join(privateRoot, 'session.json'), 'utf8')).toBe('{"pending":true}');
  });
  it('reports streamed download progress from the response body', async () => {
    const progress: Array<{ transferred: number; total: number; percent: number }> = [];
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4, 5]));
          controller.close();
        },
      }),
      { headers: { 'Content-Length': '5' } },
    );

    await expect(responseBuffer(response, 10, { onProgress: (value) => progress.push(value) })).resolves.toEqual(
      Buffer.from([1, 2, 3, 4, 5]),
    );
    expect(progress).toEqual([
      { transferred: 0, total: 5, percent: 0 },
      { transferred: 2, total: 5, percent: 40 },
      { transferred: 5, total: 5, percent: 100 },
    ]);
  });

  it('cancels a streamed download before reading the next chunk', async () => {
    const abortController = new AbortController();
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          abortController.abort();
        },
      }),
      { headers: { 'Content-Length': '4' } },
    );

    await expect(responseBuffer(response, 10, { signal: abortController.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('keeps installed packages but excludes plugins without a current Cloud entitlement from runtime', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-entitlement-test-'));
    temporaryDirectories.push(userData);
    const { installer } = createInstaller(userData);
    await installer.install(
      {
        manifest: resolvedManifest(),
        packageSha256: 'a'.repeat(64),
        files: packageFiles(manifestSource),
      },
      { enabled: true, visibility: 'organization' },
    );

    expect((await installer.listInstalled())[0]).toMatchObject({
      visibility: 'organization',
    });
    await expect(installer.listRuntimePlugins(new Set())).resolves.toEqual([]);
    await expect(installer.listRuntimePlugins(new Set(['com.example.seed.clock']))).resolves.toHaveLength(1);
    await installer.syncEntitlements([{ plugin_id: 'com.example.seed.clock', visibility: 'public' }]);
    expect((await installer.listInstalled())[0]).toMatchObject({ visibility: 'public' });
  });
  it('requires Sidecars to stay in their package directory and declare process permission', () => {
    const base = JSON.parse(packageFiles(manifestSource).get('manifest.json')!.toString());
    base.resources.push({ path: 'sidecars/clock', sha256: 'a'.repeat(64) });
    base.sidecars = [{ id: 'clock', path: 'sidecars/clock', executable: true }];
    expect(() => seedPluginJsonManifestSchema.parse(base)).toThrow(/process.sidecar/);
    expect(seedPluginJsonManifestSchema.parse({ ...base, permissions: ['process.sidecar'] }).sidecars).toHaveLength(1);
    expect(() =>
      seedPluginJsonManifestSchema.parse({
        ...base,
        permissions: ['process.sidecar'],
        sidecars: [{ id: 'clock', path: 'bin/clock', executable: true }],
      }),
    ).toThrow();
  });

  it('commits an explicitly approved package atomically and enables it', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-test-'));
    temporaryDirectories.push(userData);
    const packageSha256 = 'a'.repeat(64);
    const { installer, state } = createInstaller(userData);
    await installer.install(
      {
        manifest: resolvedManifest(),
        packageSha256,
        files: packageFiles(manifestSource),
      },
      { publisherType: 'community', source: 'marketplace', enabled: true },
    );

    const installed = await installer.listInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0]).toMatchObject({
      id: 'com.example.seed.clock',
      version: '1.0.0',
      source: 'installed',
      publisherType: 'community',
      enabled: true,
    });
    expect(
      createHash('sha256')
        .update(await readFile(join(userData, 'plugins/installed/com.example.seed.clock/1.0.0/manifest.json')))
        .digest('hex'),
    ).toHaveLength(64);
    expect(state().plugins[0]?.active_version).toBe('1.0.0');
  });

  it('rejects an update requiring a newer Seed without replacing the installed version', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-minimum-test-'));
    temporaryDirectories.push(userData);
    const { installer, state } = createInstaller(userData);
    await installer.install({
      manifest: resolvedManifest(),
      packageSha256: 'a'.repeat(64),
      files: packageFiles(manifestSource),
    });
    await expect(
      installer.install({
        manifest: { ...resolvedManifest('1.1.0'), minSeedVersion: '0.1.68' },
        packageSha256: 'b'.repeat(64),
        files: packageFiles(
          manifestSource
            .replace('"version": "1.0.0"', '"version": "1.1.0"')
            .replace('"minAppVersion": "0.1.67"', '"minAppVersion": "0.1.68"'),
        ),
      }),
    ).rejects.toThrow('Seed 0.1.68');
    expect(state().plugins[0]?.active_version).toBe('1.0.0');
    expect(await installer.listRuntimePlugins()).toHaveLength(1);
  });

  it('retains an installed plugin after client downgrade without starting it', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-downgrade-test-'));
    temporaryDirectories.push(userData);
    const { installer, state } = createInstaller(userData);
    await installer.install({
      manifest: resolvedManifest(),
      packageSha256: 'a'.repeat(64),
      files: packageFiles(manifestSource),
    });
    const downgraded = new SeedPluginInstaller(
      userData,
      'https://example.test',
      {
        read: async () => state(),
        write: async () => {
          throw new Error('downgrade must not modify installed state');
        },
      },
      '0.1.66',
    );
    expect(await downgraded.listInstalled()).toEqual([
      expect.objectContaining({
        status: 'incompatible',
        enabled: false,
        incompatibilityReason: expect.stringContaining('Seed 0.1.67'),
      }),
    ]);
    expect(await downgraded.listRuntimePlugins()).toEqual([]);
    expect(state().plugins[0]?.active_version).toBe('1.0.0');
  });

  it('keeps only the active version when upgrading or downgrading', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-version-test-'));
    temporaryDirectories.push(userData);
    const { installer, state } = createInstaller(userData);
    const verified = (version: string, digest: string) => ({
      manifest: resolvedManifest(version),
      packageSha256: digest.repeat(64),
      files: packageFiles(manifestSource.replace('"version": "1.0.0"', `"version": "${version}"`)),
    });
    await installer.install(verified('1.0.0', 'a'), { enabled: true });
    await installer.install(verified('1.1.0', 'b'), { enabled: true });
    expect((await installer.listInstalled())[0]?.version).toBe('1.1.0');
    expect(state().plugins[0]?.versions.map((item) => item.version)).toEqual(['1.1.0']);
    await expect(
      readFile(join(userData, 'plugins/installed/com.example.seed.clock/1.0.0/manifest.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await installer.install(verified('1.0.0', 'a'), { enabled: true });
    expect((await installer.listInstalled())[0]?.version).toBe('1.0.0');
    expect(state().plugins[0]?.versions.map((item) => item.version)).toEqual(['1.0.0']);
    await expect(
      readFile(join(userData, 'plugins/installed/com.example.seed.clock/1.1.0/manifest.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(state().plugins[0]?.active_version).toBe('1.0.0');
  });

  it('preserves disabled state on upgrade unless enabling is explicitly requested', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-disabled-test-'));
    temporaryDirectories.push(userData);
    const { installer, state } = createInstaller(userData);
    const verified = (version: string, digest: string) => ({
      manifest: resolvedManifest(version),
      packageSha256: digest.repeat(64),
      files: packageFiles(manifestSource.replace('"version": "1.0.0"', `"version": "${version}"`)),
    });
    await installer.install(verified('1.0.0', 'a'), { enabled: false });
    await installer.install(verified('1.1.0', 'b'));
    expect(state().plugins[0]).toMatchObject({ active_version: '1.1.0', enabled: false });
    expect((await installer.listInstalled())[0]).toMatchObject({ version: '1.1.0', enabled: false, status: 'ready' });
    await installer.install(verified('1.2.0', 'c'), { enabled: true });
    expect(state().plugins[0]).toMatchObject({ active_version: '1.2.0', enabled: true });
  });

  it('restores the previous sole version when an update cannot persist its state', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-update-rollback-test-'));
    temporaryDirectories.push(userData);
    const { installer, rejectWrites } = createFailingInstaller(userData);
    const verified = (version: string, digest: string) => ({
      manifest: resolvedManifest(version),
      packageSha256: digest.repeat(64),
      files: packageFiles(manifestSource.replace('"version": "1.0.0"', `"version": "${version}"`)),
    });
    await installer.install(verified('1.0.0', 'a'), { enabled: true });
    rejectWrites();

    await expect(installer.install(verified('1.1.0', 'b'), { enabled: true })).rejects.toThrow('state write failed');

    await expect(installer.listInstalled()).resolves.toEqual([expect.objectContaining({ version: '1.0.0' })]);
    await expect(
      readFile(join(userData, 'plugins/installed/com.example.seed.clock/1.0.0/manifest.json')),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(
      readFile(join(userData, 'plugins/installed/com.example.seed.clock/1.1.0/manifest.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('prunes inactive versions left by an older client', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-prune-version-test-'));
    temporaryDirectories.push(userData);
    const { installer, state } = createInstaller(userData);
    await installer.install(
      {
        manifest: resolvedManifest('1.1.0'),
        packageSha256: 'b'.repeat(64),
        files: packageFiles(manifestSource.replace('"version": "1.0.0"', '"version": "1.1.0"')),
      },
      { enabled: true },
    );
    const oldVersionDirectory = join(userData, 'plugins/installed/com.example.seed.clock/1.0.0');
    await mkdir(oldVersionDirectory, { recursive: true });
    await writeFile(join(oldVersionDirectory, 'legacy.txt'), 'old');
    state().plugins[0]?.versions.push({ ...state().plugins[0]!.versions[0]!, version: '1.0.0' });

    await installer.pruneInactiveVersions();

    expect(state().plugins[0]?.versions.map((item) => item.version)).toEqual(['1.1.0']);
    await expect(readFile(join(oldVersionDirectory, 'legacy.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uninstalls every local version, preserves private data, and removes the plugin from runtime state', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-uninstall-test-'));
    temporaryDirectories.push(userData);
    const { installer, state } = createInstaller(userData);
    const verified = (version: string, digest: string) => ({
      manifest: resolvedManifest(version),
      packageSha256: digest.repeat(64),
      files: packageFiles(manifestSource.replace('"version": "1.0.0"', `"version": "${version}"`)),
    });
    await installer.install(verified('1.0.0', 'a'), { enabled: true });
    await installer.install(verified('1.1.0', 'b'), { enabled: true });
    const pluginDataFile = join(userData, 'plugin-data/com.example.seed.clock/state.json');
    await mkdir(join(userData, 'plugin-data/com.example.seed.clock'), { recursive: true });
    await writeFile(pluginDataFile, '{"value":true}');

    await installer.uninstall('com.example.seed.clock');

    await expect(installer.listInstalled()).resolves.toEqual([]);
    await expect(installer.listRuntimePlugins()).resolves.toEqual([]);
    await expect(
      readFile(join(userData, 'plugins/installed/com.example.seed.clock/1.0.0/manifest.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(pluginDataFile, 'utf8')).resolves.toBe('{"value":true}');
    expect(state().plugins).toEqual([]);
  });

  it('restores the package and private data when uninstall state persistence fails', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-uninstall-rollback-test-'));
    temporaryDirectories.push(userData);
    const { installer, rejectWrites } = createFailingInstaller(userData);
    await installer.install(
      {
        manifest: resolvedManifest(),
        packageSha256: 'f'.repeat(64),
        files: packageFiles(manifestSource),
      },
      { enabled: true },
    );
    const pluginDataFile = join(userData, 'plugin-data/com.example.seed.clock/state.json');
    await mkdir(join(userData, 'plugin-data/com.example.seed.clock'), { recursive: true });
    await writeFile(pluginDataFile, '{"value":true}');
    rejectWrites();

    await expect(installer.uninstall('com.example.seed.clock')).rejects.toThrow('state write failed');

    await expect(
      readFile(join(userData, 'plugins/installed/com.example.seed.clock/1.0.0/manifest.json')),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(readFile(pluginDataFile, 'utf8')).resolves.toBe('{"value":true}');
    await expect(installer.listInstalled()).resolves.toHaveLength(1);
  });

  it('keeps old installation records incompatible without parsing or executing their bundles', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-old-installation-'));
    temporaryDirectories.push(userData);
    const { installer, state } = createInstaller(userData);
    await installer.install({
      manifest: resolvedManifest(),
      packageSha256: 'e'.repeat(64),
      files: packageFiles(manifestSource),
    });
    delete (state().plugins[0]!.versions[0] as { manifest_sha256?: string }).manifest_sha256;
    expect(await installer.listInstalled()).toEqual([
      expect.objectContaining({ status: 'incompatible', enabled: false }),
    ]);
    expect(await installer.listRuntimePlugins()).toEqual([]);
    await installer.uninstall('com.example.seed.clock');
    expect(await installer.listInstalled()).toEqual([]);
  });

  it('does not expose an installed version after its runtime bundle is modified', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-tamper-test-'));
    temporaryDirectories.push(userData);
    const { installer } = createInstaller(userData);
    await installer.install(
      {
        manifest: resolvedManifest(),
        packageSha256: 'c'.repeat(64),
        files: packageFiles(manifestSource),
      },
      { enabled: true },
    );
    await writeFile(join(userData, 'plugins/installed/com.example.seed.clock/1.0.0/main.js'), 'modified\n');
    await expect(installer.listInstalled()).resolves.toEqual([]);
    await expect(installer.listRuntimePlugins()).resolves.toEqual([]);
  });

  it('ignores operating-system metadata without weakening package integrity checks', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-metadata-test-'));
    temporaryDirectories.push(userData);
    const { installer } = createInstaller(userData);
    const installedRoot = join(userData, 'plugins/installed/com.example.seed.clock/1.0.0');
    await installer.install(
      {
        manifest: resolvedManifest(),
        packageSha256: 'd'.repeat(64),
        files: packageFiles(manifestSource),
      },
      { enabled: true },
    );
    await mkdir(join(installedRoot, 'caps'), { recursive: true });
    await writeFile(join(installedRoot, '.DS_Store'), 'finder metadata');
    await writeFile(join(installedRoot, 'caps/.DS_Store'), 'finder metadata');

    await expect(installer.listInstalled()).resolves.toHaveLength(1);
    await expect(installer.listRuntimePlugins()).resolves.toEqual([
      expect.objectContaining({
        package_id: 'com.example.seed.clock',
        name: { en_US: 'Local Clock', zh_Hans: '本地时钟' },
        icon_data_url: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
        icon_dark_data_url: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
      }),
    ]);

    await writeFile(join(installedRoot, 'unexpected.txt'), 'not in the signed digest list');
    await expect(installer.listInstalled()).resolves.toEqual([]);
    await expect(installer.listRuntimePlugins()).resolves.toEqual([]);
  });

  it('does not report a repeated install as successful when the existing package is corrupt', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-repeat-test-'));
    temporaryDirectories.push(userData);
    const { installer } = createInstaller(userData);
    const verified = {
      manifest: resolvedManifest(),
      packageSha256: 'e'.repeat(64),
      files: packageFiles(manifestSource),
    };
    await installer.install(verified, { enabled: true });
    await writeFile(join(userData, 'plugins/installed/com.example.seed.clock/1.0.0/main.js'), 'modified\n');

    await expect(installer.install(verified, { enabled: true })).rejects.toThrow('checksum mismatch');
  });
});
