import { createWriteStream } from 'node:fs'
import { access, readFile, rm } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { ZipArchive } from 'archiver'
import { loadEnv } from 'vite'
import { parse } from 'yaml'

const projectRoot = resolve(import.meta.dirname, '..')
const releaseDirectory = resolve(projectRoot, 'release')
const env = loadEnv('production', projectRoot, 'MOTUSAI_')
const channel = process.env.MOTUSAI_UPDATE_CHANNEL?.trim() || env.MOTUSAI_UPDATE_CHANNEL?.trim() || 'stable'
const platform = process.env.MOTUSAI_RELEASE_PLATFORM?.trim() || env.MOTUSAI_RELEASE_PLATFORM?.trim()

if (!/^(mac-(arm64|x64|universal)|win-(x64|arm64)|linux-(x64|arm64))$/.test(platform || '')) {
  throw new Error('MOTUSAI_RELEASE_PLATFORM must identify the packaged update target.')
}

const prefix = channel === 'stable' ? 'latest' : 'beta'
const metadataName = platform.startsWith('mac-')
  ? `${prefix}-mac.yml`
  : platform.startsWith('linux-')
    ? `${prefix}-linux.yml`
    : `${prefix}.yml`
const metadataPath = resolve(releaseDirectory, metadataName)
const metadata = parse(await readFile(metadataPath, 'utf8'))

if (!metadata || typeof metadata.version !== 'string' || !Array.isArray(metadata.files)) {
  throw new Error(`${metadataName} is not a valid electron-builder update feed.`)
}

const packageFiles = platform.startsWith('mac-')
  ? [
      metadata.files.find((file) => typeof file?.url === 'string' && file.url.toLowerCase().endsWith('.zip')),
      metadata.files.find((file) => typeof file?.url === 'string' && file.url.toLowerCase().endsWith('.dmg')),
    ]
  : [metadata.files.find((file) => file?.url === metadata.path)]

if (packageFiles.some((file) => !file)) {
  throw new Error(`${metadataName} does not contain every required installer for ${platform}.`)
}
for (const file of packageFiles) {
  if (typeof file.url !== 'string' || basename(file.url) !== file.url || !/^[a-z0-9][a-z0-9._+-]*$/i.test(file.url)) {
    throw new Error(`${metadataName} contains an unsafe release asset name.`)
  }
}

const entryNames = [
  metadataName,
  ...packageFiles.flatMap((file) => [file.url, `${file.url}.blockmap`]),
]
for (const entryName of entryNames) await access(resolve(releaseDirectory, entryName))

const outputName = `MotusAI-Seed-${metadata.version}-${platform}-update-feed.zip`
const outputPath = resolve(releaseDirectory, outputName)
await rm(outputPath, { force: true })

await new Promise((resolveArchive, rejectArchive) => {
  const output = createWriteStream(outputPath)
  const archive = new ZipArchive({ zlib: { level: 9 } })
  output.on('close', resolveArchive)
  output.on('error', rejectArchive)
  archive.on('error', rejectArchive)
  archive.pipe(output)
  for (const entryName of entryNames) archive.file(resolve(releaseDirectory, entryName), { name: entryName })
  void archive.finalize()
})

console.log(`Created ${outputPath}`)
