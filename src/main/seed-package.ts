import { createHash } from 'node:crypto'
import { isAbsolute, posix } from 'node:path'
import * as unzipper from 'unzipper'
import { isAlias, parseDocument, visit } from 'yaml'
import { seedCapabilityManifestSchema, seedPluginManifestSchema, seedPluginRuntimeEntry, type SeedCapabilityManifest, type SeedPluginManifest } from '../shared/plugin-manifest'

export const MAX_SEED_PLUGIN_PACKAGE_BYTES = 512 * 1024 * 1024
const maxExpandedBytes = 512 * 1024 * 1024
const maxFiles = 2_000
const maxFileBytes = 512 * 1024 * 1024

export type VerifiedSeedPackage = {
  manifest: SeedPluginManifest
  publisherId: string
  packageSha256: string
  files: ReadonlyMap<string, Buffer>
}

function safeYaml<T>(text: string, source: string): T {
  const document = parseDocument(text, { schema: 'core', customTags: [], prettyErrors: true })
  if (document.errors.length) throw new Error(`${source} 无法解析：${document.errors.map((error) => error.message).join('；')}`)
  visit(document, (_key, node: unknown) => {
    if (isAlias(node)) throw new Error(`${source} 不允许 YAML alias。`)
    if (node && typeof node === 'object' && 'flow' in node && node.flow === true) throw new Error(`${source} 不允许 YAML flow style。`)
    if (node && typeof node === 'object' && 'tag' in node
      && typeof node.tag === 'string' && !node.tag.startsWith('tag:yaml.org,2002:')) {
      throw new Error(`${source} 不允许自定义 YAML tag。`)
    }
  })
  return document.toJS({ maxAliasCount: 0 }) as T
}

function resolveReference(source: string, reference: string) {
  const resolved = posix.normalize(posix.join(posix.dirname(source), reference))
  if (!safeArchivePath(resolved)) throw new Error(`${source} 引用了不安全路径：${reference}`)
  return resolved
}

export async function loadSeedPluginManifest(read: (path: string) => Promise<Buffer>) {
  const manifestPath = 'manifest.yaml'
  const document = seedPluginManifestSchema.parse(safeYaml<unknown>((await read(manifestPath)).toString('utf8'), manifestPath))
  await read(resolveReference(manifestPath, document.icon))
  if (document.iconDark) await read(resolveReference(manifestPath, document.iconDark))
  await read(seedPluginRuntimeEntry.slice(2))
  for (const sidecar of document.sidecars) await read(sidecar.path.slice(2))
  const capabilities = []
  const capabilityIds = new Set<string>()
  for (const reference of document.capabilityPaths) {
    const capabilityPath = resolveReference(manifestPath, reference)
    const capabilityDocument = seedCapabilityManifestSchema.parse(safeYaml<unknown>((await read(capabilityPath)).toString('utf8'), capabilityPath))
    if (capabilityIds.has(capabilityDocument.id)) throw new Error(`插件包含重复能力：${capabilityDocument.id}`)
    capabilityIds.add(capabilityDocument.id)
    capabilities.push(capabilityDocument satisfies SeedCapabilityManifest)
  }
  return { ...document, capabilities } satisfies SeedPluginManifest
}

function safeArchivePath(input: string) {
  if (!input || input.length > 512 || input.includes('\\') || input.includes('\0') || input.includes(':') || isAbsolute(input)) return false
  const normalized = posix.normalize(input)
  if (normalized !== input || normalized === '.' || normalized.startsWith('../') || input.startsWith('/')) return false
  return !input.split('/').some((part) => {
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part)) return true
    const windowsBase = part.split('.', 1)[0]!.toLocaleLowerCase('en-US')
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(windowsBase)
  })
}

function safeArchiveEntryPath(input: string, directory: boolean) {
  const path = directory && input.endsWith('/') ? input.slice(0, -1) : input
  return safeArchivePath(path)
}

function entryIsLink(entry: unknown) {
  const vars = (entry as { vars?: { externalFileAttributes?: number } }).vars
  const attributes = Number(vars?.externalFileAttributes || 0)
  const unixType = (attributes >>> 16) & 0o170000
  return unixType === 0o120000
}

function parseDigestList(source: Buffer) {
  const text = source.toString('utf8')
  if (!text.endsWith('\n')) throw new Error('META-INF/files.sha256 必须以换行结尾。')
  const result = new Map<string, string>()
  for (const line of text.split('\n').filter(Boolean)) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line)
    if (!match || !safeArchivePath(match[2]!)) throw new Error('META-INF/files.sha256 格式无效。')
    if (result.has(match[2]!)) throw new Error(`摘要清单包含重复路径：${match[2]}`)
    result.set(match[2]!, match[1]!)
  }
  return result
}

export async function verifySeedPackage(
  packageBytes: Buffer,
  options: {
    expectedPackageSha256: string
    expectedPluginId?: string
    expectedVersion?: string
  },
): Promise<VerifiedSeedPackage> {
  if (!packageBytes.length || packageBytes.length > MAX_SEED_PLUGIN_PACKAGE_BYTES) throw new Error('Seed 插件包大小无效。')
  const packageSha256 = createHash('sha256').update(packageBytes).digest('hex')
  if (!/^[0-9a-f]{64}$/.test(options.expectedPackageSha256)
    || packageSha256 !== options.expectedPackageSha256.toLowerCase()) {
    throw new Error('Seed 插件包摘要与服务端目录不一致。')
  }

  const archive = await unzipper.Open.buffer(packageBytes)
  if (!archive.files.length || archive.files.length > maxFiles) throw new Error('Seed 插件包文件数量无效。')
  const files = new Map<string, Buffer>()
  const normalizedPaths = new Set<string>()
  let expandedBytes = 0
  for (const entry of archive.files) {
    const path = entry.path
    const directory = entry.type === 'Directory'
    if ((entry.type !== 'File' && !directory) || entryIsLink(entry) || !safeArchiveEntryPath(path, directory)) {
      throw new Error(`Seed 插件包包含不安全条目：${path}`)
    }
    if (directory) continue
    const normalizedKey = path.normalize('NFC').toLocaleLowerCase('en-US')
    if (normalizedPaths.has(normalizedKey)) throw new Error(`Seed 插件包包含重复或冲突路径：${path}`)
    normalizedPaths.add(normalizedKey)
    const declaredSize = Number(entry.uncompressedSize || 0)
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > maxFileBytes) {
      throw new Error(`Seed 插件包文件大小无效：${path}`)
    }
    expandedBytes += declaredSize
    if (expandedBytes > maxExpandedBytes) throw new Error('Seed 插件包解压后超过大小上限。')
    const body = await entry.buffer()
    if (body.length !== declaredSize) throw new Error(`Seed 插件包文件大小不一致：${path}`)
    files.set(path, body)
  }

  const manifestBytes = files.get('manifest.yaml')
  const digestsBytes = files.get('META-INF/files.sha256')
  if (!manifestBytes || !digestsBytes) {
    throw new Error('Seed 插件包缺少 manifest 或摘要清单。')
  }

  const manifest = await loadSeedPluginManifest(async (path) => {
    const body = files.get(path)
    if (!body) throw new Error(`Seed 插件包缺少引用文件：${path}`)
    return body
  })
  if (options.expectedPluginId && manifest.id !== options.expectedPluginId) throw new Error('插件 ID 与下载请求不一致。')
  if (options.expectedVersion && manifest.version !== options.expectedVersion) throw new Error('插件版本与下载请求不一致。')
  const digests = parseDigestList(digestsBytes)
  const signedPaths = [...files.keys()]
    .filter((path) => path !== 'META-INF/files.sha256')
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
  if (digests.size !== signedPaths.length || signedPaths.some((path) => !digests.has(path))) {
    throw new Error('Seed 插件摘要清单没有完整覆盖包内容。')
  }
  for (const path of signedPaths) {
    const actual = createHash('sha256').update(files.get(path)!).digest('hex')
    if (digests.get(path) !== actual) throw new Error(`Seed 插件文件摘要不匹配：${path}`)
  }

  return { manifest, publisherId: manifest.publisher, packageSha256, files }
}
