import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { seedCapabilityManifestSchema, seedPluginManifestSchema } from '../shared/plugin-manifest'
import { SeedPluginInstaller } from './seed-plugin-installer'

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function createInstaller(userData: string, currentSeedVersion = '0.1.67') {
  let state: unknown
  return {
    installer: new SeedPluginInstaller(userData, 'https://example.test', {
      read: async () => state,
      write: async (nextState) => { state = structuredClone(nextState) },
    }, currentSeedVersion),
    state: () => state as { plugins: Array<{ active_version: string; versions: Array<{ version: string }> }> },
  }
}

function createFailingInstaller(userData: string) {
  let state: unknown
  let rejectWrites = false
  return {
    installer: new SeedPluginInstaller(userData, 'https://example.test', {
      read: async () => state,
      write: async (nextState) => {
        if (rejectWrites) throw new Error('state write failed')
        state = structuredClone(nextState)
      },
    }, '0.1.67'),
    rejectWrites: () => { rejectWrites = true },
  }
}

const manifestSource = `schema_version: 1
id: com.example.seed.clock
name:
  en_US: Local Clock
  zh_Hans: 本地时钟
description:
  en_US: Read the current device time.
  zh_Hans: 读取当前设备时间。
labels:
  - productivity
  - utilities
version: 1.0.0
min_seed_version: 0.1.67
api_version: "1"
publisher: com.example
icon: ./assets/icon.svg
icon_dark: ./assets/icon-dark.svg
detail_presentation:
  renderer: seed.route
  summary:
    en_US: Files stay on this device.
    zh_Hans: 文件保留在此设备上。
  nodes:
    - icon: agent
      title:
        en_US: Agent
        zh_Hans: Agent
      description:
        en_US: Requests access
        zh_Hans: 发起访问
    - icon: folder
      title:
        en_US: Files
        zh_Hans: 文件
      description:
        en_US: Stay local
        zh_Hans: 保留在本机
runtime:
  kind: sandboxed-web
caps:
  - ./caps/clock.yaml
`

const capabilitySource = `id: clock
version: 1
methods:
  - name: now
    risk: read
`

function resolvedManifest(version = '1.0.0') {
  const document = seedPluginManifestSchema.parse({
    schema_version: 1,
    id: 'com.example.seed.clock',
    name: { en_US: 'Local Clock', zh_Hans: '本地时钟' },
    description: { en_US: 'Read the current device time.', zh_Hans: '读取当前设备时间。' },
    labels: ['productivity', 'utilities'],
    version,
    min_seed_version: '0.1.67',
    api_version: '1',
    publisher: 'com.example',
    icon: './assets/icon.svg',
    icon_dark: './assets/icon-dark.svg',
    runtime: { kind: 'sandboxed-web' },
    caps: ['./caps/clock.yaml'],
    permissions: [],
  })
  const capability = seedCapabilityManifestSchema.parse({ id: 'clock', version: 1, methods: [{ name: 'now', risk: 'read' }] })
  return { ...document, capabilities: [capability] }
}

function packageFiles(manifest: string) {
  const entry = Buffer.from('export default {}\n')
  const icon = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')
  const iconDark = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')
  const manifestBody = Buffer.from(manifest)
  const capabilityBody = Buffer.from(capabilitySource)
  const digests = Buffer.from([
    `${createHash('sha256').update(iconDark).digest('hex')}  assets/icon-dark.svg`,
    `${createHash('sha256').update(icon).digest('hex')}  assets/icon.svg`,
    `${createHash('sha256').update(entry).digest('hex')}  dist/index.mjs`,
    `${createHash('sha256').update(capabilityBody).digest('hex')}  caps/clock.yaml`,
    `${createHash('sha256').update(manifestBody).digest('hex')}  manifest.yaml`,
    '',
  ].join('\n'))
  return new Map([
    ['manifest.yaml', manifestBody],
    ['assets/icon.svg', icon],
    ['assets/icon-dark.svg', iconDark],
    ['caps/clock.yaml', capabilityBody],
    ['dist/index.mjs', entry],
    ['META-INF/files.sha256', digests],
  ])
}

describe('Seed plugin installer', () => {
  it('keeps installed packages but excludes plugins without a current Cloud entitlement from runtime', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-entitlement-test-'))
    temporaryDirectories.push(userData)
    const { installer } = createInstaller(userData)
    await installer.install({
      manifest: resolvedManifest(),
      publisherId: 'com.example',
      packageSha256: 'a'.repeat(64),
      files: packageFiles(manifestSource),
    }, { enabled: true, visibility: 'organization' })

    expect((await installer.listInstalled())[0]).toMatchObject({
      visibility: 'organization',
      detailPresentation: { renderer: 'seed.route', nodes: [{ icon: 'agent' }, { icon: 'folder' }] },
    })
    await expect(installer.listRuntimePlugins(new Set())).resolves.toEqual([])
    await expect(installer.listRuntimePlugins(new Set(['com.example.seed.clock']))).resolves.toHaveLength(1)
    await installer.syncEntitlements([{ plugin_id: 'com.example.seed.clock', visibility: 'public' }])
    expect((await installer.listInstalled())[0]).toMatchObject({ visibility: 'public' })
  })
  it('requires Sidecars to stay in their package directory and declare process permission', () => {
    const base = {
      schema_version: 1, id: 'com.example.seed.clock', name: { en_US: 'Clock', zh_Hans: '时钟' }, labels: ['utilities'],
      version: '1.0.0', min_seed_version: '0.1.67', api_version: '1', publisher: 'com.example', icon: './assets/icon.svg',
      runtime: { kind: 'sandboxed-web' }, caps: ['./caps/clock.yaml'],
      sidecars: [{ id: 'clock', path: './sidecars/clock', executable: true }],
    }
    expect(() => seedPluginManifestSchema.parse(base)).toThrow(/process.sidecar/)
    expect(seedPluginManifestSchema.parse({ ...base, permissions: ['process.sidecar'] }).sidecars).toHaveLength(1)
    expect(() => seedPluginManifestSchema.parse({ ...base, permissions: ['process.sidecar'], sidecars: [{ id: 'clock', path: './bin/clock', executable: true }] })).toThrow(/Sidecar/)
  })

  it('defaults capability exposure to terminal and accepts scoped capabilities', () => {
    const method = [{ name: 'now', risk: 'read' as const }]
    expect(seedCapabilityManifestSchema.parse({ id: 'clock', version: 1, methods: method }).exposure).toBe('terminal')
    expect(seedCapabilityManifestSchema.parse({ id: 'clock', version: 1, exposure: 'local', methods: method }).exposure).toBe('local')
    expect(seedCapabilityManifestSchema.parse({ id: 'clock', version: 1, exposure: 'plugin', methods: method }).exposure).toBe('plugin')
  })

  it('commits an explicitly approved package atomically and enables it', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-test-'))
    temporaryDirectories.push(userData)
    const packageSha256 = 'a'.repeat(64)
    const { installer, state } = createInstaller(userData)
    await installer.install({
      manifest: resolvedManifest(),
      publisherId: 'com.example',
      packageSha256,
      files: packageFiles(manifestSource),
    }, { publisherType: 'community', source: 'marketplace', enabled: true })

    const installed = await installer.listInstalled()
    expect(installed).toHaveLength(1)
    expect(installed[0]).toMatchObject({
      id: 'com.example.seed.clock',
      version: '1.0.0',
      source: 'installed',
      publisherType: 'community',
      enabled: true,
    })
    expect(createHash('sha256').update(await readFile(join(
      userData,
      'plugins/installed/com.example.seed.clock/1.0.0/manifest.yaml',
    ))).digest('hex')).toHaveLength(64)
    expect(state().plugins[0]?.active_version).toBe('1.0.0')
  })

  it('rejects an update requiring a newer Seed without replacing the installed version', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-minimum-test-'))
    temporaryDirectories.push(userData)
    const { installer, state } = createInstaller(userData)
    await installer.install({ manifest: resolvedManifest(), publisherId: 'com.example', packageSha256: 'a'.repeat(64), files: packageFiles(manifestSource) })
    await expect(installer.install({
      manifest: { ...resolvedManifest('1.1.0'), minSeedVersion: '0.1.68' },
      publisherId: 'com.example', packageSha256: 'b'.repeat(64),
      files: packageFiles(manifestSource.replace('version: 1.0.0', 'version: 1.1.0').replace('min_seed_version: 0.1.67', 'min_seed_version: 0.1.68')),
    })).rejects.toThrow('Seed 0.1.68')
    expect(state().plugins[0]?.active_version).toBe('1.0.0')
    expect((await installer.listRuntimePlugins())).toHaveLength(1)
  })

  it('retains an installed plugin after client downgrade without starting it', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-downgrade-test-'))
    temporaryDirectories.push(userData)
    const { installer, state } = createInstaller(userData)
    await installer.install({ manifest: resolvedManifest(), publisherId: 'com.example', packageSha256: 'a'.repeat(64), files: packageFiles(manifestSource) })
    const downgraded = new SeedPluginInstaller(userData, 'https://example.test', {
      read: async () => state(),
      write: async () => { throw new Error('downgrade must not modify installed state') },
    }, '0.1.66')
    expect(await downgraded.listInstalled()).toEqual([expect.objectContaining({
      status: 'incompatible', enabled: false, incompatibilityReason: expect.stringContaining('Seed 0.1.67'),
    })])
    expect(await downgraded.listRuntimePlugins()).toEqual([])
    expect(state().plugins[0]?.active_version).toBe('1.0.0')
  })

  it('keeps only the active version when upgrading or downgrading', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-version-test-'))
    temporaryDirectories.push(userData)
    const { installer, state } = createInstaller(userData)
    const verified = (version: string, digest: string) => ({
      manifest: resolvedManifest(version),
      publisherId: 'com.example',
      packageSha256: digest.repeat(64),
      files: packageFiles(manifestSource.replace('version: 1.0.0', `version: ${version}`)),
    })
    await installer.install(verified('1.0.0', 'a'), { enabled: true })
    await installer.install(verified('1.1.0', 'b'), { enabled: true })
    expect((await installer.listInstalled())[0]?.version).toBe('1.1.0')
    expect(state().plugins[0]?.versions.map((item) => item.version)).toEqual(['1.1.0'])
    await expect(readFile(join(userData, 'plugins/installed/com.example.seed.clock/1.0.0/manifest.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
    await installer.install(verified('1.0.0', 'a'), { enabled: true })
    expect((await installer.listInstalled())[0]?.version).toBe('1.0.0')
    expect(state().plugins[0]?.versions.map((item) => item.version)).toEqual(['1.0.0'])
    await expect(readFile(join(userData, 'plugins/installed/com.example.seed.clock/1.1.0/manifest.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(state().plugins[0]?.active_version).toBe('1.0.0')
  })

  it('restores the previous sole version when an update cannot persist its state', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-update-rollback-test-'))
    temporaryDirectories.push(userData)
    const { installer, rejectWrites } = createFailingInstaller(userData)
    const verified = (version: string, digest: string) => ({
      manifest: resolvedManifest(version),
      publisherId: 'com.example',
      packageSha256: digest.repeat(64),
      files: packageFiles(manifestSource.replace('version: 1.0.0', `version: ${version}`)),
    })
    await installer.install(verified('1.0.0', 'a'), { enabled: true })
    rejectWrites()

    await expect(installer.install(verified('1.1.0', 'b'), { enabled: true })).rejects.toThrow('state write failed')

    await expect(installer.listInstalled()).resolves.toEqual([expect.objectContaining({ version: '1.0.0' })])
    await expect(readFile(join(userData, 'plugins/installed/com.example.seed.clock/1.0.0/manifest.yaml'))).resolves.toBeInstanceOf(Buffer)
    await expect(readFile(join(userData, 'plugins/installed/com.example.seed.clock/1.1.0/manifest.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('prunes inactive versions left by an older client', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-prune-version-test-'))
    temporaryDirectories.push(userData)
    const { installer, state } = createInstaller(userData)
    await installer.install({
      manifest: resolvedManifest('1.1.0'),
      publisherId: 'com.example',
      packageSha256: 'b'.repeat(64),
      files: packageFiles(manifestSource.replace('version: 1.0.0', 'version: 1.1.0')),
    }, { enabled: true })
    const oldVersionDirectory = join(userData, 'plugins/installed/com.example.seed.clock/1.0.0')
    await mkdir(oldVersionDirectory, { recursive: true })
    await writeFile(join(oldVersionDirectory, 'legacy.txt'), 'old')
    state().plugins[0]?.versions.push({ ...state().plugins[0]!.versions[0]!, version: '1.0.0' })

    await installer.pruneInactiveVersions()

    expect(state().plugins[0]?.versions.map((item) => item.version)).toEqual(['1.1.0'])
    await expect(readFile(join(oldVersionDirectory, 'legacy.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uninstalls every local version, preserves private data, and removes the plugin from runtime state', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-uninstall-test-'))
    temporaryDirectories.push(userData)
    const { installer, state } = createInstaller(userData)
    const verified = (version: string, digest: string) => ({
      manifest: resolvedManifest(version),
      publisherId: 'com.example',
      packageSha256: digest.repeat(64),
      files: packageFiles(manifestSource.replace('version: 1.0.0', `version: ${version}`)),
    })
    await installer.install(verified('1.0.0', 'a'), { enabled: true })
    await installer.install(verified('1.1.0', 'b'), { enabled: true })
    const pluginDataFile = join(userData, 'plugin-data/com.example.seed.clock/state.json')
    await mkdir(join(userData, 'plugin-data/com.example.seed.clock'), { recursive: true })
    await writeFile(pluginDataFile, '{"value":true}')

    await installer.uninstall('com.example.seed.clock')

    await expect(installer.listInstalled()).resolves.toEqual([])
    await expect(installer.listRuntimePlugins()).resolves.toEqual([])
    await expect(readFile(join(userData, 'plugins/installed/com.example.seed.clock/1.0.0/manifest.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(pluginDataFile, 'utf8')).resolves.toBe('{"value":true}')
    expect(state().plugins).toEqual([])
  })

  it('restores the package and private data when uninstall state persistence fails', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-uninstall-rollback-test-'))
    temporaryDirectories.push(userData)
    const { installer, rejectWrites } = createFailingInstaller(userData)
    await installer.install({
      manifest: resolvedManifest(),
      publisherId: 'com.example',
      packageSha256: 'f'.repeat(64),
      files: packageFiles(manifestSource),
    }, { enabled: true })
    const pluginDataFile = join(userData, 'plugin-data/com.example.seed.clock/state.json')
    await mkdir(join(userData, 'plugin-data/com.example.seed.clock'), { recursive: true })
    await writeFile(pluginDataFile, '{"value":true}')
    rejectWrites()

    await expect(installer.uninstall('com.example.seed.clock')).rejects.toThrow('state write failed')

    await expect(readFile(join(userData, 'plugins/installed/com.example.seed.clock/1.0.0/manifest.yaml'))).resolves.toBeInstanceOf(Buffer)
    await expect(readFile(pluginDataFile, 'utf8')).resolves.toBe('{"value":true}')
    await expect(installer.listInstalled()).resolves.toHaveLength(1)
  })

  it('keeps an intact legacy package visible as incompatible until it is uninstalled', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-incompatible-test-'))
    temporaryDirectories.push(userData)
    const { installer } = createInstaller(userData)
    await installer.install({
      manifest: resolvedManifest(),
      publisherId: 'com.example',
      packageSha256: 'e'.repeat(64),
      files: packageFiles(manifestSource),
    }, { enabled: true })

    const installedRoot = join(userData, 'plugins/installed/com.example.seed.clock/1.0.0')
    const manifestPath = join(installedRoot, 'manifest.yaml')
    const digestPath = join(installedRoot, 'META-INF/files.sha256')
    const currentManifest = await readFile(manifestPath)
    const legacyManifest = Buffer.from(currentManifest.toString('utf8').replace(
      '  kind: sandboxed-web\n',
      '  kind: sandboxed-web\n  entry: ./dist/index.mjs\n',
    ))
    const currentDigest = createHash('sha256').update(currentManifest).digest('hex')
    const legacyDigest = createHash('sha256').update(legacyManifest).digest('hex')
    await writeFile(manifestPath, legacyManifest)
    await writeFile(digestPath, (await readFile(digestPath, 'utf8')).replace(
      `${currentDigest}  manifest.yaml`,
      `${legacyDigest}  manifest.yaml`,
    ))

    await expect(installer.listInstalled()).resolves.toEqual([
      expect.objectContaining({
        id: 'com.example.seed.clock',
        version: '1.0.0',
        status: 'incompatible',
        enabled: false,
      }),
    ])
    await expect(installer.listRuntimePlugins()).resolves.toEqual([])
    await installer.uninstall('com.example.seed.clock')
    await expect(installer.listInstalled()).resolves.toEqual([])
  })

  it('does not expose an installed version after its runtime bundle is modified', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-tamper-test-'))
    temporaryDirectories.push(userData)
    const { installer } = createInstaller(userData)
    await installer.install({
      manifest: resolvedManifest(),
      publisherId: 'com.example',
      packageSha256: 'c'.repeat(64),
      files: packageFiles(manifestSource),
    }, { enabled: true })
    await writeFile(join(userData, 'plugins/installed/com.example.seed.clock/1.0.0/dist/index.mjs'), 'modified\n')
    await expect(installer.listInstalled()).resolves.toEqual([])
    await expect(installer.listRuntimePlugins()).resolves.toEqual([])
  })

  it('ignores operating-system metadata without weakening package integrity checks', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-metadata-test-'))
    temporaryDirectories.push(userData)
    const { installer } = createInstaller(userData)
    const installedRoot = join(userData, 'plugins/installed/com.example.seed.clock/1.0.0')
    await installer.install({
      manifest: resolvedManifest(),
      publisherId: 'com.example',
      packageSha256: 'd'.repeat(64),
      files: packageFiles(manifestSource),
    }, { enabled: true })
    await mkdir(join(installedRoot, 'caps'), { recursive: true })
    await writeFile(join(installedRoot, '.DS_Store'), 'finder metadata')
    await writeFile(join(installedRoot, 'caps/.DS_Store'), 'finder metadata')

    await expect(installer.listInstalled()).resolves.toHaveLength(1)
    await expect(installer.listRuntimePlugins()).resolves.toEqual([
      expect.objectContaining({
        package_id: 'com.example.seed.clock',
        name: { en_US: 'Local Clock', zh_Hans: '本地时钟' },
        icon_data_url: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
        icon_dark_data_url: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
      }),
    ])

    await writeFile(join(installedRoot, 'unexpected.txt'), 'not in the signed digest list')
    await expect(installer.listInstalled()).resolves.toEqual([])
    await expect(installer.listRuntimePlugins()).resolves.toEqual([])
  })

  it('does not report a repeated install as successful when the existing package is corrupt', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'seed-installer-repeat-test-'))
    temporaryDirectories.push(userData)
    const { installer } = createInstaller(userData)
    const verified = {
      manifest: resolvedManifest(),
      publisherId: 'com.example',
      packageSha256: 'e'.repeat(64),
      files: packageFiles(manifestSource),
    }
    await installer.install(verified, { enabled: true })
    await writeFile(join(userData, 'plugins/installed/com.example.seed.clock/1.0.0/dist/index.mjs'), 'modified\n')

    await expect(installer.install(verified, { enabled: true })).rejects.toThrow('已安装插件文件已被修改')
  })

})
