import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import type { SeedCatalogPlugin, SeedCatalogPluginVersion, SeedInstalledPlugin, SeedPluginRuntimeDefinition } from '../shared/contracts'
import { seedPluginRuntimeEntry } from '../shared/plugin-manifest'
import { compareSeedVersions } from '../shared/seed-version'
import { loadSeedPluginManifest, MAX_SEED_PLUGIN_PACKAGE_BYTES, verifySeedPackage, type VerifiedSeedPackage } from './seed-package'

const installedPluginIdSchema = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/)
const installedVersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
const ignoredInstalledMetadataFiles = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
type StagedInactiveVersions = { discard(): Promise<void>; restore(): Promise<void> }

function assetMime(path: string) {
  const extension = path.split('.').at(-1)?.toLowerCase()
  return extension === 'svg' ? 'image/svg+xml'
    : extension === 'png' ? 'image/png'
      : extension === 'webp' ? 'image/webp'
        : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : undefined
}

async function installedAssetDataUrl(root: string, reference?: string) {
  if (!reference) return undefined
  const mime = assetMime(reference)
  if (!mime) return undefined
  const body = await readFile(join(root, reference))
  if (!body.length || body.length > 256 * 1024) return undefined
  return `data:${mime};base64,${body.toString('base64')}`
}

const stateSchema = z.object({
  schema_version: z.literal(1),
  plugins: z.array(z.object({
    id: installedPluginIdSchema,
    active_version: installedVersionSchema,
    enabled: z.boolean(),
    versions: z.array(z.object({
      version: installedVersionSchema,
      package_sha256: z.string().regex(/^[0-9a-f]{64}$/),
      publisher_id: z.string(),
      publisher_type: z.enum(['official', 'community']).default('community'),
      visibility: z.enum(['public', 'organization']).default('public'),
      source: z.literal('marketplace').default('marketplace'),
      installed_at: z.string(),
    }).strict()),
  }).strict()).default([]),
}).strict()

type InstalledState = z.infer<typeof stateSchema>
type InstalledStateStorage = {
  read(): Promise<unknown | undefined>
  write(state: InstalledState): Promise<void>
}
type PluginPackageDownloadOptions = {
  signal?: AbortSignal
  onProgress?: (progress: { transferred: number; total: number; percent: number }) => void
  onVerifying?: () => void
}

async function exists(path: string) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function verifyInstalledFiles(root: string) {
  const digestPath = join(root, 'META-INF/files.sha256')
  const text = await readFile(digestPath, 'utf8')
  if (!text.endsWith('\n')) throw new Error('插件摘要清单格式无效。')
  const expected = new Map<string, string>()
  for (const line of text.split('\n').filter(Boolean)) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line)
    if (!match || match[2] === 'META-INF/files.sha256' || match[2].includes('\\') || match[2].includes('\0')) {
      throw new Error('插件摘要清单包含无效路径。')
    }
    if (expected.has(match[2])) throw new Error('插件摘要清单包含重复路径。')
    expected.set(match[2], match[1])
  }
  const actual: string[] = []
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) throw new Error('已安装插件包含符号链接。')
      if (metadata.isDirectory()) await walk(path)
      else if (metadata.isFile()) {
        const item = relative(root, path).split(sep).join('/')
        if (item !== 'META-INF/files.sha256' && !ignoredInstalledMetadataFiles.has(entry.name)) actual.push(item)
      } else throw new Error('已安装插件包含不支持的文件类型。')
      if (actual.length > 2_000) throw new Error('已安装插件文件数量超过限制。')
    }
  }
  await walk(root)
  if (actual.length !== expected.size || actual.some((path) => !expected.has(path))) {
    throw new Error('已安装插件文件与摘要清单不一致。')
  }
  for (const path of actual) {
    const digest = createHash('sha256').update(await readFile(join(root, path))).digest('hex')
    if (digest !== expected.get(path)) throw new Error(`已安装插件文件已被修改：${path}`)
  }
}

async function readInstalledManifest(root: string) {
  return await loadSeedPluginManifest(async (path) => await readFile(join(root, path)))
}

export async function responseBuffer(
  response: Response,
  maxBytes: number,
  options: Pick<PluginPackageDownloadOptions, 'signal' | 'onProgress'> = {},
) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (!Number.isSafeInteger(declared) || declared <= 0 || declared > maxBytes) throw new Error('服务端返回的插件包大小无效。')
  if (!response.body) throw new Error('服务端没有返回插件包内容。')
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  options.onProgress?.({ transferred: 0, total: declared, percent: 0 })
  while (true) {
    if (options.signal?.aborted) {
      await reader.cancel().catch(() => undefined)
      throw new DOMException('插件安装已取消。', 'AbortError')
    }
    const item = await reader.read()
    if (item.done) break
    total += item.value.byteLength
    if (total > maxBytes || total > declared) {
      await reader.cancel()
      throw new Error('下载的插件包超过声明大小。')
    }
    chunks.push(Buffer.from(item.value))
    options.onProgress?.({
      transferred: total,
      total: declared,
      percent: Math.min(100, total / declared * 100),
    })
  }
  if (total !== declared) throw new Error('下载的插件包长度与服务端声明不一致。')
  return Buffer.concat(chunks)
}

export class SeedPluginInstaller {
  readonly root: string
  private readonly installedRoot: string
  private readonly stagingRoot: string

  constructor(
    userDataPath: string,
    private readonly marketplaceUrl: string | (() => string),
    private readonly stateStorage: InstalledStateStorage,
    private readonly currentSeedVersion: string,
    private readonly accessToken?: () => Promise<string>,
  ) {
    this.root = join(userDataPath, 'plugins')
    this.installedRoot = join(this.root, 'installed')
    this.stagingRoot = join(this.root, 'staging')
  }

  private async readState(): Promise<InstalledState> {
    const stored = await this.stateStorage.read()
    return stored === undefined ? { schema_version: 1, plugins: [] } : stateSchema.parse(stored)
  }

  private async writeState(state: InstalledState) {
    await this.stateStorage.write(state)
  }

  private async stageInactiveVersions(pluginId: string, activeVersion: string): Promise<StagedInactiveVersions | null> {
    const pluginRoot = join(this.installedRoot, pluginId)
    let installedNames: string[]
    try {
      installedNames = await readdir(pluginRoot)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
    const inactiveNames = installedNames.filter((name) => name !== activeVersion)
    if (!inactiveNames.length) return null
    const quarantine = await mkdtemp(join(this.stagingRoot, 'replace-'))
    const moved: string[] = []
    try {
      for (const name of inactiveNames) {
        await rename(join(pluginRoot, name), join(quarantine, name))
        moved.push(name)
      }
    } catch (error) {
      for (const name of [...moved].reverse()) await rename(join(quarantine, name), join(pluginRoot, name))
      await rm(quarantine, { recursive: true, force: true })
      throw error
    }
    return {
      discard: async () => await rm(quarantine, { recursive: true, force: true }),
      restore: async () => {
        for (const name of [...moved].reverse()) await rename(join(quarantine, name), join(pluginRoot, name))
        await rm(quarantine, { recursive: true, force: true })
      },
    }
  }

  async pruneInactiveVersions() {
    await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 })
    const state = await this.readState()
    const staged: StagedInactiveVersions[] = []
    let changed = false
    try {
      for (const plugin of state.plugins) {
        const active = plugin.versions.find((version) => version.version === plugin.active_version)
        if (!active) continue
        const inactive = await this.stageInactiveVersions(plugin.id, plugin.active_version)
        if (inactive) {
          staged.push(inactive)
          changed = true
        }
        if (plugin.versions.length !== 1 || plugin.versions[0]?.version !== active.version) {
          plugin.versions = [active]
          changed = true
        }
      }
      if (changed) await this.writeState(state)
    } catch (error) {
      for (const inactive of [...staged].reverse()) await inactive.restore()
      throw error
    }
    await Promise.all(staged.map((inactive) => inactive.discard()))
  }

  async downloadAndVerify(plugin: SeedCatalogPlugin, version: SeedCatalogPluginVersion, options: PluginPackageDownloadOptions = {}) {
    const url = new URL(version.downloadUrl)
    const marketplaceUrl = typeof this.marketplaceUrl === 'function' ? this.marketplaceUrl() : this.marketplaceUrl
    if (!marketplaceUrl || url.origin !== new URL(marketplaceUrl).origin || url.username || url.password) {
      throw new Error('插件下载地址不属于当前 Seed Cloud。')
    }
    const token = await this.accessToken?.()
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.motusai.seed-plugin', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      redirect: 'error',
      signal: options.signal,
    })
    if (!response.ok) throw new Error(`插件下载失败（${response.status}）。`)
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim()
    if (contentType !== 'application/vnd.motusai.seed-plugin') throw new Error('服务端返回了错误的插件内容类型。')
    const bytes = await responseBuffer(response, MAX_SEED_PLUGIN_PACKAGE_BYTES, options)
    if (bytes.length !== version.packageSize) throw new Error('插件包大小与目录记录不一致。')
    options.onVerifying?.()
    return await verifySeedPackage(bytes, {
      expectedPackageSha256: version.packageSha256,
      expectedPluginId: plugin.id,
      expectedVersion: version.version,
    })
  }

  async install(
    verified: VerifiedSeedPackage,
    options: { publisherType?: 'official' | 'community'; visibility?: 'public' | 'organization'; source?: 'marketplace'; enabled?: boolean } = {},
  ) {
    if (compareSeedVersions(this.currentSeedVersion, verified.manifest.minSeedVersion) < 0) {
      throw new Error(`此插件需要 Seed ${verified.manifest.minSeedVersion} 或更高版本，请先更新客户端。`)
    }
    await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 })
    await mkdir(this.installedRoot, { recursive: true, mode: 0o700 })
    const staging = await mkdtemp(join(this.stagingRoot, 'install-'))
    const finalDirectory = join(this.installedRoot, verified.manifest.id, verified.manifest.version)
    try {
      for (const [archivePath, body] of verified.files) {
        const destination = resolve(staging, archivePath)
        const boundary = relative(staging, destination)
        if (boundary.startsWith('..') || boundary === '') throw new Error('插件安装路径越过 staging 边界。')
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
        await writeFile(destination, body, { mode: 0o600, flag: 'wx' })
        if (verified.manifest.sidecars.some((sidecar) => sidecar.path.slice(2) === archivePath)) await chmod(destination, 0o700)
      }
      const state = await this.readState()
      if (await exists(finalDirectory)) {
        const record = state.plugins.find((plugin) => plugin.id === verified.manifest.id)
        const current = record?.versions.find((version) => version.version === verified.manifest.version)
        if (current?.package_sha256 === verified.packageSha256 && record) {
          await verifyInstalledFiles(await realpath(finalDirectory))
          current.publisher_type = options.publisherType || current.publisher_type
          current.visibility = options.visibility || current.visibility
          current.source = options.source || current.source
          const inactive = await this.stageInactiveVersions(verified.manifest.id, verified.manifest.version)
          record.active_version = verified.manifest.version
          record.enabled = options.enabled ?? record.enabled
          record.versions = [current]
          try {
            await this.writeState(state)
          } catch (error) {
            await inactive?.restore()
            throw error
          }
          await inactive?.discard()
          return
        }
        throw new Error('同版本插件已经存在，但摘要不同。')
      }
      await mkdir(dirname(finalDirectory), { recursive: true, mode: 0o700 })
      await rename(staging, finalDirectory)

      const installedAt = new Date().toISOString()
      const record = state.plugins.find((plugin) => plugin.id === verified.manifest.id)
      const version = {
        version: verified.manifest.version,
        package_sha256: verified.packageSha256,
        publisher_id: verified.publisherId,
        publisher_type: options.publisherType || 'community' as const,
        visibility: options.visibility || 'public' as const,
        source: options.source || 'marketplace' as const,
        installed_at: installedAt,
      }
      const inactive = await this.stageInactiveVersions(verified.manifest.id, verified.manifest.version)
      if (record) {
        record.versions = [version]
        record.active_version = version.version
        record.enabled = options.enabled ?? true
      } else {
        state.plugins.push({ id: verified.manifest.id, active_version: version.version, enabled: options.enabled ?? true, versions: [version] })
      }
      try {
        await this.writeState(state)
      } catch (error) {
        await inactive?.restore()
        await rm(finalDirectory, { recursive: true, force: true })
        throw error
      }
      await inactive?.discard()
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }

  async uninstall(pluginId: string) {
    const id = installedPluginIdSchema.parse(pluginId)
    const state = await this.readState()
    const index = state.plugins.findIndex((plugin) => plugin.id === id)
    if (index < 0) throw new Error('插件尚未安装。')

    await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 })
    const packageSource = join(this.installedRoot, id)
    const quarantine = join(this.stagingRoot, `uninstall-${randomUUID()}`)
    const packageQuarantine = join(quarantine, 'package')
    const movedPackage = await exists(packageSource)
    await mkdir(quarantine, { recursive: false, mode: 0o700 })
    try {
      if (movedPackage) await rename(packageSource, packageQuarantine)
    } catch (error) {
      if (await exists(packageQuarantine)) await rename(packageQuarantine, packageSource)
      await rm(quarantine, { recursive: true, force: true })
      throw error
    }
    const nextState: InstalledState = {
      ...state,
      plugins: state.plugins.filter((plugin) => plugin.id !== id),
    }
    try {
      await this.writeState(nextState)
    } catch (error) {
      if (movedPackage) await rename(packageQuarantine, packageSource)
      await rm(quarantine, { recursive: true, force: true })
      throw error
    }
    await rm(quarantine, { recursive: true, force: true })
  }

  async listInstalled(): Promise<SeedInstalledPlugin[]> {
    const state = await this.readState()
    const installed: SeedInstalledPlugin[] = []
    for (const pluginState of state.plugins) {
      const versionState = pluginState.versions.find((version) => version.version === pluginState.active_version)
      if (!versionState) continue
      const directory = join(this.installedRoot, pluginState.id, versionState.version)
      try {
        await verifyInstalledFiles(await realpath(directory))
        const manifestBody = await readFile(join(directory, 'manifest.yaml'))
        const manifestDigest = `sha256:${createHash('sha256').update(manifestBody).digest('hex')}`
        try {
          const manifest = await readInstalledManifest(directory)
          if (compareSeedVersions(this.currentSeedVersion, manifest.minSeedVersion) < 0) {
            throw new Error(`此插件需要 Seed ${manifest.minSeedVersion} 或更高版本，请先更新客户端。`)
          }
          const iconDataUrl = await installedAssetDataUrl(directory, manifest.icon)
          const iconDarkDataUrl = await installedAssetDataUrl(directory, manifest.iconDark)
          installed.push({
            id: manifest.id,
            visibility: versionState.visibility,
            name: manifest.name,
            description: manifest.description || { en_US: 'Local capability plugin', zh_Hans: '本地能力插件' },
            labels: manifest.labels,
            version: manifest.version,
            publisher: manifest.publisher,
            runtimeKind: manifest.runtime.kind,
            manifestDigest,
            iconDataUrl,
            iconDarkDataUrl,
            detailPresentation: manifest.detailPresentation,
            capabilities: manifest.capabilities,
            configurations: [],
            managementViews: [],
            permissions: manifest.permissions,
            source: 'installed',
            publisherType: versionState.publisher_type,
            status: 'ready',
            enabled: pluginState.enabled,
            installedAt: versionState.installed_at,
          })
        } catch (error) {
          installed.push({
            id: pluginState.id,
            visibility: versionState.visibility,
            name: { en_US: pluginState.id, zh_Hans: pluginState.id },
            description: {
              en_US: 'This installed version uses an incompatible plugin format.',
              zh_Hans: '这个已安装版本使用了不兼容的插件格式。',
            },
            labels: ['other'],
            version: versionState.version,
            publisher: versionState.publisher_id,
            manifestDigest,
            capabilities: [],
            configurations: [],
            managementViews: [],
            permissions: [],
            source: 'installed',
            publisherType: versionState.publisher_type,
            status: 'incompatible',
            incompatibilityReason: error instanceof Error ? error.message : '插件格式不兼容。',
            enabled: false,
            installedAt: versionState.installed_at,
          })
        }
      } catch {
        // Tampered or unreadable packages remain hidden and never reach a plugin host.
      }
    }
    return installed
  }

  async listRuntimePlugins(allowedPluginIds?: ReadonlySet<string>): Promise<SeedPluginRuntimeDefinition[]> {
    const state = await this.readState()
    const plugins: SeedPluginRuntimeDefinition[] = []
    for (const pluginState of state.plugins) {
      if (!pluginState.enabled) continue
      if (allowedPluginIds && !allowedPluginIds.has(pluginState.id)) continue
      const versionState = pluginState.versions.find((version) => version.version === pluginState.active_version)
      if (!versionState) continue
      const rootPath = await realpath(join(this.installedRoot, pluginState.id, versionState.version)).catch(() => '')
      if (!rootPath) continue
      try {
        await verifyInstalledFiles(rootPath)
        const manifest = await readInstalledManifest(rootPath)
        if (compareSeedVersions(this.currentSeedVersion, manifest.minSeedVersion) < 0) continue
        if (manifest.runtime.kind === 'native-host' && versionState.publisher_type !== 'official') continue
        const iconDataUrl = await installedAssetDataUrl(rootPath, manifest.icon)
        const iconDarkDataUrl = await installedAssetDataUrl(rootPath, manifest.iconDark)
        const entryPath = await realpath(resolve(rootPath, seedPluginRuntimeEntry))
        const boundary = relative(rootPath, entryPath)
        if (!boundary || boundary.startsWith('..')) continue
        const sidecars = []
        for (const sidecar of manifest.sidecars) {
          const sidecarPath = await realpath(resolve(rootPath, sidecar.path))
          const sidecarBoundary = relative(rootPath, sidecarPath)
          if (!sidecarBoundary || sidecarBoundary.startsWith('..') || isAbsolute(sidecarBoundary)) throw new Error('Sidecar 路径越过插件目录。')
          const metadata = await lstat(sidecarPath)
          if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Sidecar 必须是插件目录内的普通文件。')
          sidecars.push({ id: sidecar.id, path: sidecarPath })
        }
        plugins.push({
          package_id: manifest.id,
          version: manifest.version,
          name: manifest.name,
          ...(iconDataUrl ? { icon_data_url: iconDataUrl } : {}),
          ...(iconDarkDataUrl ? { icon_dark_data_url: iconDarkDataUrl } : {}),
          publisher_type: versionState.publisher_type,
          runtime_kind: manifest.runtime.kind,
          root_path: rootPath,
          entry_path: entryPath,
          sidecars,
          permissions: manifest.permissions,
          consumes: manifest.consumes,
          capabilities: manifest.capabilities,
        })
      } catch {
        // Invalid packages never enter either the connector router or sandbox.
      }
    }
    return plugins
  }

  async syncEntitlements(items: Array<{ plugin_id: string; visibility: 'public' | 'organization' }>) {
    const state = await this.readState()
    const byId = new Map(items.map((item) => [item.plugin_id, item.visibility]))
    let changed = false
    for (const plugin of state.plugins) {
      const visibility = byId.get(plugin.id)
      if (!visibility) continue
      const version = plugin.versions.find((item) => item.version === plugin.active_version)
      if (version && version.visibility !== visibility) {
        version.visibility = visibility
        changed = true
      }
    }
    if (changed) await this.writeState(state)
  }
}
