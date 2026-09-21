import { mkdtemp, mkdir, readFile, readdir, realpath, rename, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { LocalFileService } from './file-service'
import type { FilesystemRoot } from '../../../shared/contracts'

describe('LocalFileService', () => {
  let root = ''
  let backupRoot = ''
  let service: LocalFileService
  let filesystemRoot: FilesystemRoot
  let trashedPaths: string[]

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'motusai-seed-root-'))
    backupRoot = await mkdtemp(join(tmpdir(), 'motusai-seed-backup-'))
    filesystemRoot = {
      id: '42b0744d-13c6-42c6-b618-b0d95902c1d0',
      rootPath: root,
      displayPath: root,
      label: 'Test',
      permissions: ['read', 'write'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    trashedPaths = []
    service = new LocalFileService([filesystemRoot], backupRoot, async (path) => {
      trashedPaths.push(path)
      await rename(path, `${path}.trashed`)
    })
  })

  afterEach(async () => {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(backupRoot, { recursive: true, force: true })])
  })

  it('lists and reads files without exposing an absolute path', async () => {
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'docs', 'readme.md'), 'hello seed')
    const listed = await service.execute('list', filesystemRoot.id, { path: 'docs' }) as { entries: Array<{ path: string; modified_at: string }> }
    expect(listed.entries[0]?.path).toBe('docs/readme.md')
    expect(listed.entries[0]?.modified_at).toBeTruthy()
    const read = await service.execute('read', filesystemRoot.id, { path: 'docs/readme.md' }) as { content: string; sha256: string; bytes_read: number }
    expect(read.content).toBe('hello seed')
    expect(read.bytes_read).toBe(10)
    expect(read.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('reads binary files without exposing an absolute path', async () => {
    const body = Buffer.from([0, 1, 2, 3, 254, 255])
    await mkdir(join(root, 'resumes'))
    await writeFile(join(root, 'resumes', 'candidate.pdf'), body)

    const read = await service.execute('read_binary', filesystemRoot.id, { path: 'resumes/candidate.pdf' }) as {
      path: string
      content_base64: string
      size: number
      sha256: string
    }

    expect(read).toEqual({
      path: 'resumes/candidate.pdf',
      content_base64: body.toString('base64'),
      size: body.byteLength,
      sha256: createHash('sha256').update(body).digest('hex'),
    })
    expect(JSON.stringify(read)).not.toContain(root)
  })

  it('finds files with Pi-compatible glob parameters inside the root', async () => {
    await mkdir(join(root, 'notes'))
    await mkdir(join(root, 'notes', 'nested'))
    await writeFile(join(root, 'notes', 'one.md'), 'one')
    await writeFile(join(root, 'notes', 'nested', 'two.md'), 'two')
    await writeFile(join(root, 'notes', 'nested', 'two.txt'), 'two')

    const result = await service.execute('find', filesystemRoot.id, {
      path: 'notes', pattern: '**/*.md', limit: 10,
    }) as { paths: string[]; truncated: boolean }

    expect(result.paths).toEqual(['notes/one.md', 'notes/nested/two.md'])
    expect(result.truncated).toBe(false)
  })

  it('greps text with regex, glob, case and context parameters', async () => {
    await mkdir(join(root, 'notes'))
    await writeFile(join(root, 'notes', 'one.md'), 'before\nTODO: First\nafter')
    await writeFile(join(root, 'notes', 'two.md'), 'todo: second')
    await writeFile(join(root, 'notes', 'ignored.txt'), 'TODO: ignored')

    const result = await service.execute('grep', filesystemRoot.id, {
      path: 'notes', pattern: '^todo:', glob: '*.md', ignoreCase: true, context: 1, limit: 10,
    }) as { matches: Array<{ path: string; line: number; before: string[]; after: string[] }> }

    expect(result.matches).toEqual([
      { path: 'notes/one.md', line: 2, text: 'TODO: First', before: ['before'], after: ['after'] },
      { path: 'notes/two.md', line: 1, text: 'todo: second', before: [], after: [] },
    ])
  })

  it('respects nested gitignore rules for find and grep', async () => {
    await mkdir(join(root, 'notes'))
    await writeFile(join(root, '.gitignore'), 'ignored.md\n')
    await writeFile(join(root, 'ignored.md'), 'TODO: root ignored')
    await mkdir(join(root, 'notes', 'generated'))
    await writeFile(join(root, 'notes', '.gitignore'), '*.tmp\ngenerated/\n')
    await writeFile(join(root, 'notes', 'ignored.tmp'), 'TODO: nested ignored')
    await writeFile(join(root, 'notes', 'generated', 'ignored.md'), 'TODO: directory ignored')
    await writeFile(join(root, 'notes', 'kept.md'), 'TODO: kept')

    const found = await service.execute('find', filesystemRoot.id, { pattern: '**/*', limit: 20 }) as { paths: string[] }
    expect(found.paths).not.toContain('ignored.md')
    expect(found.paths).not.toContain('notes/ignored.tmp')
    expect(found.paths).not.toContain('notes/generated/ignored.md')
    expect(found.paths).toContain('notes/kept.md')

    const searched = await service.execute('grep', filesystemRoot.id, { pattern: 'TODO:', limit: 20 }) as { matches: Array<{ path: string }> }
    expect(searched.matches.map((match) => match.path)).toEqual(['notes/kept.md'])
  })

  it('rejects traversal and sensitive files', async () => {
    await writeFile(join(root, '.env'), 'TOKEN=secret')
    await expect(service.execute('read', filesystemRoot.id, { path: '../secret.txt' })).rejects.toThrow()
    await expect(service.execute('read', filesystemRoot.id, { path: '.env' })).rejects.toThrow(/凭据或密钥/)
  })

  it('hides system metadata while preserving project dotfiles', async () => {
    await writeFile(join(root, '.DS_Store'), 'finder metadata')
    await writeFile(join(root, '.localized'), '')
    await writeFile(join(root, 'desktop.ini'), 'windows metadata')
    await writeFile(join(root, '.gitignore'), 'dist\n')
    await mkdir(join(root, '.Temp'))
    await mkdir(join(root, '.git'))

    const listed = await service.execute('list', filesystemRoot.id, { path: '' }) as {
      entries: Array<{ name: string }>
      truncated: boolean
    }

    expect(listed.entries.map((entry) => entry.name)).toEqual(['.gitignore'])
    expect(listed.truncated).toBe(false)
  })

  it('rejects direct operations on protected system and internal paths', async () => {
    await writeFile(join(root, '.DS_Store'), 'finder metadata')
    await mkdir(join(root, '.git'))
    await writeFile(join(root, 'note.txt'), 'keep')

    await expect(service.execute('stat', filesystemRoot.id, { path: '.DS_Store' })).rejects.toThrow(/系统元数据/)
    await expect(service.execute('read', filesystemRoot.id, { path: '.DS_Store' })).rejects.toThrow(/系统元数据/)
    await expect(service.execute('write', filesystemRoot.id, { path: '.localized', content: '' })).rejects.toThrow(/系统元数据/)
    await expect(service.execute('mkdir', filesystemRoot.id, { path: '.Temp/session' })).rejects.toThrow(/系统元数据/)
    await expect(service.execute('move', filesystemRoot.id, { path: 'note.txt', destination_path: '.git/note.txt' })).rejects.toThrow(/系统元数据/)
    await expect(service.execute('delete', filesystemRoot.id, { path: '.git' })).rejects.toThrow(/系统元数据/)
    expect(trashedPaths).toEqual([])
  })

  it('rejects symlink reads and writes', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'motusai-seed-outside-'))
    try {
      await writeFile(join(outside, 'secret.txt'), 'secret')
      await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'))
      await expect(service.execute('read', filesystemRoot.id, { path: 'link.txt' })).rejects.toThrow(/符号链接/)
      await expect(service.execute('write', filesystemRoot.id, { path: 'link.txt', content: 'changed', expected_hash: 'x' })).rejects.toThrow(/符号链接/)
      expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('secret')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('uses optimistic hashes and creates a recoverable backup', async () => {
    await writeFile(join(root, 'note.txt'), 'old')
    const read = await service.execute('read', filesystemRoot.id, { path: 'note.txt' }) as { sha256: string }
    await expect(service.execute('write', filesystemRoot.id, { path: 'note.txt', content: 'new', expected_hash: 'stale' })).rejects.toThrow(/发生变化/)
    const result = await service.execute('write', filesystemRoot.id, { path: 'note.txt', content: 'new', expected_hash: read.sha256 }) as { backup_id: string }
    expect(result.backup_id).toBeTruthy()
    expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('new')
  })

  it('edits an exact unique text selection', async () => {
    await writeFile(join(root, 'note.txt'), 'hello local world')
    const read = await service.execute('read', filesystemRoot.id, { path: 'note.txt' }) as { sha256: string }
    await service.execute('edit', filesystemRoot.id, {
      path: 'note.txt', expected_hash: read.sha256,
      replacements: [{ old_text: 'local', new_text: 'MotusAI' }],
    })
    expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('hello MotusAI world')
  })

  it('honors read-only roots', async () => {
    service.replaceRoots([{ ...filesystemRoot, permissions: ['read'] }])
    await expect(service.execute('write', filesystemRoot.id, { path: 'new.txt', content: 'nope' })).rejects.toThrow(/写入权限/)
  })

  it('creates nested project directories without following links', async () => {
    const result = await service.execute('mkdir', filesystemRoot.id, { path: 'generated/reports' }) as { created: boolean }
    expect(result.created).toBe(true)
    await writeFile(join(root, 'generated', 'reports', 'ready.txt'), 'ready')
    expect(await readFile(join(root, 'generated', 'reports', 'ready.txt'), 'utf8')).toBe('ready')
  })

  it('moves deleted files to the system trash after creating an internal backup', async () => {
    await writeFile(join(root, 'note.txt'), 'keep me recoverable')
    const canonicalRoot = await realpath(root)

    const result = await service.execute('delete', filesystemRoot.id, { path: 'note.txt' }) as {
      backup_id: string
      recoverable: boolean
      trashed: boolean
    }

    expect(trashedPaths).toEqual([join(canonicalRoot, 'note.txt')])
    expect(await readFile(join(root, 'note.txt.trashed'), 'utf8')).toBe('keep me recoverable')
    expect(await readFile(join(backupRoot, filesystemRoot.id, result.backup_id), 'utf8')).toBe('keep me recoverable')
    expect(result).toMatchObject({ recoverable: true, trashed: true })
  })

  it('moves directories to the system trash without requiring a file backup', async () => {
    await mkdir(join(root, 'generated'))
    await writeFile(join(root, 'generated', 'report.txt'), 'report')
    const canonicalRoot = await realpath(root)

    const result = await service.execute('delete', filesystemRoot.id, { path: 'generated' }) as {
      backup_id?: string
      recoverable: boolean
      trashed: boolean
    }

    expect(trashedPaths).toEqual([join(canonicalRoot, 'generated')])
    expect(await readdir(join(root, 'generated.trashed'))).toEqual(['report.txt'])
    expect(result).toMatchObject({ recoverable: true, trashed: true })
    expect(result.backup_id).toBeUndefined()
  })

})
