import { constants, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readlinkSync, renameSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, isAbsolute, join } from 'node:path'

const appName = 'MotusAI Seed Dev'
const bundleId = 'com.motusai.seed.dev'
const callbackScheme = 'com.motusai.seed'
const deepLinkScheme = 'motusai-seed'

function plistValue(plist, key) {
  return execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim()
}

export function prepareElectronDev(projectRoot, electronBinary, electronVersion) {
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
    return join(appPath, 'Contents', 'MacOS', 'Electron')
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
    copyFileSync(join(projectRoot, 'resources', 'app', 'app-icon.icns'), join(temporaryApp, 'Contents', 'Resources', 'motusai-seed.icns'))
    renameSync(temporaryApp, appPath)
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
  return join(appPath, 'Contents', 'MacOS', 'Electron')
}
