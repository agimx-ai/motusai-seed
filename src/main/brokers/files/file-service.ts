import { createHash, randomUUID } from 'node:crypto'
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import ignore, { type Ignore } from 'ignore'
import { minimatch } from 'minimatch'
import { z } from 'zod'
import type { FilesystemRoot } from '../../../shared/contracts'

export type LocalFileMethod = 'list' | 'stat' | 'search' | 'find' | 'grep' | 'read' | 'read_binary' | 'mkdir' | 'write' | 'edit' | 'move' | 'delete'
export type TrashItem = (path: string) => Promise<void>
const relativePathSchema = z.string().max(2_048).transform((value, context) => {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '')
  if (!normalized || normalized === '.' || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    context.addIssue({ code: 'custom', message: '必须提供文件系统根目录内的相对路径。' })
    return z.NEVER
  }
  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\0'))) {
    context.addIssue({ code: 'custom', message: '相对路径包含不安全的路径片段。' })
    return z.NEVER
  }
  return segments.join('/')
})

const maxReadBytes = 1024 * 1024
const maxBinaryReadBytes = 64 * 1024 * 1024
const maxWriteBytes = 16 * 1024 * 1024
const maxSearchEntries = 20_000
const maxSearchResults = 100
const protectedSegments = new Set([
  '.cache',
  '.documentrevisions-v100',
  '.fseventsd',
  '.git',
  '.spotlight-v100',
  '.temp',
  '.temporaryitems',
  '.trash',
  '.trashes',
  '$recycle.bin',
  '__macosx',
  'node_modules',
  'system volume information',
])
const protectedNames = new Set([
  '.apdisk',
  '.directory',
  '.ds_store',
  '.localized',
  '.volumeicon.icns',
  'desktop.ini',
  'icon\r',
  'thumbs.db',
])
const sensitiveSegments = new Set(['.ssh', '.gnupg', '.aws', '.azure', '.kube', 'keychains'])
const sensitiveNames = [
  /^\.env(?:\..+)?$/i,
  /^\.(?:bash|mysql|node_repl|psql|python|sqlite|zsh)_history$/i,
  /^\.(?:git-credentials|netrc|npmrc)$/i,
  /^(?:credentials|id_ed25519|id_rsa)$/i,
  /\.(?:key|p12|pem|pfx)$/i,
]
const searchableExtensions = new Set(['.txt', '.md', '.json', '.yaml', '.yml', '.toml', '.ini', '.csv', '.tsv', '.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.xml', '.py', '.swift', '.java', '.cs', '.cpp', '.c', '.h', '.go', '.rs', '.sql'])

export class LocalFileError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'LocalFileError'
  }
}

function asString(value: unknown, field: string) {
  if (typeof value !== 'string') throw new LocalFileError('invalid_arguments', `${field} 必须是字符串。`)
  return value
}

function expectedHash(args: Record<string, unknown>) {
  return asString(args.expected_sha256 ?? args.expected_hash, 'expected_sha256')
}

function asOptionalPath(value: unknown) {
  if (value === undefined || value === null || value === '' || value === '.') return ''
  return relativePathSchema.parse(value)
}

function pathPolicyError(relativePath: string) {
  const segments = relativePath.split('/').filter(Boolean)
  const normalizedSegments = segments.map((segment) => segment.toLowerCase())
  if (normalizedSegments.some((segment) => sensitiveSegments.has(segment)) || segments.some((segment) => sensitiveNames.some((pattern) => pattern.test(segment)))) {
    return new LocalFileError('sensitive_path', '该路径可能包含凭据或密钥，本地连接器不允许访问。')
  }
  if (normalizedSegments.some((segment) => protectedSegments.has(segment) || protectedNames.has(segment))) {
    return new LocalFileError('protected_path', '该路径属于系统元数据、临时目录或内部管理目录，本地连接器不允许访问。')
  }
  return null
}

function assertPathAllowed(relativePath: string) {
  const error = pathPolicyError(relativePath)
  if (error) throw error
}

function isInside(root: string, target: string) {
  const value = relative(root, target)
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value))
}

async function sha256(path: string) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function isoDate(value: Date) {
  return value.toISOString()
}

type IgnoreRule = { base: string; matcher: Ignore }

async function ignoreRules(directory: string, inherited: IgnoreRule[]) {
  const contents = await readFile(resolve(directory, '.gitignore'), 'utf8').catch(() => '')
  return contents ? [...inherited, { base: directory, matcher: ignore().add(contents) }] : inherited
}

function isIgnored(absolutePath: string, rules: IgnoreRule[], directory = false) {
  return rules.some(({ base, matcher }) => {
    const relativePath = relative(base, absolutePath).split(sep).join('/')
    const candidate = directory ? `${relativePath}/` : relativePath
    return candidate !== '' && !candidate.startsWith('../') && matcher.ignores(candidate)
  })
}

export class LocalFileService {
  constructor(
    private roots: FilesystemRoot[],
    private backupRoot: string,
    private trashItem: TrashItem,
  ) {}

  replaceRoots(roots: FilesystemRoot[]) {
    this.roots = roots
  }

  async resolveProcessDirectory(rootId: string, pathValue: unknown, permission: 'read' | 'write') {
    const root = this.root(rootId, permission)
    const location = await this.target(root, pathValue, { existing: true, allowRoot: true })
    const metadata = await stat(location.target)
    if (!metadata.isDirectory()) throw new LocalFileError('directory_required', '进程工作目录必须是文件系统根目录内的文件夹。')
    return location.target
  }

  private root(id: string, permission: 'read' | 'write') {
    const root = this.roots.find((candidate) => candidate.id === id)
    if (!root) throw new LocalFileError('filesystem_root_missing', '文件系统根目录不可用。')
    if (!root.permissions.includes(permission)) throw new LocalFileError('permission_denied', `该目录没有${permission === 'read' ? '读取' : '写入'}权限。`)
    return root
  }

  private async target(filesystemRoot: FilesystemRoot, pathValue: unknown, options: { existing: boolean; allowRoot?: boolean }) {
    const relativePath = asOptionalPath(pathValue)
    if (!relativePath && !options.allowRoot) throw new LocalFileError('invalid_path', '必须提供文件系统根目录内的相对路径。')
    assertPathAllowed(relativePath)
    const rootPath = await realpath(filesystemRoot.rootPath)
    const candidate = resolve(rootPath, relativePath)
    if (!isInside(rootPath, candidate)) throw new LocalFileError('path_escape', '路径超出了文件系统根目录。')
    if (options.existing) {
      const metadata = await lstat(candidate).catch(() => null)
      if (!metadata) throw new LocalFileError('not_found', '文件或目录不存在。')
      if (metadata.isSymbolicLink()) throw new LocalFileError('symlink_forbidden', '不允许通过符号链接访问文件。')
      const canonical = await realpath(candidate)
      if (!isInside(rootPath, canonical)) throw new LocalFileError('path_escape', '路径解析后超出了文件系统根目录。')
      return { root: rootPath, target: canonical, relativePath }
    }
    const parent = await realpath(dirname(candidate)).catch(() => null)
    if (!parent || !isInside(rootPath, parent)) throw new LocalFileError('parent_missing', '目标文件的父目录不存在或超出文件系统根目录。')
    return { root: rootPath, target: candidate, relativePath }
  }

  private async backup(root: FilesystemRoot, target: string) {
    const metadata = await stat(target).catch(() => null)
    if (!metadata) return undefined
    if (!metadata.isFile()) throw new LocalFileError('regular_file_required', '当前版本只允许修改或删除普通文件。')
    const folder = resolve(this.backupRoot, root.id)
    await mkdir(folder, { recursive: true })
    const backupId = `${Date.now()}-${randomUUID()}-${basename(target)}`
    await copyFile(target, resolve(folder, backupId))
    return backupId
  }

  async execute(method: LocalFileMethod, rootId: string, args: Record<string, unknown>) {
    switch (method) {
      case 'list': return this.list(rootId, args)
      case 'stat': return this.stat(rootId, args)
      case 'search': return this.search(rootId, args)
      case 'find': return this.find(rootId, args)
      case 'grep': return this.grep(rootId, args)
      case 'read': return this.read(rootId, args)
      case 'read_binary': return this.readBinary(rootId, args)
      case 'mkdir': return this.mkdir(rootId, args)
      case 'write': return this.write(rootId, args)
      case 'edit': return this.edit(rootId, args)
      case 'move': return this.move(rootId, args)
      case 'delete': return this.delete(rootId, args)
    }
  }

  private async list(rootId: string, args: Record<string, unknown>) {
    const root = this.root(rootId, 'read')
    const location = await this.target(root, args.path, { existing: true, allowRoot: true })
    const metadata = await stat(location.target)
    if (!metadata.isDirectory()) throw new LocalFileError('directory_required', 'list 只能用于目录。')
    const entries = await readdir(location.target, { withFileTypes: true })
    const maximum = Math.min(500, Math.max(1, Math.floor(Number(args.limit || 500))))
    const allowedEntries = entries
      .filter((entry) => !pathPolicyError([location.relativePath, entry.name].filter(Boolean).join('/')))
      .sort((left, right) => left.name.localeCompare(right.name))
    const visible = await Promise.all(allowedEntries
      .slice(0, maximum)
      .map(async (entry) => {
        const childPath = resolve(location.target, entry.name)
        const child = await lstat(childPath)
        return {
          name: entry.name,
          path: [location.relativePath, entry.name].filter(Boolean).join('/'),
          type: child.isSymbolicLink() ? 'symlink' : child.isDirectory() ? 'directory' : child.isFile() ? 'file' : 'other',
          size: child.isFile() ? child.size : undefined,
          modified_at: isoDate(child.mtime),
        }
      }))
    return { path: location.relativePath, entries: visible, truncated: allowedEntries.length > visible.length }
  }

  private async stat(rootId: string, args: Record<string, unknown>) {
    const root = this.root(rootId, 'read')
    const location = await this.target(root, args.path, { existing: true, allowRoot: true })
    const metadata = await stat(location.target)
    return {
      path: location.relativePath,
      type: metadata.isDirectory() ? 'directory' : metadata.isFile() ? 'file' : 'other',
      size: metadata.size,
      modified_at: isoDate(metadata.mtime),
      ...(metadata.isFile() && metadata.size <= maxWriteBytes ? { sha256: await sha256(location.target) } : {}),
    }
  }

  private async search(rootId: string, args: Record<string, unknown>) {
    const root = this.root(rootId, 'read')
    const query = asString(args.query, 'query').trim()
    if (!query) throw new LocalFileError('invalid_arguments', '搜索内容不能为空。')
    const location = await this.target(root, args.path, { existing: true, allowRoot: true })
    const needle = query.toLocaleLowerCase()
    const results: Array<{ path: string; kind: 'name' | 'content'; preview?: string }> = []
    const queue = [location.target]
    let visited = 0
    while (queue.length && visited < maxSearchEntries && results.length < maxSearchResults) {
      const current = queue.shift()!
      for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
        visited += 1
        if (visited >= maxSearchEntries) break
        const absolute = resolve(current, entry.name)
        const relativeName = relative(location.root, absolute).split(sep).join('/')
        if (pathPolicyError(relativeName)) continue
        if (entry.isDirectory()) {
          queue.push(absolute)
          if (entry.name.toLocaleLowerCase().includes(needle)) results.push({ path: relativeName, kind: 'name' })
          continue
        }
        if (!entry.isFile()) continue
        if (entry.name.toLocaleLowerCase().includes(needle)) {
          results.push({ path: relativeName, kind: 'name' })
          continue
        }
        const metadata = await stat(absolute)
        if (metadata.size > 256 * 1024 || !searchableExtensions.has(extname(entry.name).toLocaleLowerCase())) continue
        const content = await readFile(absolute, 'utf8').catch(() => '')
        const index = content.toLocaleLowerCase().indexOf(needle)
        if (index >= 0) results.push({
          path: relativeName,
          kind: 'content',
          preview: content.slice(Math.max(0, index - 80), Math.min(content.length, index + query.length + 120)).replace(/\s+/g, ' '),
        })
      }
    }
    return { query, results, truncated: visited >= maxSearchEntries || results.length >= maxSearchResults, visited }
  }

  private async find(rootId: string, args: Record<string, unknown>) {
    const root = this.root(rootId, 'read')
    const pattern = asString(args.pattern, 'pattern').trim()
    if (!pattern) throw new LocalFileError('invalid_arguments', '查找模式不能为空。')
    const location = await this.target(root, args.path, { existing: true, allowRoot: true })
    const metadata = await stat(location.target)
    const maximum = Math.min(maxSearchEntries, Math.max(1, Math.floor(Number(args.limit || 1_000))))
    const paths: string[] = []
    let visited = 0
    if (!metadata.isDirectory()) {
      const name = basename(location.target)
      if (minimatch(name, pattern, { dot: true, matchBase: !pattern.includes('/') })) paths.push(location.relativePath)
      return { pattern, paths, truncated: false, visited: 1 }
    }
    const queue: Array<{ absolute: string; relativeToSearch: string; rules: IgnoreRule[] }> = [{ absolute: location.target, relativeToSearch: '', rules: [] }]
    while (queue.length && visited < maxSearchEntries && paths.length < maximum) {
      const current = queue.shift()!
      const rules = await ignoreRules(current.absolute, current.rules)
      const entries = await readdir(current.absolute, { withFileTypes: true }).catch(() => [])
      entries.sort((left, right) => left.name.localeCompare(right.name))
      for (const entry of entries) {
        visited += 1
        if (visited > maxSearchEntries) break
        const relativeToSearch = [current.relativeToSearch, entry.name].filter(Boolean).join('/')
        const rootRelative = [location.relativePath, relativeToSearch].filter(Boolean).join('/')
        const absolute = resolve(current.absolute, entry.name)
        if (pathPolicyError(rootRelative) || entry.isSymbolicLink() || isIgnored(absolute, rules, entry.isDirectory())) continue
        const candidate = entry.isDirectory() ? `${relativeToSearch}/` : relativeToSearch
        if (minimatch(candidate, pattern, { dot: true, matchBase: !pattern.includes('/') })) paths.push(rootRelative + (entry.isDirectory() ? '/' : ''))
        if (paths.length >= maximum) break
        if (entry.isDirectory()) queue.push({ absolute, relativeToSearch, rules })
      }
    }
    return { pattern, paths, truncated: visited >= maxSearchEntries || paths.length >= maximum, visited }
  }

  private async grep(rootId: string, args: Record<string, unknown>) {
    const root = this.root(rootId, 'read')
    const pattern = asString(args.pattern, 'pattern')
    if (!pattern) throw new LocalFileError('invalid_arguments', '搜索模式不能为空。')
    const location = await this.target(root, args.path, { existing: true, allowRoot: true })
    const literal = args.literal === true
    let expression: RegExp
    try {
      expression = new RegExp(literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern, args.ignore_case === true || args.ignoreCase === true ? 'i' : '')
    } catch (error) {
      throw new LocalFileError('invalid_pattern', `搜索模式无效：${error instanceof Error ? error.message : String(error)}`)
    }
    const glob = typeof args.glob === 'string' && args.glob.trim() ? args.glob.trim() : ''
    const context = Math.min(20, Math.max(0, Math.floor(Number(args.context || 0))))
    const maximum = Math.min(10_000, Math.max(1, Math.floor(Number(args.limit || 100))))
    const matches: Array<{ path: string; line: number; text: string; before?: string[]; after?: string[] }> = []
    let visited = 0
    const metadata = await stat(location.target)
    const queue: Array<{ absolute: string; rules: IgnoreRule[] }> = metadata.isDirectory() ? [{ absolute: location.target, rules: [] }] : []
    const files = metadata.isFile() ? [location.target] : []
    while (queue.length && visited < maxSearchEntries) {
      const current = queue.shift()!
      const rules = await ignoreRules(current.absolute, current.rules)
      const entries = await readdir(current.absolute, { withFileTypes: true }).catch(() => [])
      entries.sort((left, right) => left.name.localeCompare(right.name))
      for (const entry of entries) {
        visited += 1
        if (visited > maxSearchEntries) break
        const absolute = resolve(current.absolute, entry.name)
        const rootRelative = relative(location.root, absolute).split(sep).join('/')
        if (pathPolicyError(rootRelative) || entry.isSymbolicLink() || isIgnored(absolute, rules, entry.isDirectory())) continue
        if (entry.isDirectory()) queue.push({ absolute, rules })
        else if (entry.isFile()) files.push(absolute)
      }
    }
    for (const absolute of files) {
      const rootRelative = relative(location.root, absolute).split(sep).join('/')
      const relativeToSearch = metadata.isDirectory() ? relative(location.target, absolute).split(sep).join('/') : basename(absolute)
      if (glob && !minimatch(relativeToSearch, glob, { dot: true, matchBase: !glob.includes('/') })) continue
      const fileMetadata = await stat(absolute)
      if (fileMetadata.size > maxReadBytes) continue
      const content = await readFile(absolute).catch(() => null)
      if (!content || content.subarray(0, 8_192).includes(0)) continue
      const lines = content.toString('utf8').replace(/\r\n?/g, '\n').split('\n')
      for (let index = 0; index < lines.length && matches.length < maximum; index += 1) {
        if (!expression.test(lines[index] || '')) continue
        matches.push({
          path: rootRelative,
          line: index + 1,
          text: (lines[index] || '').slice(0, 2_000),
          ...(context ? { before: lines.slice(Math.max(0, index - context), index).map((line) => line.slice(0, 2_000)) } : {}),
          ...(context ? { after: lines.slice(index + 1, index + context + 1).map((line) => line.slice(0, 2_000)) } : {}),
        })
      }
      if (matches.length >= maximum) break
    }
    return { pattern, matches, truncated: visited >= maxSearchEntries || matches.length >= maximum, visited }
  }

  private async read(rootId: string, args: Record<string, unknown>) {
    const root = this.root(rootId, 'read')
    const location = await this.target(root, args.path, { existing: true })
    const metadata = await stat(location.target)
    if (!metadata.isFile()) throw new LocalFileError('regular_file_required', 'read 只能用于普通文件。')
    const offset = Math.max(0, Math.floor(Number(args.offset || 0)))
    const length = Math.min(maxReadBytes, Math.max(1, Math.floor(Number(args.length || maxReadBytes))))
    const handle = await open(location.target, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(length, Math.max(0, metadata.size - offset)))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
      const value = buffer.subarray(0, bytesRead)
      if (value.includes(0)) throw new LocalFileError('binary_file', '该文件是二进制文件，请使用文件导入能力处理。')
      return {
        path: location.relativePath,
        content: value.toString('utf8'),
        offset,
        bytes_read: bytesRead,
        size: metadata.size,
        truncated: offset + bytesRead < metadata.size,
        sha256: await sha256(location.target),
      }
    } finally {
      await handle.close()
    }
  }

  private async readBinary(rootId: string, args: Record<string, unknown>) {
    const root = this.root(rootId, 'read')
    const location = await this.target(root, args.path, { existing: true })
    const metadata = await stat(location.target)
    if (!metadata.isFile()) throw new LocalFileError('regular_file_required', 'read_binary 只能用于普通文件。')
    if (metadata.size > maxBinaryReadBytes) throw new LocalFileError('file_too_large', '二进制文件不能超过 64 MiB。')
    const body = await readFile(location.target)
    return {
      path: location.relativePath,
      content_base64: body.toString('base64'),
      size: body.byteLength,
      sha256: createHash('sha256').update(body).digest('hex'),
    }
  }

  private async mkdir(rootId: string, args: Record<string, unknown>) {
    const filesystemRoot = this.root(rootId, 'write')
    const relativePath = asOptionalPath(args.path)
    if (!relativePath) throw new LocalFileError('invalid_path', '必须提供要创建的相对目录路径。')
    assertPathAllowed(relativePath)
    const rootPath = await realpath(filesystemRoot.rootPath)
    let current = rootPath
    let created = false
    for (const segment of relativePath.split('/')) {
      current = resolve(current, segment)
      if (!isInside(rootPath, current)) throw new LocalFileError('path_escape', '目录路径超出了文件系统根目录。')
      const metadata = await lstat(current).catch(() => null)
      if (metadata?.isSymbolicLink()) throw new LocalFileError('symlink_forbidden', '不允许通过符号链接创建目录。')
      if (metadata && !metadata.isDirectory()) throw new LocalFileError('directory_required', '目录路径中存在同名文件。')
      if (!metadata) {
        await mkdir(current, { mode: 0o700 })
        created = true
      }
      const canonical = await realpath(current)
      if (!isInside(rootPath, canonical)) throw new LocalFileError('path_escape', '目录解析后超出了文件系统根目录。')
      current = canonical
    }
    return { path: relativePath, created }
  }

  private async write(rootId: string, args: Record<string, unknown>) {
    const root = this.root(rootId, 'write')
    const location = await this.target(root, args.path, { existing: false })
    const content = asString(args.content, 'content')
    if (Buffer.byteLength(content) > maxWriteBytes) throw new LocalFileError('file_too_large', '单次写入内容不能超过 16 MiB。')
    const current = await lstat(location.target).catch(() => null)
    if (current?.isSymbolicLink()) throw new LocalFileError('symlink_forbidden', '不允许通过符号链接写入文件。')
    if (current && !current.isFile()) throw new LocalFileError('regular_file_required', '目标路径不是普通文件。')
    if (current) {
      const expected = expectedHash(args)
      if (await sha256(location.target) !== expected) throw new LocalFileError('content_conflict', '文件已发生变化，拒绝覆盖新版本。')
    }
    const backupId = await this.backup(root, location.target)
    const temporary = resolve(dirname(location.target), `.${basename(location.target)}.${randomUUID()}.motusai-tmp`)
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, location.target)
    return { path: location.relativePath, size: Buffer.byteLength(content), sha256: await sha256(location.target), backup_id: backupId }
  }

  private async edit(rootId: string, args: Record<string, unknown>) {
    const root = this.root(rootId, 'write')
    if (!root.permissions.includes('read')) throw new LocalFileError('permission_denied', '编辑文件同时需要读取权限。')
    const location = await this.target(root, args.path, { existing: true })
    const expected = expectedHash(args)
    if (await sha256(location.target) !== expected) throw new LocalFileError('content_conflict', '文件已发生变化，请重新读取后再编辑。')
    const replacements = Array.isArray(args.replacements) ? args.replacements : []
    if (!replacements.length || replacements.length > 100) throw new LocalFileError('invalid_arguments', 'replacements 必须包含 1 到 100 项替换。')
    let content = await readFile(location.target, 'utf8')
    for (const raw of replacements) {
      const replacement = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
      const oldText = asString(replacement.old_text, 'old_text')
      const newText = asString(replacement.new_text, 'new_text')
      const first = content.indexOf(oldText)
      if (first < 0) throw new LocalFileError('edit_target_missing', '需要替换的原文不存在，文件可能已被修改。')
      if (replacement.replace_all === true) content = content.split(oldText).join(newText)
      else {
        if (content.indexOf(oldText, first + oldText.length) >= 0) throw new LocalFileError('edit_target_ambiguous', '需要替换的原文出现多次，请提供更完整的上下文。')
        content = `${content.slice(0, first)}${newText}${content.slice(first + oldText.length)}`
      }
    }
    return this.write(rootId, { path: location.relativePath, content, expected_hash: expected })
  }

  private async move(rootId: string, args: Record<string, unknown>) {
    const root = this.root(rootId, 'write')
    const source = await this.target(root, args.path, { existing: true })
    const destination = await this.target(root, args.destination_path, { existing: false })
    if (await stat(destination.target).catch(() => null)) throw new LocalFileError('destination_exists', '目标路径已经存在。')
    await rename(source.target, destination.target)
    return { path: source.relativePath, destination_path: destination.relativePath }
  }

  private async delete(rootId: string, args: Record<string, unknown>) {
    const root = this.root(rootId, 'write')
    const location = await this.target(root, args.path, { existing: true })
    const metadata = await stat(location.target)
    const backupId = metadata.isFile() ? await this.backup(root, location.target) : undefined
    await this.trashItem(location.target)
    return { path: location.relativePath, deleted: true, trashed: true, recoverable: true, backup_id: backupId }
  }

}
