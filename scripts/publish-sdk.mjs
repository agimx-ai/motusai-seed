import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { checkReleaseVersions } from './update-client-version.mjs'
import { isPrereleaseVersion } from './semver.mjs'

const run = promisify(execFile)
const packageName = '@motus-ai/seed-sdk'
const registry = 'https://registry.npmjs.org/'

export async function publishSdk(tarball, version, {
  fetchMetadata = fetch,
  publish = async (args) => {
    const { stdout, stderr } = await run('npm', args)
    process.stdout.write(stdout)
    process.stderr.write(stderr)
  },
} = {}) {
  if (version.includes('+')) throw new Error('Bound client/SDK releases must not use build metadata; npm removes it from published versions.')
  const tag = isPrereleaseVersion(version) ? 'beta' : 'latest'
  const path = resolve(tarball)
  const { stdout } = await run('tar', ['-xOf', path, 'package/package.json'])
  const metadata = JSON.parse(stdout)
  if (metadata.name !== packageName || metadata.version !== version) {
    throw new Error(`SDK tarball must contain ${packageName}@${version}.`)
  }
  const integrity = `sha512-${createHash('sha512').update(await readFile(path)).digest('base64')}`
  const response = await fetchMetadata(`${registry}@motus-ai%2fseed-sdk/${encodeURIComponent(version)}`, {
    signal: AbortSignal.timeout(30_000),
  })
  if (response.ok) {
    const existing = await response.json()
    if (existing.name !== packageName || existing.version !== version || existing.dist?.integrity !== integrity) {
      throw new Error(`Published SDK ${version} has different content; do not replace an immutable npm version.`)
    }
    return `SDK ${version} is already published with the same integrity.`
  }
  if (response.status !== 404) throw new Error(`Cannot check npm SDK version: HTTP ${response.status}.`)

  await publish(['publish', path, '--access', 'public', '--tag', tag, '--registry', registry, '--ignore-scripts'])
  return `Published SDK ${version} to npm (${tag}).`
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/publish-sdk.mjs <release-sdk.tgz>')
    const version = await checkReleaseVersions()
    console.log(await publishSdk(process.argv[2], version))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
