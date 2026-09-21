import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as unzipper from 'unzipper'
import { describe, expect, it, vi } from 'vitest'
import type { AuditEntry } from '../shared/contracts'
import { assertDiagnosticArchiveSize, createCloudDiagnosticArchive, CloudDiagnosticUploader, diagnosticUploadMaxBytes } from './cloud-diagnostic-uploader'

const entries: AuditEntry[] = [{
  id: 'audit-1', timestamp: '2026-08-30T00:00:00.000Z', source: 'system',
  operation: 'files.list_directory', relativePath: '.', outcome: 'allowed', summary: '请求已完成。',
}]
const input = (workDirectory: string) => ({
  cloudUrl: 'https://cloud.example.com/', accessToken: 'cloud-access-token', accountId: 'user-1',
  workDirectory, days: 1 as const, appName: 'MotusAI Seed', appVersion: '0.1.0',
  platform: 'darwin' as const, entries, entryCount: entries.length,
  startAt: '2026-08-24T00:00:00.000Z', endAt: '2026-08-30T23:59:59.999Z',
})

describe('cloud diagnostic uploader', () => {
  it('allows 512 MiB and rejects larger archives without allocating them', () => {
    expect(diagnosticUploadMaxBytes).toBe(512 * 1024 * 1024)
    expect(() => assertDiagnosticArchiveSize(diagnosticUploadMaxBytes)).not.toThrow()
    expect(() => assertDiagnosticArchiveSize(diagnosticUploadMaxBytes + 1)).toThrow('512 MiB')
  })

  it('writes records from async iterators into the archive incrementally', async () => {
    let yielded = 0
    async function* activity() {
      for (const entry of entries) { yielded += 1; yield entry }
    }
    const archive = await createCloudDiagnosticArchive({ ...input('/unused'), entries: activity() })
    try {
      expect(yielded).toBe(entries.length)
      const zip = await unzipper.Open.buffer(await readFile(archive.path))
      const audit = zip.files.find((file) => file.path === 'activity/records.json')
      expect(JSON.parse((await audit!.buffer()).toString()).entries).toEqual(entries)
    } finally { await rm(archive.directory, { recursive: true, force: true }) }
  })

  it('includes local crash dumps from the selected range', async () => {
    const crashDumpDirectory = await mkdtemp(join(tmpdir(), 'seed-crash-test-'))
    try {
      const dump = join(crashDumpDirectory, 'plugin-crash.dmp')
      await writeFile(dump, 'raw-minidump-bytes')
      await utimes(dump, new Date('2026-08-30T12:00:00.000Z'), new Date('2026-08-30T12:00:00.000Z'))
      const archive = await createCloudDiagnosticArchive({ ...input('/unused'), crashDumpDirectory })
      try {
        const zip = await unzipper.Open.buffer(await readFile(archive.path))
        const dumpFile = zip.files.find((file) => file.path === 'crashes/plugin-crash.dmp')
        expect((await dumpFile!.buffer()).toString()).toBe('raw-minidump-bytes')
      } finally { await rm(archive.directory, { recursive: true, force: true }) }
    } finally { await rm(crashDumpDirectory, { recursive: true, force: true }) }
  })

  it('creates a Cloud-owned archive without terminal identifiers', async () => {
    const records: AuditEntry[] = [...entries, {
      id: 'event-1', timestamp: '2026-08-30T00:00:00.000Z', source: 'plugin',
      operation: 'task.failed', outcome: 'failed', summary: 'raw failure', recordKind: 'event',
      pluginId: 'com.example.plugin', errorStack: 'Error: raw failure\n    at plugin.ts:1:2',
    }]
    const archive = await createCloudDiagnosticArchive({ ...input('/unused'), entries: records, entryCount: records.length })
    try {
      const zip = await unzipper.Open.buffer(await readFile(archive.path))
      const files = new Map(zip.files.map((file) => [file.path, file]))
      expect([...files.keys()]).toEqual(['system/manifest.json', 'activity/records.json', 'plugins/inventory.json'])
      const manifest = JSON.parse((await files.get('system/manifest.json')!.buffer()).toString())
      expect(manifest).not.toHaveProperty('terminal_id')
      expect(manifest.activity_range.start_at).toBe('2026-08-24T00:00:00.000Z')
      expect(JSON.parse((await files.get('activity/records.json')!.buffer()).toString()).entries).toHaveLength(2)
      expect(JSON.parse((await files.get('activity/records.json')!.buffer()).toString()).entries[1].errorStack)
        .toBe('Error: raw failure\n    at plugin.ts:1:2')
    } finally {
      await rm(archive.directory, { recursive: true, force: true })
    }
  })

  it('resumes with the same archive and sends only missing parts after a failed request', async () => {
    const workDirectory = await mkdtemp(join(tmpdir(), 'seed-upload-test-'))
    const stored = new Map<number, Uint8Array>()
    const sent: number[] = []
    const ids: string[] = []
    let failPartTwo = true
    let fileSize = 0
    let fileSha = ''
    const response = (body: unknown, status = 200) => new Response(body === null ? null : JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json' },
    })
    const session = () => ({
      upload_id: '11111111-1111-1111-1111-111111111111', status: 'uploading',
      part_size: 100, part_count: Math.ceil(fileSize / 100),
      missing_parts: Array.from({ length: Math.ceil(fileSize / 100) }, (_, index) => index + 1).filter((part) => !stored.has(part)),
    })
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url)
      if (init?.method === 'POST' && path.endsWith('/uploads')) {
        const body = JSON.parse(String(init.body))
        ids.push(body.idempotency_key)
        fileSize = body.file_size
        fileSha = body.file_sha256
        return response(session(), 201)
      }
      if (init?.method === 'GET') return response(session())
      if (init?.method === 'PUT') {
        const part = Number(path.split('/').at(-1))
        if (part === 2 && failPartTwo) { failPartTwo = false; throw new Error('network interrupted') }
        const bytes = new Uint8Array(init.body as Uint8Array)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe((init.headers as Record<string, string>)['X-Part-SHA256'])
        stored.set(part, bytes)
        sent.push(part)
        return response(null, 204)
      }
      if (init?.method === 'POST' && path.endsWith('/complete')) {
        const combined = Buffer.concat([...stored].sort(([a], [b]) => a - b).map(([, bytes]) => Buffer.from(bytes)))
        expect(combined.length).toBe(fileSize)
        expect(createHash('sha256').update(combined).digest('hex')).toBe(fileSha)
        return response({ upload_id: session().upload_id, status: 'completed' })
      }
      throw new Error(`Unexpected request: ${init?.method} ${path}`)
    }) as unknown as typeof fetch
    try {
      await expect(new CloudDiagnosticUploader(fetcher).upload(input(workDirectory))).rejects.toThrow('network interrupted')
      expect(sent).toEqual([1])
      const result = await new CloudDiagnosticUploader(fetcher).upload({ ...input(workDirectory), entries: [] })
      expect(result.status).toBe('completed')
      expect(ids).toHaveLength(2)
      expect(ids[0]).toBe(ids[1])
      expect(sent.filter((part) => part === 1)).toHaveLength(1)
      expect(sent.length).toBe(session().part_count)
    } finally {
      await rm(workDirectory, { recursive: true, force: true })
    }
  })
})
