import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { SeedInvocation } from '@motusai/seed-sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileBroker, filesystemRoots } from './index'

describe('FileBroker', () => {
  let root = ''
  let backupRoot = ''
  let broker: FileBroker

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'motusai-seed-broker-root-'))
    backupRoot = await mkdtemp(join(tmpdir(), 'motusai-seed-broker-backup-'))
    broker = new FileBroker(() => ({
      backup_root: backupRoot,
    }), async () => {})
  })

  afterEach(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(backupRoot, { recursive: true, force: true }),
    ])
  })

  function invocation(path: string): SeedInvocation {
    const filesystemRoot = filesystemRoots().find((candidate) => {
      const value = relative(resolve(candidate.rootPath), resolve(root))
      return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value))
    })!
    return {
      request_id: 'request-1',
      arguments: { root_id: filesystemRoot.id, path: relative(filesystemRoot.rootPath, join(root, path)) },
    }
  }

  it('does not expose an absolute display path when reading binary bytes', async () => {
    await writeFile(join(root, 'candidate.pdf'), Buffer.from([0, 1, 2, 3]))

    const result = await broker.invoke('read_binary', invocation('candidate.pdf')) as Record<string, unknown>

    expect(result.path).toBe(relative(filesystemRoots()[0]!.rootPath, join(root, 'candidate.pdf')))
    expect(result).not.toHaveProperty('display_path')
    expect(JSON.stringify(result)).not.toContain(root)
  })

  it('continues adding display paths to user-facing file operations', async () => {
    await writeFile(join(root, 'notes.txt'), 'hello seed')

    const result = await broker.invoke('read', invocation('notes.txt')) as Record<string, unknown>

    expect(result.display_path).toBe(join(root, 'notes.txt'))
  })
})
