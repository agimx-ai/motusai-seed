import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { systemVisibleDirectoryNames } from './system-directory-visibility'

let root: string
const run = promisify(execFile)

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'seed-system-visibility-')) })
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

it.skipIf(process.platform !== 'darwin')('honors the Finder setting for dotfiles and flagged files and folders', async () => {
  await mkdir(join(root, '.hidden-directory'))
  await mkdir(join(root, 'flagged directory'))
  await Promise.all(['.hidden-file', 'flagged\nfile', '可见文件.txt'].map((name) => writeFile(join(root, name), '')))
  await run('/usr/bin/chflags', ['hidden', join(root, 'flagged\nfile'), join(root, 'flagged directory')])
  const preference = await run('/usr/bin/defaults', ['read', 'com.apple.finder', 'AppleShowAllFiles']).catch(() => null)
  const showHidden = /^(1|true|yes)$/i.test(preference?.stdout.trim() || '')
  const visible = await systemVisibleDirectoryNames(root, await readdir(root))
  expect(visible).toEqual(showHidden ? null : new Set(['可见文件.txt']))
})

it.skipIf(process.platform !== 'win32')('honors Explorer settings for hidden files, directories and system items', async () => {
  const hiddenDirectory = join(root, 'hidden directory')
  const hiddenFile = join(root, '隐藏项目.txt')
  const systemFile = join(root, 'protected file')
  await mkdir(hiddenDirectory)
  await Promise.all([hiddenFile, systemFile, join(root, 'visible.txt')].map((path) => writeFile(path, '')))
  try {
    await run('attrib.exe', ['+h', hiddenDirectory])
    await run('attrib.exe', ['+h', hiddenFile])
    await run('attrib.exe', ['+h', '+s', systemFile])
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced'
    const settings = await run('reg.exe', ['query', key]).catch(() => null)
    const showHidden = /^\s*Hidden\s+REG_DWORD\s+0x1\s*$/im.test(settings?.stdout || '')
    const showSystem = /^\s*ShowSuperHidden\s+REG_DWORD\s+0x1\s*$/im.test(settings?.stdout || '')
    const expected = showHidden && showSystem ? null : new Set(['visible.txt', ...(showHidden ? ['hidden directory', '隐藏项目.txt'] : [])])
    await expect(systemVisibleDirectoryNames(root, await readdir(root))).resolves.toEqual(expected)
  } finally {
    await Promise.all([
      run('attrib.exe', ['-h', hiddenDirectory]), run('attrib.exe', ['-h', hiddenFile]), run('attrib.exe', ['-h', '-s', systemFile]),
    ])
  }
})

it('uses dotfiles and the local .hidden list when the Linux desktop setting is unavailable', async () => {
  vi.stubEnv('XDG_CURRENT_DESKTOP', 'unsupported-desktop')
  await writeFile(join(root, '.hidden'), 'notes with spaces\r\nprivate-dir\n')
  const names = ['.hidden', '.dotfile', '.dotdir', 'notes with spaces', 'private-dir', 'visible']
  await expect(systemVisibleDirectoryNames(root, names, 'linux')).resolves.toEqual(new Set(['visible']))
})

it('uses the persisted Dolphin preference and rereads it on the next browse', async () => {
  vi.stubEnv('XDG_CURRENT_DESKTOP', 'KDE')
  vi.stubEnv('XDG_CONFIG_HOME', root)
  vi.stubEnv('XDG_DATA_HOME', root)
  const profile = join(root, 'dolphin', 'view_properties', 'global')
  await mkdir(profile, { recursive: true })
  const view = join(profile, '.directory')
  const names = ['.hidden-file', 'visible']
  await writeFile(view, '[Settings]\nHiddenFilesShown=true\n[Dolphin]\nVersion=4\n')
  await expect(systemVisibleDirectoryNames(root, names, 'linux')).resolves.toBeNull()
  await writeFile(view, '[Settings]\nHiddenFilesShown=false\n')
  await expect(systemVisibleDirectoryNames(root, names, 'linux')).resolves.toEqual(new Set(['visible']))
})
