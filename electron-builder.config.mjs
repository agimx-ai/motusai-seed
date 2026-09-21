import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnv } from 'vite'

const env = loadEnv('production', import.meta.dirname, 'MOTUSAI_')
const productName = 'MotusAI Seed'
const appId = 'com.motusai.seed'
const updateChannel = process.env.MOTUSAI_UPDATE_CHANNEL?.trim() || env.MOTUSAI_UPDATE_CHANNEL?.trim() || 'stable'
const releasePlatform = process.env.MOTUSAI_RELEASE_PLATFORM?.trim() || env.MOTUSAI_RELEASE_PLATFORM?.trim()
const seedCloudUrl = process.env.MOTUSAI_SEED_CLOUD_URL?.trim() || env.MOTUSAI_SEED_CLOUD_URL?.trim()
const distributionId = 'motusai'
const publishChannel = updateChannel === 'stable' ? 'latest' : 'beta'
const appResources = 'resources/app'
const appIconPng = `${appResources}/app-icon.png`
const appIconIcns = `${appResources}/app-icon.icns`
const appIconComposer = `${appResources}/app-icon.icon`

if (updateChannel !== 'stable' && updateChannel !== 'beta') throw new Error('MOTUSAI_UPDATE_CHANNEL must be stable or beta.')
if (!/^(mac-(arm64|x64|universal)|win-(x64|arm64)|linux-(x64|arm64))$/.test(releasePlatform || '')) {
  throw new Error('MOTUSAI_RELEASE_PLATFORM must identify the packaged update target.')
}
let updateUrl
try {
  const cloud = new URL(seedCloudUrl || '')
  if (!['https:', 'http:'].includes(cloud.protocol) || cloud.username || cloud.password || cloud.search || cloud.hash) {
    throw new Error('invalid Seed Cloud URL')
  }
  cloud.pathname = `${cloud.pathname.replace(/\/+$/, '')}/updates/${encodeURIComponent(distributionId)}/${updateChannel}/${releasePlatform}`
  updateUrl = cloud.toString().replace(/\/$/, '')
} catch {
  throw new Error('MOTUSAI_SEED_CLOUD_URL must be a valid HTTP or HTTPS URL before packaging.')
}
for (const asset of [appIconPng, `${appResources}/tray-light.png`, `${appResources}/tray-dark.png`]) {
  if (!existsSync(resolve(import.meta.dirname, asset))) throw new Error(`Missing generated icon asset: ${asset}. Run npm run icons:generate.`)
}
if (process.platform === 'darwin') {
  for (const asset of [appIconIcns, appIconComposer]) {
    if (!existsSync(resolve(import.meta.dirname, asset))) {
      throw new Error(`Missing generated icon asset: ${asset}. Run npm run icons:generate on macOS.`)
    }
  }
}

export default {
  appId,
  productName,
  directories: { output: 'release' },
  electronDist: 'node_modules/electron/dist',
  asar: true,
  files: ['dist/renderer/**/*', 'dist/electron/**/*', 'package.json'],
  protocols: [
    { name: `${productName} sign-in`, schemes: [appId] },
    { name: `${productName} deep links`, schemes: ['motusai-seed'] },
  ],
  extraResources: [
    { from: appResources, to: 'app' },
  ],
  publish: [{ provider: 'generic', url: updateUrl, channel: publishChannel }],
  mac: {
    icon: appIconComposer,
    category: 'public.app-category.productivity',
    target: ['dmg', 'zip'],
    artifactName: 'MotusAI-Seed-${version}-mac-${arch}.${ext}',
    extendInfo: {
      NSMicrophoneUsageDescription: `${productName} uses the microphone only when you start a recording from your connected MotusAI workspace.`,
    },
  },
  dmg: { icon: appIconIcns },
  win: { icon: appIconPng, target: ['nsis'], artifactName: 'MotusAI-Seed-${version}-win-${arch}.${ext}' },
  nsis: {
    oneClick: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: productName,
    uninstallDisplayName: '${productName} ${version}',
  },
  linux: {
    icon: appIconPng,
    category: 'Utility',
    target: ['AppImage', 'deb'],
    artifactName: 'MotusAI-Seed-${version}-linux-${arch}.${ext}',
  },
}
