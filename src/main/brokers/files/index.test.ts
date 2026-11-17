import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { SeedInvocation } from '@motus-ai/seed-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileBroker, filesystemRoots } from './index'
import { fileBrokerPermissions } from './permissions'

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
    broker.dispose()
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

  it('supports absolute binary destinations without granting root discovery or overwriting files', async () => {
    const path = join(root, 'capture.png')
    const request = { request_id: 'binary', arguments: { path, content_base64: 'AP/+', create_only: true } }
    expect(fileBrokerPermissions('write_binary')).toEqual(['resources.directory.write'])
    expect(fileBrokerPermissions('watch')).toEqual(['resources.directory.read'])
    expect(fileBrokerPermissions('unknown')).toBeNull()
    const saved = await broker.invoke('write_binary', request) as { display_path: string }
    expect(saved.display_path).toBe(path)
    expect(await readFile(path)).toEqual(Buffer.from([0, 255, 254]))
    await expect(broker.invoke('write_binary', request)).rejects.toMatchObject({ code: 'destination_exists' })
    await expect(broker.invoke('write_binary', { request_id: 'relative', arguments: { path: 'capture.png', content_base64: 'AA==' } }))
      .rejects.toMatchObject({ code: 'invalid_arguments' })
  })

  it('publishes a complete copy, preserves original bytes and protects concurrent destinations', async () => {
    expect(fileBrokerPermissions('copy')).toEqual(['resources.directory.read', 'resources.directory.write'])
    const source = join(root, '原始 文件.bin')
    const destination = join(root, 'copies', '原始 文件.bin')
    const other = join(root, 'other.bin')
    const bytes = Buffer.alloc(17 * 1024 * 1024, 0xfe)
    await mkdir(join(root, 'copies'))
    await Promise.all([writeFile(source, bytes), writeFile(other, 'other')])
    const invokeCopy = (sourcePath: string, id: string) => broker.invoke('copy', {
      request_id: id, arguments: { source_path: sourcePath, destination_path: destination },
    }) as Promise<{ status: string; size?: number }>
    const [first, second] = await Promise.all([invokeCopy(source, 'first'), invokeCopy(other, 'second')])
    expect([first.status, second.status].sort()).toEqual(['copied', 'destination_exists'])
    expect((await readFile(destination)).equals(first.status === 'copied' ? bytes : Buffer.from('other'))).toBe(true)
    expect((await readFile(source)).equals(bytes)).toBe(true)
    expect(await readdir(join(root, 'copies'))).toEqual(['原始 文件.bin'])

    const largeCopy = join(root, 'copies', 'large.bin')
    await expect(broker.invoke('copy', { request_id: 'large', arguments: { source_path: source, destination_path: largeCopy } }))
      .resolves.toMatchObject({ status: 'copied', destination_path: largeCopy, size: bytes.length })
    expect((await readFile(largeCopy)).equals(bytes)).toBe(true)
  })

  it('rejects sensitive paths and symlinks and scopes cancellation to the owning plugin', async () => {
    const source = join(root, 'document.bin')
    const destination = join(root, 'copy.bin')
    await writeFile(source, Buffer.alloc(1024))
    const invoke = (sourcePath: string) => broker.invoke('copy', { request_id: 'copy', arguments: { source_path: sourcePath, destination_path: destination } }, undefined, 'files')
    await expect(invoke(join(root, '.env'))).rejects.toMatchObject({ code: 'sensitive_path' })
    if (process.platform !== 'win32') {
      const alias = join(root, 'alias.bin')
      await symlink(source, alias)
      await expect(invoke(alias)).rejects.toMatchObject({ code: 'symlink_forbidden' })
    }

    const copying = invoke(source)
    const cancel = { request_id: 'copy', arguments: {} }
    await expect(broker.invoke('cancel_copy', cancel, undefined, 'other')).resolves.toEqual({ cancelled: false })
    await expect(broker.invoke('cancel_copy', cancel, undefined, 'files')).resolves.toEqual({ cancelled: true })
    await expect(copying).rejects.toMatchObject({ code: 'invocation_cancelled' })
    expect(await readdir(root)).not.toContain('copy.bin')
    expect((await readdir(root)).some((entry) => entry.endsWith('.motusai-tmp'))).toBe(false)
  })

  it('paginates the complete directory when explicitly requested without changing the legacy listing', async () => {
    await Promise.all(Array.from({ length: 503 }, (_, index) => writeFile(join(root, `item-${String(index).padStart(3, '0')}.txt`), '')))
    const request = invocation('')
    const first = await broker.invoke('list', { ...request, arguments: { ...request.arguments, page_after: '' } }) as any
    const next = await broker.invoke('list', { ...request, arguments: { ...request.arguments, page_after: first.next_page } }) as any
    const legacy = await broker.invoke('list', request) as any
    expect(first.entries).toHaveLength(500)
    expect(next.entries.map((entry: { name: string }) => entry.name)).toEqual(['item-500.txt', 'item-501.txt', 'item-502.txt'])
    expect(next.next_page).toBeNull()
    expect(legacy).not.toHaveProperty('next_page')
    expect(legacy.entries).toHaveLength(500)
  })

  it('cleans up an in-progress stream when its owning runtime becomes stale', async () => {
    const source = join(root, 'large-source.bin')
    const destination = join(root, 'destination.bin')
    await writeFile(source, Buffer.alloc(2 * 1024 * 1024))
    let checks = 0
    const suspended = new Error('runtime generation changed')
    await expect(broker.invoke('copy', {
      request_id: 'stale', arguments: { source_path: source, destination_path: destination },
    }, () => { if (++checks === 4) throw suspended })).rejects.toThrow(suspended)
    expect(await readdir(root)).toEqual(['large-source.bin'])
  })

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
    expect(result.path).toBe(relative(filesystemRoots()[0]!.rootPath, join(root, 'notes.txt')))
  })

  it('returns absolute file paths from list and find for reuse by other tools', async () => {
    await writeFile(join(root, '印刷企业进销存.xlsx'), 'test workbook')

    const listed = await broker.invoke('list', invocation('')) as {
      entries: Array<{ path: string }>
    }
    const found = await broker.invoke('find', {
      ...invocation(''),
      arguments: { ...invocation('').arguments, pattern: '*.xlsx' },
    }) as { paths: string[] }

    expect(listed.entries).toEqual([expect.objectContaining({
      path: join(root, '印刷企业进销存.xlsx'),
    })])
    expect(found.paths).toEqual([join(root, '印刷企业进销存.xlsx')])
  })

  it('returns absolute paths for content-search matches too', async () => {
    await writeFile(join(root, 'notes.txt'), '印刷企业进销存')
    const canonicalPath = await realpath(join(root, 'notes.txt'))

    const result = await broker.invoke('grep', {
      ...invocation(''),
      arguments: { ...invocation('').arguments, pattern: '印刷企业进销存', literal: true },
    }) as { matches: Array<{ path: string }> }

    expect(result.matches).toEqual([expect.objectContaining({
      path: canonicalPath,
    })])
  })

  it('watches an authorized directory and returns root-relative change events', async () => {
    const pending = broker.invoke('watch', {
      ...invocation(''),
      arguments: { ...invocation('').arguments, after: 0, wait_ms: 2_000 },
    }) as Promise<{ events: Array<{ kind: string; path: string }>; next: number }>
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    await writeFile(join(root, 'changed.md'), 'hello')

    let result = await pending
    const expectedPath = relative(filesystemRoots()[0]!.rootPath, join(root, 'changed.md')).split(sep).join('/')
    // Native watchers may report the directory itself before the file write.
    // Follow the cursor until the requested change arrives instead of assuming the first batch contains it.
    await vi.waitFor(async () => {
      if (!result.events.some((event) => event.path === expectedPath)) {
        result = await broker.invoke('watch', {
          ...invocation(''),
          arguments: { ...invocation('').arguments, after: result.next, wait_ms: 500 },
        }) as typeof result
      }
      expect(result.next).toBeGreaterThan(0)
      expect(result.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: expectedPath }),
      ]))
    }, { timeout: 5_000 })
  })

  it('signals a reset to an opt-in caller when its previous watcher generation is gone', async () => {
    const request = invocation('')
    const before = await broker.invoke('watch', request) as { watch_id: string }
    broker.dispose()
    const after = await broker.invoke('watch', { ...request, arguments: { ...request.arguments, after: 100, watch_id: before.watch_id } })
    expect(after).toMatchObject({ watch_id: expect.not.stringMatching(before.watch_id), resync: true, next: 0, events: [] })
  })
})
