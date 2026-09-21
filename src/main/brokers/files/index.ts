import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SeedInvocation } from '@motusai/seed-sdk'
import type { FilesystemRoot } from '../../../shared/contracts'
import { LocalFileError, LocalFileService, type LocalFileMethod, type TrashItem } from './file-service'

const fileMethods = ['list', 'stat', 'search', 'find', 'grep', 'read', 'read_binary', 'mkdir', 'write', 'edit', 'move', 'delete'] as const

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
  return {
    ...result,
    display_path: resolve(root.rootPath, relativePath),
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
    const rootId = String(request.arguments.root_id || '')
    if (!rootId || !fileMethods.includes(method as typeof fileMethods[number])) {
      throw new LocalFileError('invalid_arguments', '文件能力请求缺少有效的 root_id 或方法。')
    }
    const result = await this.fileService(value).execute(method as LocalFileMethod, rootId, request.arguments)
    return withDisplayPaths(value.roots, method, rootId, request.arguments, result)
  }

  async resolveProcessDirectory(rootId: string, relativePath: unknown, permission: 'read' | 'write') {
    const value = this.current()
    return await this.fileService(value).resolveProcessDirectory(rootId, relativePath, permission)
  }
}
