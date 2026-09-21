import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { arch, release, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, type Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as archiverModule from 'archiver'
import type { AuditEntry, TerminalLogUploadProgress, TerminalLogUploadResult } from '../shared/contracts'

type UploadSession = { upload_id: string; status: 'uploading' | 'completed' | 'aborted'; part_size: number; part_count: number; missing_parts: number[] }
type Pending = { accountId: string; days: number; createdAt: string; idempotencyKey: string; fileSize: number; fileSha256: string; appVersion: string; uploadId?: string }
type PluginInventoryEntry = { package_id: string; version: string; runtime_kind?: 'sandboxed-web' | 'native-host'; enabled: boolean; status: 'ready' | 'incompatible'; capabilities: string[] }
type UploadInput = {
  cloudUrl: string; accessToken: string; accountId: string; workDirectory: string; days: number
  appName: string; appVersion: string; platform: NodeJS.Platform
  entries: Iterable<AuditEntry> | AsyncIterable<AuditEntry>; entryCount: number
  plugins?: PluginInventoryEntry[]; crashDumpDirectory?: string; startAt: string; endAt: string
}
type UploadOptions = { signal?: AbortSignal; onProgress?: (progress: TerminalLogUploadProgress) => void }
type ZipArchive = Transform & { append(body: Buffer | Readable, options: { name: string; date: Date }): void; finalize(): Promise<void> }
export const diagnosticUploadMaxBytes = 512 * 1024 * 1024

export function assertDiagnosticArchiveSize(fileSize: number) {
  if (fileSize > diagnosticUploadMaxBytes) throw new Error('诊断包超过 512 MiB，请缩小记录范围后重试。')
}

function json(value: unknown) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`) }
function entriesJson<T>(entries: Iterable<T> | AsyncIterable<T>) {
  return Readable.from((async function* () {
    yield '{\n  "entries": ['
    let count = 0
    for await (const entry of entries) {
      yield `${count ? ',' : ''}\n    ${JSON.stringify(entry)}`
      count += 1
    }
    yield `${count ? '\n  ' : ''}]\n}\n`
  })(), { objectMode: false })
}
function archiveFactory() {
  const Constructor = (archiverModule as unknown as { ZipArchive: new (options: unknown) => ZipArchive }).ZipArchive
  return new Constructor({ zlib: { level: 9 } })
}
async function fileSha256(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function recentCrashDumps(directory: string | undefined, startAt: string, endAt: string) {
  if (!directory) return []
  const found: Array<{ path: string; name: string; modified: number; size: number }> = []
  const walk = async (path: string, depth: number) => {
    if (depth > 2) return
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) await walk(child, depth + 1)
      else if (entry.isFile() && entry.name.endsWith('.dmp')) {
        const metadata = await stat(child).catch(() => null)
        if (metadata && metadata.mtime.toISOString() >= startAt && metadata.mtime.toISOString() <= endAt) {
          found.push({ path: child, name: entry.name, modified: metadata.mtimeMs, size: metadata.size })
        }
      }
    }
  }
  await walk(directory, 0)
  let size = 0
  return found.sort((a, b) => b.modified - a.modified).filter((item) => {
    // Keep crash evidence within the 512 MiB upload ceiling, leaving room for the
    // unified activity/diagnostic records and plugin inventory in the same archive.
    if (size + item.size > 448 * 1024 * 1024) return false
    size += item.size
    return true
  })
}

export async function createCloudDiagnosticArchive(input: Pick<UploadInput, 'appName' | 'appVersion' | 'platform' | 'entries' | 'entryCount' | 'plugins' | 'crashDumpDirectory' | 'startAt' | 'endAt'>, temporaryParent = tmpdir()) {
  const directory = await mkdtemp(join(temporaryParent, 'motusai-seed-diagnostics-'))
  const path = join(directory, 'diagnostics.zip')
  const generatedAt = new Date()
  const archiveDate = new Date('1980-01-01T00:00:00.000Z')
  try {
    const crashDumps = await recentCrashDumps(input.crashDumpDirectory, input.startAt, input.endAt)
    const archive = archiveFactory()
    const writing = pipeline(archive, createWriteStream(path, { mode: 0o600 }))
    archive.append(json({
      schema_version: 1, generated_at: generatedAt.toISOString(),
      app: { name: input.appName, version: input.appVersion },
      system: { platform: input.platform, architecture: arch(), os_release: release(),
        node: process.versions.node, electron: process.versions.electron, chrome: process.versions.chrome },
      activity_range: { start_at: input.startAt, end_at: input.endAt }, record_count: input.entryCount,
      crash_dump_count: crashDumps.length,
    }), { name: 'system/manifest.json', date: archiveDate })
    archive.append(entriesJson(input.entries), { name: 'activity/records.json', date: archiveDate })
    archive.append(json({ plugins: input.plugins || [] }), { name: 'plugins/inventory.json', date: archiveDate })
    for (const dump of crashDumps) archive.append(createReadStream(dump.path), { name: `crashes/${dump.name}`, date: archiveDate })
    await archive.finalize()
    await writing
    const fileSize = (await stat(path)).size
    return { path, directory, fileSize, fileSha256: await fileSha256(path), generatedAt }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function savePending(path: string, state: Pending) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}
function validSession(value: unknown): value is UploadSession {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.upload_id === 'string' && ['uploading', 'completed', 'aborted'].includes(String(row.status))
    && Number.isSafeInteger(row.part_size) && Number(row.part_size) > 0
    && Number.isSafeInteger(row.part_count) && Array.isArray(row.missing_parts)
    && row.missing_parts.every((number) => Number.isSafeInteger(number) && number > 0 && number <= Number(row.part_count))
}

export class CloudDiagnosticUploader {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async upload(input: UploadInput, options: UploadOptions = {}): Promise<TerminalLogUploadResult> {
    if (!input.accessToken) throw new Error('请先登录 MotusAI Cloud 账号后再上传诊断包。')
    const accountKey = createHash('sha256').update(input.accountId).digest('hex')
    const directory = join(input.workDirectory, accountKey)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const statePath = join(directory, 'pending.json')
    const archivePath = join(directory, 'diagnostics.zip')
    const baseUrl = `${input.cloudUrl.replace(/\/+$/, '')}/api/v1/diagnostics/uploads`
    const headers = { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' }
    const request = async (url: string, init: RequestInit): Promise<unknown> => {
      const response = await this.fetcher(url, {
        ...init, headers: { ...headers, ...init.headers },
        signal: init.method === 'DELETE' ? undefined : options.signal,
      })
      const payload = response.status === 204 ? null : await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) {
        if (response.status === 401) throw new Error('MotusAI Cloud 登录已失效，请重新登录后再上传诊断包。')
        throw new Error(payload?.message || `诊断包上传请求失败（${response.status}）。`)
      }
      return payload
    }
    let pending: Pending | null = null
    try {
      pending = JSON.parse(await readFile(statePath, 'utf8')) as Pending
    } catch { /* No pending upload. */ }
    if (pending && (pending.accountId !== input.accountId || pending.days !== input.days
      || !Number.isFinite(Date.parse(pending.createdAt)) || Date.now() - Date.parse(pending.createdAt) > 7 * 24 * 60 * 60 * 1000
      || pending.appVersion !== input.appVersion || (await stat(archivePath).catch(() => null))?.size !== pending.fileSize
      || (await fileSha256(archivePath)) !== pending.fileSha256)) {
      if (pending.uploadId) await request(`${baseUrl}/${pending.uploadId}`, { method: 'DELETE', signal: undefined }).catch(() => undefined)
      await rm(statePath, { force: true })
      await rm(archivePath, { force: true })
      pending = null
    }
    if (!pending) {
      options.onProgress?.({ phase: 'preparing', percent: 0, transferred: 0, total: 0 })
      const archive = await createCloudDiagnosticArchive(input, directory)
      try {
        assertDiagnosticArchiveSize(archive.fileSize)
        await rm(archivePath, { force: true })
        await rename(archive.path, archivePath)
        pending = { accountId: input.accountId, days: input.days, createdAt: new Date().toISOString(), idempotencyKey: randomUUID(),
          fileSize: archive.fileSize, fileSha256: archive.fileSha256, appVersion: input.appVersion }
        await savePending(statePath, pending)
      } finally {
        await rm(archive.directory, { recursive: true, force: true })
      }
    }
    let session: UploadSession | null = null
    try {
      const created = await request(baseUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotency_key: pending.idempotencyKey, file_size: pending.fileSize,
          file_sha256: pending.fileSha256, client_version: pending.appVersion }),
      })
      if (!validSession(created)) throw new Error('云端返回的诊断上传会话无效。')
      session = created
      pending.uploadId = session.upload_id
      await savePending(statePath, pending)
      if (session.status === 'aborted') {
        await rm(statePath, { force: true })
        await rm(archivePath, { force: true })
        throw new Error('诊断包上传会话已取消，请重新上传。')
      }
      if (session.status === 'uploading') {
        const fetched = await request(`${baseUrl}/${session.upload_id}`, { method: 'GET' })
        if (!validSession(fetched) || fetched.upload_id !== session.upload_id) throw new Error('云端返回的诊断上传状态无效。')
        session = fetched
      }
      if (session.status === 'uploading') {
        const missing = session.missing_parts
        const transferred = pending.fileSize - missing.reduce((total, part) =>
          total + Math.min(session!.part_size, pending!.fileSize - (part - 1) * session!.part_size), 0)
        let uploaded = transferred
        const progress = () => options.onProgress?.({ phase: 'uploading', percent: Math.floor(uploaded / pending!.fileSize * 100),
          transferred: uploaded, total: pending!.fileSize })
        progress()
        const file = await open(archivePath, 'r')
        try {
          for (const part of missing) {
            if (options.signal?.aborted) throw new DOMException('诊断包上传已取消。', 'AbortError')
            const length = Math.min(session.part_size, pending.fileSize - (part - 1) * session.part_size)
            const bytes = Buffer.alloc(length)
            const { bytesRead } = await file.read(bytes, 0, length, (part - 1) * session.part_size)
            if (bytesRead !== length) throw new Error('本地诊断包已发生变化，请重试。')
            await request(`${baseUrl}/${session.upload_id}/parts/${part}`, {
              method: 'PUT', headers: { 'Content-Type': 'application/octet-stream',
                'X-Part-SHA256': createHash('sha256').update(bytes).digest('hex') }, body: new Uint8Array(bytes),
            })
            uploaded += length
            progress()
          }
        } finally {
          await file.close()
        }
        options.onProgress?.({ phase: 'completing', percent: 100, transferred: pending.fileSize, total: pending.fileSize })
        const completed = await request(`${baseUrl}/${session.upload_id}/complete`, { method: 'POST' })
        if (!completed || typeof completed !== 'object' || (completed as { status?: string }).status !== 'completed')
          throw new Error('云端未确认诊断包合并完成。')
      }
      options.onProgress?.({ phase: 'completed', percent: 100, transferred: pending.fileSize, total: pending.fileSize })
      await rm(statePath, { force: true })
      await rm(archivePath, { force: true })
      return { uploadId: session.upload_id, status: 'completed' }
    } catch (error) {
      if (options.signal?.aborted) {
        if (session?.status === 'uploading') await request(`${baseUrl}/${session.upload_id}`, { method: 'DELETE', signal: undefined }).catch(() => undefined)
        await rm(statePath, { force: true })
        await rm(archivePath, { force: true })
      }
      throw error
    }
  }
}
