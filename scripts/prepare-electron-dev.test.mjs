import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const { command, compile } = vi.hoisted(() => ({ command: vi.fn(), compile: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync: command }))
vi.mock('app-builder-lib/out/util/macosIconComposer.js', () => ({ generateAssetCatalogForIcon: compile }))
import { prepareElectronDev } from './prepare-electron-dev.mjs'

const originalPlatform = process.platform
let root
let sourceBinary
let appPath
let iconPath
let compilerVersion

function writePlist(path, values) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(values))
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  root = mkdtempSync(join(tmpdir(), 'seed-dev-icon-test-'))
  sourceBinary = join(root, 'electron/Electron.app/Contents/MacOS/Electron')
  mkdirSync(dirname(sourceBinary), { recursive: true })
  mkdirSync(join(dirname(dirname(sourceBinary)), 'Resources'), { recursive: true })
  writeFileSync(sourceBinary, '')
  writePlist(join(dirname(dirname(sourceBinary)), 'Info.plist'), {})
  appPath = join(root, '.build/electron-dev/test/MotusAI Seed Dev.app')
  iconPath = join(root, 'resources/app/app-icon.icon')
  mkdirSync(join(iconPath, 'Assets'), { recursive: true })
  writeFileSync(join(iconPath, 'icon.json'), '{"groups":[]}\n')
  writeFileSync(join(iconPath, 'Assets/dark.png'), 'original-dark-layer')
  compilerVersion = 'Xcode 26'
  command.mockReset().mockImplementation((tool, args) => {
    if (tool === 'actool') return Buffer.from(compilerVersion)
    if (tool !== 'plutil') return Buffer.from('')
    const path = args.at(-1)
    const values = JSON.parse(readFileSync(path, 'utf8'))
    if (args[0] === '-extract') {
      if (!(args[1] in values)) throw new Error('Missing plist key')
      return String(values[args[1]])
    }
    if (args[0] === '-replace') {
      values[args[1]] = args[2] === '-json' ? JSON.parse(args[3]) : args[3]
      writePlist(path, values)
    }
    return Buffer.from('')
  })
  compile.mockReset().mockResolvedValue({ assetCatalog: Buffer.from('native-catalog'), icnsFile: Buffer.from('native-fallback') })
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform })
  rmSync(root, { recursive: true, force: true })
})

function existingDevelopmentApp() {
  writePlist(join(appPath, 'Contents/Info.plist'), {
    CFBundleIdentifier: 'com.motusai.seed.dev',
    CFBundleDisplayName: 'MotusAI Seed Dev',
    CFBundleIconFile: 'motusai-seed.icns',
  })
  const framework = join(appPath, 'Contents/Frameworks/Electron Framework.framework')
  mkdirSync(join(framework, 'Versions/A/Resources'), { recursive: true })
  symlinkSync('Versions/A/Resources', join(framework, 'Resources'))
  mkdirSync(join(appPath, 'Contents/Resources'), { recursive: true })
  writeFileSync(join(appPath, 'Contents/Resources/motusai-seed.icns'), 'old-icon')
}

describe('native development application icon', () => {
  it('gives a new development app the production compiler catalog and fallback', async () => {
    const binary = await prepareElectronDev(root, sourceBinary, 'test')
    expect(binary).toBe(join(appPath, 'Contents/MacOS/Electron'))
    expect(compile).toHaveBeenCalledWith(iconPath)
    expect(readFileSync(join(appPath, 'Contents/Resources/Assets.car'), 'utf8')).toBe('native-catalog')
    expect(readFileSync(join(appPath, 'Contents/Resources/motusai-seed.icns'), 'utf8')).toBe('native-fallback')
    expect(JSON.parse(readFileSync(join(appPath, 'Contents/Info.plist'), 'utf8'))).toMatchObject({
      CFBundleIconName: 'Icon', CFBundleIconFile: 'motusai-seed.icns', CFBundleIdentifier: 'com.motusai.seed.dev',
    })
  })

  it('upgrades an existing legacy bundle, then reuses the unchanged native icon', async () => {
    existingDevelopmentApp()
    await prepareElectronDev(root, sourceBinary, 'test')
    await prepareElectronDev(root, sourceBinary, 'test')
    expect(compile).toHaveBeenCalledTimes(1)
    expect(readFileSync(join(appPath, 'Contents/Resources/motusai-seed.icns'), 'utf8')).toBe('native-fallback')
  })

  it('refreshes cached bundles after a dark layer or compiler changes', async () => {
    existingDevelopmentApp()
    await prepareElectronDev(root, sourceBinary, 'test')
    writeFileSync(join(iconPath, 'Assets/dark.png'), 'updated-dark-layer')
    await prepareElectronDev(root, sourceBinary, 'test')
    compilerVersion = 'Xcode 27'
    await prepareElectronDev(root, sourceBinary, 'test')
    expect(compile).toHaveBeenCalledTimes(3)
  })

  it('repairs a missing catalog even when the source fingerprint has not changed', async () => {
    existingDevelopmentApp()
    await prepareElectronDev(root, sourceBinary, 'test')
    rmSync(join(appPath, 'Contents/Resources/Assets.car'))
    await prepareElectronDev(root, sourceBinary, 'test')
    expect(compile).toHaveBeenCalledTimes(2)
    expect(existsSync(join(appPath, 'Contents/Resources/Assets.car'))).toBe(true)
  })

  it('keeps the previous icon intact when native compilation fails', async () => {
    existingDevelopmentApp()
    compile.mockRejectedValue(new Error('Native icon compilation failed'))
    await expect(prepareElectronDev(root, sourceBinary, 'test')).rejects.toThrow('compilation failed')
    expect(readFileSync(join(appPath, 'Contents/Resources/motusai-seed.icns'), 'utf8')).toBe('old-icon')
    expect(existsSync(join(dirname(appPath), 'native-icon.sha256'))).toBe(false)
  })

  it('leaves non-macOS development runtimes unchanged', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    await expect(prepareElectronDev(root, sourceBinary, 'test')).resolves.toBe(sourceBinary)
    expect(compile).not.toHaveBeenCalled()
    expect(command).not.toHaveBeenCalled()
  })
})
