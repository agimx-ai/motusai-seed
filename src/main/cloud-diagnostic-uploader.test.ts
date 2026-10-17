import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as unzipper from 'unzipper'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuditEntry } from '../shared/contracts'
import { assertDiagnosticArchiveSize, createCloudDiagnosticArchive, CloudDiagnosticUploader, diagnosticUploadMaxBytes } from './cloud-diagnostic-uploader'
import { LatestAudioRecording } from './latest-audio-recording'

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

const recordingRoots: string[] = []
async function recordingRoot() {
  const root = await mkdtemp(join(tmpdir(), 'seed-diagnostic-recording-test-'))
  recordingRoots.push(root)
  return root
}
async function saveRecording(root: string, source: 'microphone' | 'system' | 'mixed' = 'mixed', sample = 1) {
  const recording = await LatestAudioRecording.start(root, source)
  recording.append('microphone', Buffer.from([sample, 0, sample + 1, 0]))
  recording.append('system', Buffer.from([sample + 2, 0, sample + 3, 0]))
  recording.append('output', Buffer.from([sample + 4, 0, sample + 5, 0]))
  await recording.finish()
  return recording.directory
}
afterEach(async () => { await Promise.all(recordingRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

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

  it('includes only the three latest WAVs byte-for-byte, without history, unrelated files or retained snapshots', async () => {
    const root = await recordingRoot()
    const latestRecordingDirectory = await saveRecording(root)
    await mkdir(join(root, 'history'))
    await writeFile(join(root, 'history', 'mixed.wav'), 'historical audio')
    await writeFile(join(latestRecordingDirectory, 'other.wav'), 'unrelated audio')
    await writeFile(join(latestRecordingDirectory, 'output.wav'), 'redundant output')
    await writeFile(join(latestRecordingDirectory, 'private.json'), 'must not be included')
    const archive = await createCloudDiagnosticArchive({ ...input('/unused'), latestRecordingDirectory })
    try {
      const zip = await unzipper.Open.buffer(await readFile(archive.path))
      const audio = zip.files.filter((file) => file.path.startsWith('recordings/'))
      expect(audio.map((file) => file.path)).toEqual([
        'recordings/latest/microphone.wav', 'recordings/latest/system.wav', 'recordings/latest/mixed.wav',
      ])
      for (const file of audio) expect(await file.buffer()).toEqual(await readFile(join(latestRecordingDirectory, file.path.split('/').at(-1)!)))
      expect(zip.files.some((file) => /history|other.wav|output.wav|private.json/.test(file.path))).toBe(false)
      const manifest = JSON.parse((await zip.files.find((file) => file.path === 'system/manifest.json')!.buffer()).toString())
      expect(manifest.recording_file_count).toBe(3)
      expect(JSON.stringify(manifest)).not.toContain(root)
      expect(await readdir(archive.directory)).toEqual(['diagnostics.zip'])
    } finally { await rm(archive.directory, { recursive: true, force: true }) }
  })

  it.each(['missing', 'empty', 'microphone'] as const)('allows %s recordings without requiring all three audio sources', async (source) => {
    const root = await recordingRoot()
    const latestRecordingDirectory = join(root, 'latest')
    if (source === 'empty') await mkdir(latestRecordingDirectory)
    if (source === 'microphone') await saveRecording(root, 'microphone')
    const archive = await createCloudDiagnosticArchive({ ...input('/unused'), latestRecordingDirectory })
    try {
      const zip = await unzipper.Open.buffer(await readFile(archive.path))
      expect(zip.files.filter((file) => file.path.startsWith('recordings/')).map((file) => file.path))
        .toEqual(source === 'microphone' ? ['recordings/latest/microphone.wav'] : [])
      expect(await readdir(archive.directory)).toEqual(['diagnostics.zip'])
    } finally { await rm(archive.directory, { recursive: true, force: true }) }
  })

  it.skipIf(process.platform === 'win32')('does not follow audio file symlinks or a symlinked latest directory', async () => {
    const root = await recordingRoot()
    const latestRecordingDirectory = await saveRecording(root)
    const outside = join(root, 'outside.wav')
    await writeFile(outside, 'private external content')
    await rm(join(latestRecordingDirectory, 'system.wav'))
    await symlink(outside, join(latestRecordingDirectory, 'system.wav'))
    const archive = await createCloudDiagnosticArchive({ ...input('/unused'), latestRecordingDirectory })
    try {
      const zip = await unzipper.Open.buffer(await readFile(archive.path))
      expect(zip.files.some((file) => file.path.endsWith('system.wav'))).toBe(false)
    } finally { await rm(archive.directory, { recursive: true, force: true }) }
    await rename(latestRecordingDirectory, join(root, 'linked-target'))
    await symlink(join(root, 'linked-target'), latestRecordingDirectory, 'dir')
    await expect(createCloudDiagnosticArchive({ ...input('/unused'), latestRecordingDirectory }, root)).rejects.toThrow('录音目录无效')
    expect((await readdir(root)).some((name) => name.startsWith('motusai-seed-diagnostics-'))).toBe(false)
    expect(await readFile(outside, 'utf8')).toBe('private external content')
  })

  it('rejects oversized audio totals before reading their payloads or starting an upload', async () => {
    const root = await recordingRoot()
    const latestRecordingDirectory = await saveRecording(root)
    for (const name of ['microphone.wav', 'system.wav']) {
      const file = await open(join(latestRecordingDirectory, name), 'r+')
      try { await file.truncate(diagnosticUploadMaxBytes / 2 + 1) } finally { await file.close() }
    }
    const fetcher = vi.fn()
    await expect(new CloudDiagnosticUploader(fetcher).upload({ ...input(join(root, 'uploads')), latestRecordingDirectory })).rejects.toThrow('512 MiB')
    expect(fetcher).not.toHaveBeenCalled()
    const accountDirectory = join(root, 'uploads', createHash('sha256').update('user-1').digest('hex'))
    expect(await readdir(accountDirectory)).toEqual([])
  })

  it.skipIf(process.platform === 'win32')('rejects a symlinked recordings parent without reading outside the host storage', async () => {
    const root = await recordingRoot()
    const target = await recordingRoot()
    await saveRecording(target)
    await symlink(target, join(root, 'recordings'), 'dir')
    await expect(createCloudDiagnosticArchive({ ...input('/unused'), latestRecordingDirectory: join(root, 'recordings', 'latest') }, root))
      .rejects.toThrow('录音目录无效')
    expect(await readdir(root)).toEqual(['recordings'])
  })

  it('rejects unfinished recordings and removes the temporary package', async () => {
    const root = await recordingRoot()
    const recording = await LatestAudioRecording.start(root, 'mixed')
    recording.append('microphone', Buffer.from([1, 0]))
    await Reflect.get(recording, 'writes')
    try {
      await expect(createCloudDiagnosticArchive({ ...input('/unused'), latestRecordingDirectory: recording.directory }, root)).rejects.toThrow('停止录音')
      expect(await readdir(root)).toEqual(['latest'])
    } finally { await recording.finish() }
  })

  it('keeps a consistent snapshot when a new recording replaces latest during archive generation', async () => {
    const root = await recordingRoot()
    const latestRecordingDirectory = await saveRecording(root)
    const expected = await readFile(join(latestRecordingDirectory, 'mixed.wav'))
    async function* activity() {
      await saveRecording(root, 'mixed', 10)
      yield entries[0]!
    }
    const archive = await createCloudDiagnosticArchive({ ...input('/unused'), entries: activity(), latestRecordingDirectory })
    try {
      const zip = await unzipper.Open.buffer(await readFile(archive.path))
      expect(await zip.files.find((file) => file.path === 'recordings/latest/mixed.wav')!.buffer()).toEqual(expected)
      expect(await readFile(join(latestRecordingDirectory, 'mixed.wav'))).not.toEqual(expected)
      expect(await readdir(root)).toEqual(['latest'])
      expect(await readdir(archive.directory)).toEqual(['diagnostics.zip'])
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
    const latestRecordingDirectory = await saveRecording(join(workDirectory, 'recordings'))
    const expectedAudio = await readFile(join(latestRecordingDirectory, 'mixed.wav'))
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
        const zip = await unzipper.Open.buffer(combined)
        expect(await zip.files.find((file) => file.path === 'recordings/latest/mixed.wav')!.buffer()).toEqual(expectedAudio)
        return response({ upload_id: session().upload_id, status: 'completed' })
      }
      throw new Error(`Unexpected request: ${init?.method} ${path}`)
    }) as unknown as typeof fetch
    try {
      await expect(new CloudDiagnosticUploader(fetcher).upload({ ...input(workDirectory), latestRecordingDirectory })).rejects.toThrow('network interrupted')
      expect(sent).toEqual([1])
      await saveRecording(join(workDirectory, 'recordings'), 'mixed', 20)
      const result = await new CloudDiagnosticUploader(fetcher).upload({ ...input(workDirectory), entries: [], latestRecordingDirectory })
      expect(result.status).toBe('completed')
      expect(ids).toHaveLength(2)
      expect(ids[0]).toBe(ids[1])
      expect(sent.filter((part) => part === 1)).toHaveLength(1)
      expect(sent.length).toBe(session().part_count)
      const accountDirectory = join(workDirectory, createHash('sha256').update('user-1').digest('hex'))
      expect(await readdir(accountDirectory)).toEqual([])
    } finally {
      await rm(workDirectory, { recursive: true, force: true })
    }
  })

  it('removes a cancelled upload package while preserving the original latest WAVs', async () => {
    const root = await recordingRoot()
    const latestRecordingDirectory = await saveRecording(join(root, 'recordings'))
    const expectedAudio = await readFile(join(latestRecordingDirectory, 'mixed.wav'))
    const controller = new AbortController()
    const session = { upload_id: '11111111-1111-1111-1111-111111111111', status: 'uploading', part_size: 1024 * 1024, part_count: 1, missing_parts: [1] }
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        controller.abort()
        throw new DOMException('Upload cancelled', 'AbortError')
      }
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      return new Response(JSON.stringify(session), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as unknown as typeof fetch
    const workDirectory = join(root, 'uploads')
    await expect(new CloudDiagnosticUploader(fetcher).upload({ ...input(workDirectory), latestRecordingDirectory }, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(await readdir(join(workDirectory, createHash('sha256').update('user-1').digest('hex')))).toEqual([])
    expect(await readFile(join(latestRecordingDirectory, 'mixed.wav'))).toEqual(expectedAudio)
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(session.upload_id), expect.objectContaining({ method: 'DELETE' }))
  })

  it('cleans unfinished snapshot directories after a restart without deleting unrelated files', async () => {
    const root = await recordingRoot()
    const accountDirectory = join(root, createHash('sha256').update('user-1').digest('hex'))
    await mkdir(accountDirectory)
    const leftover = await mkdtemp(join(accountDirectory, 'motusai-seed-diagnostics-'))
    await mkdir(join(leftover, 'recordings', 'latest'), { recursive: true })
    await writeFile(join(leftover, 'recordings', 'latest', 'mixed.wav'), 'old temporary snapshot')
    await writeFile(join(accountDirectory, 'keep.txt'), 'unrelated')
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      upload_id: '11111111-1111-1111-1111-111111111111', status: 'completed', part_size: 1024 * 1024, part_count: 1, missing_parts: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch
    expect(await new CloudDiagnosticUploader(fetcher).upload(input(root))).toMatchObject({ status: 'completed' })
    expect(await readdir(accountDirectory)).toEqual(['keep.txt'])
    expect(await readFile(join(accountDirectory, 'keep.txt'), 'utf8')).toBe('unrelated')
  })
})
