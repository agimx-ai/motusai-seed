import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginDataCleaner } from './plugin-data-cleaner'

const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'seed-data-reset-test-'))
  temporary.push(root)
  const installed = vi.fn(async () => ['com.example.installed'])
  const stored = new Set(['com.example.settings'])
  const removeStored = vi.fn(async (id: string) => { stored.delete(id) })
  const cleaner = new PluginDataCleaner(root, installed, () => [...stored], removeStored)
  const data = async (id: string) => {
    const path = join(root, 'plugin-data', id)
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'private.txt'), id)
    return path
  }
  return { root, cleaner, installed, stored, removeStored, data }
}

describe('Orphaned plugin data cleanup', () => {
  it('finds private directories and configuration-only remnants, preserving installation records', async () => {
    const { cleaner, data } = await setup()
    await data('com.example.installed')
    await data('com.example.orphan')
    await data('unrecognized-directory')
    expect(await cleaner.list()).toEqual(['com.example.orphan', 'com.example.settings'])
  })
  it('deletes only confirmed orphan files and stored data, never installed or unconfirmed data', async () => {
    const { cleaner, removeStored, data } = await setup()
    const installed = await data('com.example.installed')
    const unconfirmed = await data('com.example.unconfirmed')
    const orphan = await data('com.example.orphan')
    expect(await cleaner.reset(['com.example.installed', 'com.example.orphan', 'com.example.settings', 'com.example.orphan']))
      .toEqual({ reset: ['com.example.orphan', 'com.example.settings'], skipped: ['com.example.installed'], failed: [] })
    await expect(lstat(orphan)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(installed, 'private.txt'), 'utf8')).resolves.toBe('com.example.installed')
    await expect(lstat(unconfirmed)).resolves.toBeDefined()
    expect(removeStored).toHaveBeenCalledTimes(2)
  })
  it('protects plugins reinstalled after preview', async () => {
    const { cleaner, installed, data } = await setup()
    const path = await data('com.example.orphan')
    expect(await cleaner.list()).toContain('com.example.orphan')
    installed.mockResolvedValue(['com.example.orphan'])
    expect((await cleaner.reset(['com.example.orphan'])).skipped).toEqual(['com.example.orphan'])
    await expect(lstat(path)).resolves.toBeDefined()
  })
  it('rejects traversal and symlink roots without touching external files', async () => {
    const { cleaner, root } = await setup()
    await expect(cleaner.reset(['../external'])).rejects.toThrow()
    const outside = join(root, 'external')
    await mkdir(outside)
    await writeFile(join(outside, 'keep.txt'), 'keep')
    await symlink(outside, join(root, 'plugin-data'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(cleaner.list()).rejects.toThrow('不安全')
    await expect(readFile(join(outside, 'keep.txt'), 'utf8')).resolves.toBe('keep')
  })
  it('rejects a linked plugin directory and never follows nested links', async () => {
    const { cleaner, root, stored, data } = await setup()
    const outside = join(root, 'external')
    await mkdir(outside)
    await writeFile(join(outside, 'keep.txt'), 'keep')
    const orphan = await data('com.example.orphan')
    await symlink(outside, join(orphan, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    stored.add('com.example.linked')
    await symlink(outside, join(root, 'plugin-data', 'com.example.linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const result = await cleaner.reset(['com.example.orphan', 'com.example.linked'])
    expect(result.reset).toEqual(['com.example.orphan'])
    expect(result.failed[0]?.id).toBe('com.example.linked')
    await expect(readFile(join(outside, 'keep.txt'), 'utf8')).resolves.toBe('keep')
  })
  it('reports partial failure, supports retry, and fails closed on unreadable installation state', async () => {
    const { cleaner, installed, removeStored } = await setup()
    removeStored.mockRejectedValueOnce(new Error('Storage failed'))
    expect((await cleaner.reset(['com.example.settings'])).failed).toEqual([{ id: 'com.example.settings', message: 'Storage failed' }])
    expect((await cleaner.reset(['com.example.settings'])).reset).toEqual(['com.example.settings'])
    installed.mockRejectedValue(new Error('Invalid installation state'))
    await expect(cleaner.reset(['com.example.orphan'])).rejects.toThrow('Invalid installation state')
  })
})
