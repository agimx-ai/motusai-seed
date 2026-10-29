import { constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'
import { generateAssetCatalogForIcon } from 'app-builder-lib/out/util/macosIconComposer.js'

const appName = 'MotusAI Seed Dev'
const bundleId = 'com.motusai.seed.dev'
const callbackScheme = 'com.motusai.seed'
const deepLinkScheme = 'motusai-seed'

function plistValue(plist, key) {
  return execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim()
}

function registerDevelopmentApp(appPath) {
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' })
  } catch {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'pipe' })
  }
  execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', appPath], { stdio: 'pipe' })
  return join(appPath, 'Contents', 'MacOS', 'Electron')
}

function nativeIconFingerprint(iconPath) {
  const hash = createHash('sha256').update('seed-native-icon-v1')
  // Use the same selected compiler as electron-builder, including cache invalidation
  // when Xcode changes without any edits to the icon's source layers.
  hash.update(execFileSync('actool', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] }))
  function addDirectory(relative = '') {
    const entries = readdirSync(join(iconPath, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const path = join(relative, entry.name)
      if (entry.isDirectory()) addDirectory(path)
      else if (entry.isFile()) {
        const bytes = readFileSync(join(iconPath, path))
        hash.update(JSON.stringify([path, bytes.length])).update(bytes)
      }
    }
  }
  addDirectory()
  return hash.digest('hex')
}

async function registerWithNativeIcon(projectRoot, appPath) {
  const resources = join(appPath, 'Contents', 'Resources')
  const plist = join(appPath, 'Contents', 'Info.plist')
  const cachePath = join(dirname(appPath), 'native-icon.sha256')
  const iconPath = join(projectRoot, 'resources', 'app', 'app-icon.icon')
  const fingerprint = nativeIconFingerprint(iconPath)
  let iconIsCurrent = false
  if (existsSync(cachePath) && readFileSync(cachePath, 'utf8').trim() === fingerprint
    && existsSync(join(resources, 'Assets.car')) && existsSync(join(resources, 'motusai-seed.icns'))) {
    try {
      iconIsCurrent = plistValue(plist, 'CFBundleIconName') === 'Icon'
        && plistValue(plist, 'CFBundleIconFile') === 'motusai-seed.icns'
    } catch {
      // Older development bundles have no asset-catalog icon metadata.
    }
  }
  if (!iconIsCurrent) {
    // Reuse the production compiler and its static fallback, not the separate PNG.
    const { assetCatalog, icnsFile } = await generateAssetCatalogForIcon(iconPath)
    writeFileSync(join(resources, 'Assets.car'), assetCatalog)
    writeFileSync(join(resources, 'motusai-seed.icns'), icnsFile)
    execFileSync('plutil', ['-replace', 'CFBundleIconName', '-string', 'Icon', plist])
    execFileSync('plutil', ['-replace', 'CFBundleIconFile', '-string', 'motusai-seed.icns', plist])
  }
  const binary = registerDevelopmentApp(appPath)
  if (!iconIsCurrent) writeFileSync(cachePath, `${fingerprint}\n`)
  return binary
}

export async function prepareElectronDev(projectRoot, electronBinary, electronVersion) {
  if (process.platform !== 'darwin') return electronBinary

  const sourceApp = dirname(dirname(dirname(electronBinary)))
  const outputDirectory = join(projectRoot, '.build', 'electron-dev', electronVersion)
  const appPath = join(outputDirectory, `${appName}.app`)
  const plist = join(appPath, 'Contents', 'Info.plist')
  if (existsSync(appPath)) {
    if (plistValue(plist, 'CFBundleIdentifier') !== bundleId || plistValue(plist, 'CFBundleDisplayName') !== appName) {
      throw new Error(`The development Electron app has unexpected metadata: ${appPath}`)
    }
    const frameworkResources = join(appPath, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Resources')
    if (isAbsolute(readlinkSync(frameworkResources))) {
      throw new Error(`The development Electron app has invalid framework links: ${appPath}`)
    }
    return registerWithNativeIcon(projectRoot, appPath)
  }

  mkdirSync(outputDirectory, { recursive: true })
  const temporaryDirectory = mkdtempSync(join(outputDirectory, '.prepare-'))
  const temporaryApp = join(temporaryDirectory, `${appName}.app`)
  try {
    cpSync(sourceApp, temporaryApp, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE })
    const temporaryPlist = join(temporaryApp, 'Contents', 'Info.plist')
    const setPlist = (key, value) => {
      execFileSync('plutil', ['-replace', key, '-string', value, temporaryPlist])
    }
    setPlist('CFBundleDisplayName', appName)
    setPlist('CFBundleName', appName)
    setPlist('CFBundleIdentifier', bundleId)
    setPlist('CFBundleIconFile', 'motusai-seed.icns')
    execFileSync('plutil', ['-replace', 'CFBundleURLTypes', '-json', JSON.stringify([
      { CFBundleURLName: `${appName} sign-in`, CFBundleURLSchemes: [callbackScheme] },
      { CFBundleURLName: `${appName} deep links`, CFBundleURLSchemes: [deepLinkScheme] },
    ]), temporaryPlist])
    renameSync(temporaryApp, appPath)
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
  return registerWithNativeIcon(projectRoot, appPath)
}
