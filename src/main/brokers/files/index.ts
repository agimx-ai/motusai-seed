import { existsSync, watch, type FSWatcher } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { SeedInvocation } from '@motus-ai/seed-sdk'
import type { FilesystemRoot } from '../../../shared/contracts'
import {
  isFilePathVisible,
  LocalFileError,
  LocalFileService,
  type LocalFileMethod,
  type TrashItem,
} from './file-service'

const fileMethods = ['list', 'stat', 'search', 'find', 'grep', 'read', 'read_binary', 'mkdir', 'write', 'write_binary', 'edit', 'move', 'delete'] as const

type FileWatchEvent = {
  cursor: number
  kind: 'change' | 'rename' | 'resync'
  path: string
  observed_at: string
}

type FileWatchSession = {
  watcher: FSWatcher
  cursor: number
  events: FileWatchEvent[]
  error: Error | null
  waiters: Set<() => void>
  expires?: ReturnType<typeof setTimeout>
}

export type FileBrokerConfiguration = {
  backup_root: string
}

const filesystemRootTimestamp = '1970-01-01T00:00:00.000Z'

export function filesystemRoots(): FilesystemRoot[] {
  const roots = process.platform === 'win32'
    ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `${letter}:\\`).filter(existsSync)
    : ['/']
  return roots.map((rootPath, index) => ({
    id: `filesystem-${index}`,
    label: process.platform === 'win32' ? rootPath : 'Filesystem',
    displayPath: rootPath,
    rootPath,
    permissions: ['read', 'write'],
    createdAt: filesystemRootTimestamp,
    updatedAt: filesystemRootTimestamp,
  }))
}

function withDisplayPaths(
  roots: FilesystemRoot[],
  method: string,
  rootId: string,
  argumentsValue: Record<string, unknown>,
  result: unknown,
) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result
  if (method === 'read_binary') return result
  const root = roots.find((candidate) => candidate.id === rootId)
  if (!root) return result
  const relativePath = typeof argumentsValue.path === 'string' ? argumentsValue.path : ''
  const destinationPath = typeof argumentsValue.destination_path === 'string' ? argumentsValue.destination_path : ''
  const value = result as Record<string, unknown>
  const absoluteItemPath = (item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const record = item as Record<string, unknown>
    return typeof record.path === 'string'
      ? { ...record, path: resolve(root.rootPath, record.path) }
      : item
  }
  return {
    ...result,
    display_path: resolve(root.rootPath, relativePath),
    ...(method === 'list' && Array.isArray(value.entries)
      ? { entries: value.entries.map(absoluteItemPath) }
      : {}),
    ...(method === 'find' && Array.isArray(value.paths)
      ? { paths: value.paths.map((path) => typeof path === 'string' ? resolve(root.rootPath, path) : path) }
      : {}),
    ...(method === 'search' && Array.isArray(value.results)
      ? { results: value.results.map(absoluteItemPath) }
      : {}),
    ...(method === 'grep' && Array.isArray(value.matches)
      ? { matches: value.matches.map(absoluteItemPath) }
      : {}),
    ...(method === 'move' && destinationPath
      ? { destination_display_path: resolve(root.rootPath, destinationPath) }
      : {}),
  }
}

/**
 * Trusted local file boundary. Sandboxed plugins use this broker instead of
 * Node.js file APIs so protected paths, symlinks, and path escapes stay blocked.
 */
export class FileBroker {
  private service: LocalFileService | null = null
  private backupRoot = ''
  private readonly watches = new Map<string, FileWatchSession>()

  constructor(
    private readonly configuration: () => FileBrokerConfiguration,
    private readonly trashItem: TrashItem,
  ) {}

  private current() {
    return { ...this.configuration(), roots: filesystemRoots() }
  }

  private fileService(value: FileBrokerConfiguration & { roots: FilesystemRoot[] }) {
    if (!this.service || this.backupRoot !== value.backup_root) {
      this.backupRoot = value.backup_root
      this.service = new LocalFileService(value.roots, value.backup_root, this.trashItem)
    } else {
      this.service.replaceRoots(value.roots)
    }
    return this.service
  }

  async invoke(method: string, request: SeedInvocation) {
    const value = this.current()
    if (method === 'roots') {
      return value.roots.map((root) => ({
        id: root.id,
        label: root.label,
        display_path: root.rootPath,
        permissions: root.permissions,
      }))
    }
    let args = request.arguments
    // Binary producers can use an absolute destination without discovering a root via another plugin.
    if (method === 'write_binary' && !args.root_id && typeof args.path === 'string' && isAbsolute(args.path)) {
      const path = args.path
      const root = value.roots.find((candidate) => {
        const boundary = relative(candidate.rootPath, path)
        return boundary !== '..' && !boundary.startsWith(`..${sep}`) && !isAbsolute(boundary)
      })
      if (root) args = { ...args, root_id: root.id, path: relative(root.rootPath, path) }
    }
    const rootId = String(args.root_id || '')
    if (!rootId || (method !== 'watch' && !fileMethods.includes(method as typeof fileMethods[number]))) {
      throw new LocalFileError('invalid_arguments', '文件能力请求缺少有效的 root_id 或方法。')
    }
    if (method === 'watch') return await this.watchChanges(value, rootId, args)
    const result = await this.fileService(value).execute(method as LocalFileMethod, rootId, args)
    return withDisplayPaths(value.roots, method, rootId, args, result)
  }

  private async watchChanges(
    value: FileBrokerConfiguration & { roots: FilesystemRoot[] },
    rootId: string,
    args: Record<string, unknown>,
  ) {
    const directory = await this.fileService(value).resolveWatchDirectory(rootId, args.path)
    const key = JSON.stringify([rootId, directory.target])
    let session = this.watches.get(key)
    if (!session) {
      let created!: FileWatchSession
      const watcher = watch(directory.target, { recursive: true }, (kind, filename) => {
        const raw = filename?.toString().replaceAll('\\', '/') || ''
        const segments = raw.split('/').filter(Boolean)
        const safe = raw && !raw.startsWith('/') && !segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0'))
        const path = safe ? [directory.relativePath, ...segments].filter(Boolean).join('/') : ''
        const event: FileWatchEvent = {
          cursor: ++created.cursor,
          kind: path ? kind : 'resync',
          path: path && isFilePathVisible(path) ? path : '',
          observed_at: new Date().toISOString(),
        }
        if (!event.path) event.kind = 'resync'
        created.events.push(event)
        if (created.events.length > 2_000) created.events.splice(0, created.events.length - 2_000)
        for (const wake of created.waiters) wake()
        created.waiters.clear()
      })
      created = { watcher, cursor: 0, events: [], error: null, waiters: new Set() }
      session = created
      this.watches.set(key, session)
      watcher.on('error', (error) => {
        created.error = error
        if (this.watches.get(key) === created) this.watches.delete(key)
        if (created.expires) clearTimeout(created.expires)
        created.watcher.close()
        for (const wake of created.waiters) wake()
        created.waiters.clear()
      })
    }

    this.keepWatchAlive(key, session)
    const after = Math.max(0, Math.floor(Number(args.after) || 0))
    const waitMs = Math.min(10_000, Math.max(0, Math.floor(Number(args.wait_ms) || 0)))
    if (!session.error && !session.events.some((event) => event.cursor > after) && waitMs > 0) {
      await new Promise<void>((resolveWait) => {
        const done = () => {
          clearTimeout(timer)
          session!.waiters.delete(done)
          resolveWait()
        }
        const timer = setTimeout(done, waitMs)
        session!.waiters.add(done)
      })
    }
    if (session.error) throw new LocalFileError('watch_failed', session.error.message)

    const oldest = session.events[0]?.cursor ?? session.cursor + 1
    if (after < oldest - 1) {
      return {
        events: [{ cursor: session.cursor, kind: 'resync', path: '', observed_at: new Date().toISOString() }],
        next: session.cursor,
      }
    }
    return {
      events: session.events.filter((event) => event.cursor > after),
      next: Math.max(after, session.cursor),
    }
  }

  private keepWatchAlive(key: string, session: FileWatchSession) {
    if (session.expires) clearTimeout(session.expires)
    session.expires = setTimeout(() => {
      if (this.watches.get(key) !== session) return
      this.watches.delete(key)
      session.watcher.close()
      for (const wake of session.waiters) wake()
      session.waiters.clear()
    }, 30_000)
    session.expires.unref?.()
  }

  dispose() {
    for (const session of this.watches.values()) {
      if (session.expires) clearTimeout(session.expires)
      session.watcher.close()
      for (const wake of session.waiters) wake()
      session.waiters.clear()
    }
    this.watches.clear()
  }

  async resolveProcessDirectory(rootId: string, relativePath: unknown, permission: 'read' | 'write') {
    const value = this.current()
    return await this.fileService(value).resolveProcessDirectory(rootId, relativePath, permission)
  }
}
