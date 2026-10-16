import { lstat, mkdir, open, rm, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import type { AudioCaptureSource } from '../shared/audio-capture'

type TrackName = 'microphone' | 'system' | 'output'
type Track = { file: FileHandle; bytes: number }
const bytesPerSecond = 16_000 * 2
const maxPendingBytes = 2 * 1024 * 1024

function wavHeader(bytes: number) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + bytes, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16_000, 24)
  header.writeUInt32LE(bytesPerSecond, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(bytes, 40)
  return header
}

/** Private, local WAVs for the latest capture only. Never sends audio to a model. */
export class AudioDebugRecording {
  private writes: Promise<void> = Promise.resolve()
  private saveTask: Promise<string> | null = null
  private pendingBytes = 0
  private error: unknown

  private constructor(readonly directory: string, private readonly tracks: Map<TrackName, Track>) {}

  static async start(root: string, source: AudioCaptureSource) {
    await mkdir(root, { recursive: true, mode: 0o700 })
    const info = await lstat(root)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Audio debug root must be a local directory.')
    const directory = join(root, 'latest')
    const previous = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    if (previous && (!previous.isDirectory() || previous.isSymbolicLink())) throw new Error('Audio debug destination must be a local directory.')
    await rm(directory, { recursive: true, force: true })
    await mkdir(directory, { mode: 0o700 })
    const names: TrackName[] = source === 'mixed' ? ['microphone', 'system', 'output'] : [source, 'output']
    const tracks = new Map<TrackName, Track>()
    try {
      for (const name of names) {
        const filename = name === 'output' && source === 'mixed' ? 'mixed.wav' : `${name}.wav`
        const file = await open(join(directory, filename), 'wx', 0o600)
        tracks.set(name, { file, bytes: 0 })
        await file.writeFile(wavHeader(0))
      }
      return new AudioDebugRecording(directory, tracks)
    } catch (error) {
      await Promise.allSettled([...tracks.values()].map((track) => track.file.close()))
      throw error
    }
  }

  append(name: TrackName, pcm: Buffer) {
    const track = this.tracks.get(name)
    if (!track || this.saveTask || this.error || !pcm.length) return
    if (this.pendingBytes + pcm.length > maxPendingBytes) {
      this.error = new Error('Audio debug disk writes cannot keep up with capture.')
      return
    }
    const copy = Buffer.from(pcm)
    this.pendingBytes += copy.length
    this.writes = this.writes.then(async () => {
      if (this.error) return
      if (track.bytes + copy.length > 0xffff_ffff - 36) throw new Error('Audio debug WAV exceeds the RIFF size limit.')
      await track.file.writeFile(copy)
      track.bytes += copy.length
    }).catch((error) => { this.error = error }).finally(() => { this.pendingBytes -= copy.length })
  }

  finish(): Promise<string> {
    this.saveTask ??= this.save()
    return this.saveTask
  }

  private async save() {
    await this.writes
    const results = await Promise.allSettled([...this.tracks.values()].map(async (track) => {
      try { await track.file.write(wavHeader(track.bytes), 0, 44, 0) } finally { await track.file.close() }
    }))
    if (this.error) throw this.error
    for (const result of results) if (result.status === 'rejected') throw result.reason
    return this.directory
  }
}
