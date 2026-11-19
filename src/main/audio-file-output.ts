import { close, fsync, ftruncate, openSync, realpathSync, write } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import type { AudioFileOutputPaths, AudioStreamFormat } from '@motus-ai/seed-sdk'
import type { AudioCaptureSource } from '../shared/audio-capture'

type Track = keyof AudioFileOutputPaths

const closeFile = promisify(close)
const syncFile = promisify(fsync)
const truncateFile = promisify(ftruncate)
const maxInFlightBytes = 2 * 1024 * 1024

function invalidOutput(message: string) {
  return Object.assign(new Error(message), { code: 'audio_output_invalid' })
}

async function outputPaths(root: string, owner: string, source: AudioCaptureSource, output: unknown) {
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(owner) || !output || typeof output !== 'object')
    throw invalidOutput('音频文件必须写入插件的私有数据目录。')
  const ownerPath = join(await realpath(root), owner)
  const ownerRoot = await realpath(ownerPath)
  if (ownerPath !== ownerRoot || !(await lstat(ownerRoot)).isDirectory())
    throw invalidOutput('插件的音频输出目录无效。')

  const names: Track[] = source === 'mixed' ? ['microphone', 'system'] : [source]
  const paths = new Map<Track, string>()
  for (const track of names) {
    const value = (output as Record<string, unknown>)[track]
    if (typeof value !== 'string' || value.length > 4096 || !/\.wav$/i.test(value) ||
        /[\u0000-\u001f<>:"\\|?*]/.test(value) ||
        value.split('/').some((part) => !part || /[ .]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
      throw invalidOutput('请为每路音源提供插件目录内的 WAV 路径。')
    const path = join(ownerRoot, value)
    const parent = await realpath(dirname(path))
    const boundary = relative(ownerRoot, parent)
    if (boundary === '..' || boundary.startsWith('..' + sep) || isAbsolute(boundary))
      throw invalidOutput('音频输出路径超出插件的私有数据目录。')
    const target = join(parent, basename(path))
    if ([...paths.values()].some((path) => path.toLowerCase() === target.toLowerCase()))
      throw invalidOutput('不同音源需要使用不同的 WAV 文件。')
    const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    if (existing) throw invalidOutput('音频输出文件已存在。')
    paths.set(track, target)
  }
  return paths
}

function wavFormat(format: AudioStreamFormat) {
  const { encoding, channels, sample_rate, bits_per_sample, layout } = format
  const float = (bits_per_sample === 32 || bits_per_sample === 64) && encoding === ('pcm_f' + bits_per_sample + 'le')
  const integer = encoding === 'pcm_u8' && bits_per_sample === 8 ||
    [16, 24, 32].includes(bits_per_sample) && encoding === ('pcm_s' + bits_per_sample + 'le')
  const frameBytes = channels * bits_per_sample / 8
  if ((!float && !integer) || !Number.isInteger(channels) || channels < 1 || channels > 64 ||
      !Number.isInteger(sample_rate) || sample_rate < 1 || sample_rate > 384_000 ||
      (layout !== 'interleaved' && layout !== 'planar'))
    throw new Error('采集格式无法写入 WAV。')
  const header = Buffer.alloc(float ? 58 : 44)
  header.write('RIFF')
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(float ? 18 : 16, 16)
  header.writeUInt16LE(float ? 3 : 1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sample_rate, 24)
  header.writeUInt32LE(sample_rate * frameBytes, 28)
  header.writeUInt16LE(frameBytes, 32)
  header.writeUInt16LE(bits_per_sample, 34)
  if (float) {
    header.write('fact', 38)
    header.writeUInt32LE(4, 42)
  }
  header.write('data', header.length - 8)
  return { header, frameBytes }
}

async function writeAll(fd: number, data: Buffer, position: number) {
  for (let offset = 0; offset < data.length;) {
    const bytes = await new Promise<number>((resolve, reject) => {
      write(fd, data, offset, data.length - offset, position + offset, (error, written) => {
        if (error) reject(error)
        else resolve(written)
      })
    })
    if (!bytes) throw new Error('写入音频文件失败。')
    offset += bytes
  }
}

function interleave(data: Buffer, format: AudioStreamFormat, frameBytes: number) {
  if (format.layout === 'interleaved' || format.channels === 1) return Buffer.from(data)
  const samples = data.length / frameBytes
  const sampleBytes = format.bits_per_sample / 8
  const converted = Buffer.allocUnsafe(data.length)
  for (let frame = 0; frame < samples; frame++)
    for (let channel = 0; channel < format.channels; channel++) {
      const from = (channel * samples + frame) * sampleBytes
      data.copy(converted, frame * frameBytes + channel * sampleBytes, from, from + sampleBytes)
    }
  return converted
}

class WavTrack {
  readonly formatKey: string
  private readonly fd: number
  private readonly header: Buffer
  readonly frameBytes: number
  private bytes = 0
  private unwrittenFrom = Infinity
  private readonly pending = new Set<Promise<void>>()
  private saved?: Promise<boolean>

  constructor(readonly path: string, format: AudioStreamFormat) {
    const { header, frameBytes } = wavFormat(format)
    this.header = header
    this.frameBytes = frameBytes
    this.formatKey = JSON.stringify(format)
    if (realpathSync(dirname(path)) !== dirname(path)) throw invalidOutput('音频输出目录已更改。')
    this.fd = openSync(path, 'wx', 0o600)
  }

  hasRoom(bytes: number) {
    const size = this.bytes + bytes
    return this.header.length - 8 + size + size % 2 <= 0xffff_ffff
  }

  append(data: Buffer, completed: (error?: unknown) => void) {
    const position = this.bytes
    this.bytes += data.length
    const task = writeAll(this.fd, data, this.header.length + position).then(
      () => completed(),
      (error: unknown) => {
        this.unwrittenFrom = Math.min(this.unwrittenFrom, position)
        completed(error)
      },
    ).finally(() => { this.pending.delete(task) })
    this.pending.add(task)
  }

  finish() {
    return this.saved ??= this.save()
  }

  private async save() {
    try {
      await Promise.all(this.pending)
      const bytes = Math.min(this.bytes, this.unwrittenFrom)
      if (bytes < this.bytes) await truncateFile(this.fd, this.header.length + bytes)
      if (bytes % 2) await writeAll(this.fd, Buffer.alloc(1), this.header.length + bytes)
      this.header.writeUInt32LE(this.header.length - 8 + bytes + bytes % 2, 4)
      this.header.writeUInt32LE(bytes, this.header.length - 4)
      if (this.header.length === 58) this.header.writeUInt32LE(bytes / this.frameBytes, 46)
      await writeAll(this.fd, this.header, 0)
      await syncFile(this.fd)
      return bytes > 0
    } finally {
      await closeFile(this.fd)
    }
  }
}

/** Direct positioned file writes. The only outstanding audio is already submitted to the filesystem. */
export class AudioFileOutput {
  private readonly tracks = new Map<Track, WavTrack[]>()
  private readonly partNumbers = new Map<Track, number>()
  private inFlightBytes = 0
  private result?: Promise<{ audio_files: string[]; audio_save_failed?: true }>
  private failed = false

  private constructor(private readonly paths: Map<Track, string>) {}

  static async prepare(root: string | undefined, owner: string, source: AudioCaptureSource, output: unknown) {
    if (!root) throw invalidOutput('插件音频文件输出不可用。')
    return new AudioFileOutput(await outputPaths(root, owner, source, output))
  }

  get saveFailed() { return this.failed }

  append(source: Track, format: AudioStreamFormat, pcm: Buffer) {
    if (this.result || this.failed) return
    if (this.inFlightBytes + pcm.length > maxInFlightBytes) {
      this.failed = true
      return
    }
    try {
      const path = this.paths.get(source)
      if (!path) throw new Error('未指定音源的音频文件。')
      const tracks = this.tracks.get(source) ?? []
      let track = tracks.at(-1)
      if (!track || track.formatKey !== JSON.stringify(format) || !track.hasRoom(pcm.length)) {
        if (track) this.finishTrack(track)
        let part = this.partNumbers.get(source) ?? 0
        let nextPath: string
        do {
          part += 1
          nextPath = part === 1 ? path : path.slice(0, -4) + '-' + part + '.wav'
        } while (part > 1 && [...this.paths.values()].some((reserved) => reserved.toLowerCase() === nextPath.toLowerCase()))
        this.partNumbers.set(source, part)
        track = new WavTrack(nextPath, format)
        tracks.push(track)
        this.tracks.set(source, tracks)
      }
      if (pcm.length % track.frameBytes) throw new Error('音频帧大小无效。')
      const data = interleave(pcm, format, track.frameBytes)
      this.inFlightBytes += data.length
      track.append(data, (error) => {
        this.inFlightBytes -= data.length
        if (error) this.failed = true
      })
    } catch {
      this.failed = true
    }
  }

  finish() {
    return this.result ??= this.save()
  }

  private finishTrack(track: WavTrack) {
    return track.finish().catch(() => {
      this.failed = true
      return false
    })
  }

  private async save() {
    const tracks = [...this.tracks.values()].flat()
    const saved = await Promise.all(tracks.map((track) => this.finishTrack(track)))
    return {
      audio_files: tracks.filter((_track, index) => saved[index]).map((track) => track.path),
      ...(this.failed ? { audio_save_failed: true as const } : {}),
    }
  }
}
