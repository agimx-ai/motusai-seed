import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { decodePcm16Flac, encodePcm16Flac } from './audio-flac'

export type DurableAudioSegment = {
  segment_id: string
  sequence: number
  start_ms: number
  end_ms: number
  file: string
  sha256: string
}

export type DurableAudioSession = {
  version: 1
  package_id: string
  session_id: string
  state: 'recording' | 'paused' | 'stopped' | 'interrupted'
  sample_rate: number
  channels: number
  created_at: string
  updated_at: string
  segments: DurableAudioSegment[]
}

function safePart(value: string, label: string) {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value) || value === '.' || value === '..') throw new Error(`${label} is invalid.`)
  return value
}

async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, path)
}

export class AudioSegmentStore {
  constructor(private readonly pluginDataRoot: string) {}

  private sessionDirectory(packageId: string, sessionId: string) {
    return join(this.pluginDataRoot, safePart(packageId, 'Package ID'), 'audio-sessions', safePart(sessionId, 'Session ID'))
  }

  private manifestPath(packageId: string, sessionId: string) {
    return join(this.sessionDirectory(packageId, sessionId), 'session.json')
  }

  async create(packageId: string, sessionId: string) {
    const directory = this.sessionDirectory(packageId, sessionId)
    await mkdir(join(directory, 'segments'), { recursive: true, mode: 0o700 })
    const now = new Date().toISOString()
    const session: DurableAudioSession = {
      version: 1, package_id: packageId, session_id: sessionId, state: 'recording',
      sample_rate: 16_000, channels: 1, created_at: now, updated_at: now, segments: [],
    }
    await atomicJson(this.manifestPath(packageId, sessionId), session)
    return session
  }

  async readSession(packageId: string, sessionId: string) {
    const value = JSON.parse(await readFile(this.manifestPath(packageId, sessionId), 'utf8')) as DurableAudioSession
    if (value.package_id !== packageId || value.session_id !== sessionId || value.version !== 1 || !Array.isArray(value.segments)) {
      throw new Error('Persisted audio session is invalid.')
    }
    return value
  }

  async updateState(packageId: string, sessionId: string, state: DurableAudioSession['state']) {
    const session = await this.readSession(packageId, sessionId)
    session.state = state
    session.updated_at = new Date().toISOString()
    await atomicJson(this.manifestPath(packageId, sessionId), session)
    return session
  }

  async append(packageId: string, sessionId: string, pcm: Buffer, startMs: number, endMs: number) {
    const session = await this.readSession(packageId, sessionId)
    const segmentId = randomUUID()
    const sequence = session.segments.reduce((highest, segment) => Math.max(highest, segment.sequence), -1) + 1
    const file = `${String(sequence).padStart(6, '0')}-${startMs}-${endMs}-${segmentId}.flac`
    const encoded = await encodePcm16Flac(pcm, session.sample_rate, session.channels)
    const target = join(this.sessionDirectory(packageId, sessionId), 'segments', file)
    const temporary = `${target}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(encoded)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, target)
    const segment: DurableAudioSegment = {
      segment_id: segmentId,
      sequence,
      start_ms: startMs,
      end_ms: endMs,
      file,
      sha256: createHash('sha256').update(encoded).digest('hex'),
    }
    session.segments.push(segment)
    session.updated_at = new Date().toISOString()
    await atomicJson(this.manifestPath(packageId, sessionId), session)
    return segment
  }

  async list(packageId: string, activeSessionId = '') {
    const root = join(this.pluginDataRoot, safePart(packageId, 'Package ID'), 'audio-sessions')
    const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const sessions: DurableAudioSession[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const session = await this.readSession(packageId, entry.name).catch(() => null)
      if (!session) continue
      const segmentDirectory = join(this.sessionDirectory(packageId, session.session_id), 'segments')
      const files = await readdir(segmentDirectory, { withFileTypes: true })
      let reconciled = false
      for (const fileEntry of files) {
        if (!fileEntry.isFile() || session.segments.some((segment) => segment.file === fileEntry.name)) continue
        const match = /^(\d+)-(\d+)-(\d+)-([A-Za-z0-9-]+)\.flac$/.exec(fileEntry.name)
        if (!match) continue
        const encoded = await readFile(join(segmentDirectory, fileEntry.name))
        session.segments.push({
          sequence: Number(match[1]), start_ms: Number(match[2]), end_ms: Number(match[3]), segment_id: match[4],
          file: fileEntry.name, sha256: createHash('sha256').update(encoded).digest('hex'),
        })
        reconciled = true
      }
      if (reconciled) {
        session.segments.sort((left, right) => left.sequence - right.sequence)
        session.updated_at = new Date().toISOString()
        await atomicJson(this.manifestPath(packageId, session.session_id), session)
      }
      if (session.session_id !== activeSessionId && (session.state === 'recording' || session.state === 'paused')) {
        session.state = 'interrupted'
        session.updated_at = new Date().toISOString()
        await atomicJson(this.manifestPath(packageId, session.session_id), session)
      }
      sessions.push(session)
    }
    return sessions.sort((left, right) => left.created_at.localeCompare(right.created_at))
  }

  async readSegment(packageId: string, sessionId: string, segmentId: string) {
    const session = await this.readSession(packageId, sessionId)
    const segment = session.segments.find((candidate) => candidate.segment_id === segmentId)
    if (!segment || basename(segment.file) !== segment.file) throw new Error('Persisted audio segment was not found.')
    const encoded = await readFile(join(this.sessionDirectory(packageId, sessionId), 'segments', segment.file))
    if (createHash('sha256').update(encoded).digest('hex') !== segment.sha256) throw new Error('Persisted audio segment failed integrity verification.')
    return { ...await decodePcm16Flac(encoded), segment }
  }

  async acknowledge(packageId: string, sessionId: string, segmentId: string) {
    const session = await this.readSession(packageId, sessionId)
    const segment = session.segments.find((candidate) => candidate.segment_id === segmentId)
    if (!segment) return session
    session.segments = session.segments.filter((candidate) => candidate.segment_id !== segmentId)
    session.updated_at = new Date().toISOString()
    await atomicJson(this.manifestPath(packageId, sessionId), session)
    await rm(join(this.sessionDirectory(packageId, sessionId), 'segments', segment.file), { force: true })
    return session
  }

  async discard(packageId: string, sessionId: string) {
    await rm(this.sessionDirectory(packageId, sessionId), { recursive: true, force: true })
  }
}
