import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createPublicKey } from 'node:crypto'
import { loadEnv } from 'vite'

const mode = process.argv[2] || 'development'
const projectRoot = resolve(import.meta.dirname, '..')
const env = loadEnv(mode, projectRoot, 'MOTUSAI_')

function configValue(name) {
  return process.env[name]?.trim() || env[name]?.trim()
}

const appName = 'MotusAI Seed'
const appId = 'com.motusai.seed'

function isPrivateHost(hostname) {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
}

function serviceUrl(value, name) {
  try {
    const url = new URL(value || '')
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('unsupported protocol')
    if (url.username || url.password || url.search || url.hash) throw new Error('unexpected URL components')
    if (url.protocol === 'http:' && mode === 'production') {
      const allowInsecure = env.MOTUSAI_ALLOW_INSECURE_HTTP === 'true'
      if (!allowInsecure || !isPrivateHost(url.hostname)) {
        throw new Error('production HTTP is restricted')
      }
    }
    url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString().replace(/\/$/, '')
  } catch {
    throw new Error(`${name} must be HTTPS in production; insecure HTTP requires MOTUSAI_ALLOW_INSECURE_HTTP=true and a loopback or private IPv4 host.`)
  }
}

const distributionId = 'motusai'
const distributionKeyId = configValue('MOTUSAI_DISTRIBUTION_KEY_ID')
if (!distributionKeyId || !/^[a-zA-Z0-9._:-]+$/.test(distributionKeyId)) {
  throw new Error('MOTUSAI_DISTRIBUTION_KEY_ID is required and contains unsupported characters.')
}
const distributionPublicKeyValue = configValue('MOTUSAI_DISTRIBUTION_PUBLIC_KEY')
if (!distributionPublicKeyValue) throw new Error('MOTUSAI_DISTRIBUTION_PUBLIC_KEY is required.')
let distributionPublicKey
try {
  distributionPublicKey = createPublicKey({
    key: Buffer.from(distributionPublicKeyValue, 'base64'),
    format: 'der',
    type: 'spki',
  })
    .export({ format: 'der', type: 'spki' })
    .toString('base64')
} catch (error) {
  throw new Error(`Invalid distribution public key: ${error instanceof Error ? error.message : String(error)}`)
}

function themeColor(value, name) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${name} must be a six-digit hex color.`)
  }
  return value.toUpperCase()
}

let appTheme
try {
  appTheme = JSON.parse(await readFile(resolve(projectRoot, 'resources', 'app', 'theme.json'), 'utf8'))
} catch (error) {
  throw new Error(`Unable to read resources/app/theme.json: ${error instanceof Error ? error.message : String(error)}`)
}
const mascotColorLight = themeColor(appTheme?.mascot?.light, 'app mascot.light')
const mascotColorDark = themeColor(appTheme?.mascot?.dark, 'app mascot.dark')

const output = `// Generated from .env for ${mode}. Do not edit or commit.\n` +
  `export const buildConfig = Object.freeze(${JSON.stringify({
    appName,
    appId,
    mascotColorLight,
    mascotColorDark,
    seedCloudUrl: serviceUrl(configValue('MOTUSAI_SEED_CLOUD_URL'), 'MOTUSAI_SEED_CLOUD_URL'),
    distributionId,
    distributionKeyId,
    distributionPublicKey,
    allowInsecureHttp: configValue('MOTUSAI_ALLOW_INSECURE_HTTP') === 'true',
  }, null, 2)} as const)\n`

await writeFile(resolve(projectRoot, 'src/shared/build-config.generated.ts'), output, 'utf8')
