import { createHash } from 'node:crypto'
import { PassThrough } from 'node:stream'
import * as archiverModule from 'archiver'
import { describe, expect, it } from 'vitest'
import { verifySeedPackage } from './seed-package'

const manifest = `schema_version: 1
id: com.example.seed.clock
name:
  en_US: Local Clock
  zh_Hans: 本地时钟
description:
  en_US: Read the current device time.
  zh_Hans: 读取当前设备时间。
labels:
  - productivity
  - utilities
version: 1.0.0
min_seed_version: 0.1.67
api_version: "1"
publisher: com.example
icon: ./assets/icon.svg
icon_dark: ./assets/icon-dark.svg
runtime:
  kind: sandboxed-web
caps:
  - ./caps/clock.yaml
permissions:
  - models.transcription
`

const capability = `id: clock
version: 1
errors:
  clock_unavailable:
    en_US: Clock is unavailable.
    zh_Hans: 时钟不可用。
methods:
  - name: now
    risk: read
`

function digest(body: Buffer) {
  return createHash('sha256').update(body).digest('hex')
}

async function zip(entries: { path: string; body: Buffer }[]) {
  const output = new PassThrough()
  const chunks: Buffer[] = []
  output.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  const completed = new Promise<Buffer>((resolve, reject) => {
    output.on('end', () => resolve(Buffer.concat(chunks)))
    output.on('error', reject)
  })
  const ZipArchive = (archiverModule as unknown as { ZipArchive: new (options: unknown) => import('stream').Transform & {
    append(body: Buffer, options: { name: string; date: Date }): void
    finalize(): Promise<void>
  } }).ZipArchive
  const archive = new ZipArchive({ zlib: { level: 9 } })
  archive.on('error', (error) => output.destroy(error))
  archive.pipe(output)
  for (const entry of entries) archive.append(entry.body, { name: entry.path, date: new Date('1980-01-01T00:00:00Z') })
  await archive.finalize()
  return await completed
}

async function integrityPackage(options: { tamper?: boolean; flowStyle?: boolean } = {}) {
  const content = [
    { path: 'assets/icon-dark.svg', body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') },
    { path: 'assets/icon.svg', body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') },
    { path: 'dist/index.mjs', body: Buffer.from('export default {}\n') },
    { path: 'manifest.yaml', body: Buffer.from(options.flowStyle ? manifest.replace('labels:\n  - productivity\n  - utilities', 'labels: [productivity, utilities]') : manifest) },
    { path: 'caps/clock.yaml', body: Buffer.from(capability) },
  ].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)))
  const digests = Buffer.from(content.map((entry) => `${digest(entry.body)}  ${entry.path}\n`).join(''))
  if (options.tamper) content.find((entry) => entry.path === 'dist/index.mjs')!.body = Buffer.from('export default { tampered: true }\n')
  const packageBytes = await zip([...content,
    { path: 'META-INF/files.sha256', body: digests },
  ])
  return {
    packageBytes,
    packageSha256: digest(packageBytes),
  }
}

describe('Seed package verification', () => {
  it('verifies the package digest and every archived file', async () => {
    const fixture = await integrityPackage()
    const verified = await verifySeedPackage(fixture.packageBytes, {
      expectedPackageSha256: fixture.packageSha256,
      expectedPluginId: 'com.example.seed.clock',
      expectedVersion: '1.0.0',
    })
    expect(verified.manifest.id).toBe('com.example.seed.clock')
    expect(verified.manifest.capabilities).toHaveLength(1)
    expect(verified.manifest.capabilities[0]?.errors.clock_unavailable).toEqual({ en_US: 'Clock is unavailable.', zh_Hans: '时钟不可用。' })
    expect(verified.manifest.capabilities[0]).not.toHaveProperty('configuration')
    expect(verified.manifest).not.toHaveProperty('configurations')
    expect(verified.manifest).not.toHaveProperty('managementViews')
    expect(verified.files.has('dist/index.mjs')).toBe(true)
  })

  it('rejects package content changed after the digest list is generated', async () => {
    const fixture = await integrityPackage({ tamper: true })
    await expect(verifySeedPackage(fixture.packageBytes, {
      expectedPackageSha256: fixture.packageSha256,
    })).rejects.toThrow(/摘要不匹配/)
  })

  it('rejects YAML flow-style collections', async () => {
    const fixture = await integrityPackage({ flowStyle: true })
    await expect(verifySeedPackage(fixture.packageBytes, {
      expectedPackageSha256: fixture.packageSha256,
    })).rejects.toThrow(/不允许 YAML flow style/)
  })

  it('rejects a package digest that differs from the catalog', async () => {
    const fixture = await integrityPackage()
    await expect(verifySeedPackage(fixture.packageBytes, {
      expectedPackageSha256: '0'.repeat(64),
    })).rejects.toThrow(/服务端目录不一致/)
  })

  it('rejects Windows path aliases before writing any files', async () => {
    const content = [
      { path: 'CON/readme.txt', body: Buffer.from('unsafe') },
      { path: 'manifest.yaml', body: Buffer.from(manifest) },
    ]
    const digests = Buffer.from(content.map((entry) => `${digest(entry.body)}  ${entry.path}\n`).join(''))
    const packageBytes = await zip([...content, { path: 'META-INF/files.sha256', body: digests }])
    await expect(verifySeedPackage(packageBytes, {
      expectedPackageSha256: digest(packageBytes),
    })).rejects.toThrow(/不安全条目/)
  })
})
