import { close, fsync, ftruncate, openSync, readSync, realpathSync, statSync, write } from 'node:fs'
import { lstat, realpath, statfs } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import type { AudioStreamFormat } from '@motus-ai/seed-sdk'
import type { AudioCaptureSource } from '../shared/audio-capture'

type Track = 'microphone' | 'system'

const closeFile = promisify(close)
const syncFile = promisify(fsync)
const truncateFile = promisify(ftruncate)
const maxInFlightBytes = 16 * 1024 * 1024
const targetSampleRate = 16_000
const stereoLeadSamples = 1_600 // 100ms max lead before padding silent channel with 0
const headerFlushIntervalBytes = 256 * 1024 // ~4-8s of 16kHz PCM16
const minFreeDiskBytes = 256 * 1024 * 1024 // 256 MiB safety floor
const diskCheckIntervalMs = 10_000

function invalidOutput(message: string) {
  return Object.assign(new Error(message), { code: 'audio_output_invalid' })
}

async function hasEnoughDiskSpace(directory: string) {
  try {
    const info = await statfs(directory)
    const freeBytes = Number(info.bavail) * Number(info.bsize)
    return !Number.isFinite(freeBytes) || freeBytes >= minFreeDiskBytes
  } catch {
    return true
  }
}

async function resolveWavPath(ownerRoot: string, value: unknown, allowExisting: boolean) {
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
  const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
  if (existing) {
    if (!allowExisting || !existing.isFile()) throw invalidOutput('音频输出文件已存在。')
  }
  return { target, exists: Boolean(existing) }
}

async function outputPaths(root: string, owner: string, source: AudioCaptureSource, output: unknown) {
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(owner) || !output || typeof output !== 'object')
    throw invalidOutput('音频文件必须写入插件的私有数据目录。')
  const ownerPath = join(await realpath(root), owner)
  const ownerRoot = await realpath(ownerPath)
  if (ownerPath !== ownerRoot || !(await lstat(ownerRoot)).isDirectory())
    throw invalidOutput('插件的音频输出目录无效。')

  const record = output as Record<string, unknown>
  const append = record.append === true
  if (record.stereo !== undefined) {
    const resolved = await resolveWavPath(ownerRoot, record.stereo, append)
    return { ownerRoot, stereoPath: resolved.target, appendExisting: resolved.exists, paths: new Map<Track, string>() }
  }

  const names: Track[] = source === 'mixed' ? ['microphone', 'system'] : [source]
  const paths = new Map<Track, string>()
  for (const track of names) {
    const resolved = await resolveWavPath(ownerRoot, record[track], false)
    if ([...paths.values()].some((p) => p.toLowerCase() === resolved.target.toLowerCase()))
      throw invalidOutput('不同音源需要使用不同的 WAV 文件。')
    paths.set(track, resolved.target)
  }
  return { ownerRoot, stereoPath: undefined, appendExisting: false, paths }
}

function pcm16WavHeader(channels: 1 | 2) {
  const frameBytes = channels * 2
  const header = Buffer.alloc(44)
  header.write('RIFF')
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(targetSampleRate, 24)
  header.writeUInt32LE(targetSampleRate * frameBytes, 28)
  header.writeUInt16LE(frameBytes, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(36, 4)
  header.writeUInt32LE(0, 40)
  return header
}

function validateFormat(format: AudioStreamFormat) {
  const { encoding, channels, sample_rate, bits_per_sample, layout } = format
  const float = (bits_per_sample === 32 || bits_per_sample === 64) && encoding === ('pcm_f' + bits_per_sample + 'le')
  const integer = encoding === 'pcm_u8' && bits_per_sample === 8 ||
    [16, 24, 32].includes(bits_per_sample) && encoding === ('pcm_s' + bits_per_sample + 'le')
  const frameBytes = channels * bits_per_sample / 8
  if ((!float && !integer) || !Number.isInteger(channels) || channels < 1 || channels > 64 ||
      !Number.isInteger(sample_rate) || sample_rate < 1 || sample_rate > 384_000 ||
      (layout !== 'interleaved' && layout !== 'planar'))
    throw new Error('采集格式无法写入 WAV。')
  return { frameBytes, sampleBytes: bits_per_sample / 8, float }
}

function readNormalizedSample(data: Buffer, offset: number, format: AudioStreamFormat) {
  const { encoding, bits_per_sample } = format
  if (encoding === 'pcm_f32le' && bits_per_sample === 32) return data.readFloatLE(offset)
  if (encoding === 'pcm_f64le' && bits_per_sample === 64) return data.readDoubleLE(offset)
  if (encoding === 'pcm_s16le' && bits_per_sample === 16) return data.readInt16LE(offset) / 32_768
  if (encoding === 'pcm_s32le' && bits_per_sample === 32) return data.readInt32LE(offset) / 2_147_483_648
  if (encoding === 'pcm_s24le' && bits_per_sample === 24) {
    const raw = data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16)
    return (raw & 0x800000 ? raw | ~0xffffff : raw) / 8_388_608
  }
  if (encoding === 'pcm_u8' && bits_per_sample === 8) return (data[offset]! - 128) / 128
  return 0
}

function encodePcm16(samples: number[]) {
  const bytes = Buffer.allocUnsafe(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const value = Number.isFinite(samples[i]) ? Math.max(-1, Math.min(1, samples[i]!)) : 0
    bytes.writeInt16LE(Math.round(value * (value < 0 ? 32_768 : 32_767)), i * 2)
  }
  return bytes
}

/** Downmixes and resamples arbitrary captured PCM to 16 kHz mono 16-bit PCM with a 1-pole low-pass filter. */
class Pcm16MonoResampler {
  private rate = 0
  private position = 0
  private next = 0
  private previous = 0
  private filtered = 0
  private alpha = 1

  push(data: Buffer, format: AudioStreamFormat): Buffer {
    const { frameBytes, sampleBytes } = validateFormat(format)
    if (data.length % frameBytes) throw new Error('音频帧大小无效。')
    const frames = data.length / frameBytes
    if (!frames) return Buffer.alloc(0)
    if (format.sample_rate === targetSampleRate && format.channels === 1 &&
        format.encoding === 'pcm_s16le' && format.bits_per_sample === 16) {
      return Buffer.from(data)
    }
    let pending: Buffer | undefined
    if (format.sample_rate !== this.rate) {
      pending = this.finish()
      this.rate = format.sample_rate
      if (this.rate > targetSampleRate) {
        const dt = 1 / this.rate
        const rc = 1 / (2 * Math.PI * 7_200)
        this.alpha = dt / (rc + dt)
      } else {
        this.alpha = 1
      }
      this.filtered = 0
    }
    const out: number[] = []
    const { channels, layout } = format
    for (let frame = 0; frame < frames; frame++) {
      let mono = 0
      for (let channel = 0; channel < channels; channel++) {
        const index = layout === 'planar' ? channel * frames + frame : frame * channels + channel
        mono += readNormalizedSample(data, index * sampleBytes, format)
      }
      mono /= channels
      this.filtered = this.alpha < 1 ? this.filtered + this.alpha * (mono - this.filtered) : mono
      const sample = this.filtered
      const end = this.position * targetSampleRate
      while (this.next <= end) {
        const fraction = 1 - (end - this.next) / targetSampleRate
        out.push(this.position ? this.previous + fraction * (sample - this.previous) : sample)
        this.next += this.rate
      }
      this.previous = sample
      this.position += 1
    }
    const converted = encodePcm16(out)
    return pending?.length ? Buffer.concat([pending, converted]) : converted
  }

  finish(): Buffer {
    const out: number[] = []
    while (this.rate && this.next < this.position * targetSampleRate) {
      out.push(this.previous)
      this.next += this.rate
    }
    this.position = this.next = this.previous = this.rate = this.filtered = 0
    this.alpha = 1
    return encodePcm16(out)
  }
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

function interleaveStereoPcm16(left: Buffer, right: Buffer, frames: number) {
  const out = Buffer.allocUnsafe(frames * 4)
  for (let i = 0; i < frames; i++) {
    const off = i * 2
    out.writeInt16LE(off < left.length ? left.readInt16LE(off) : 0, i * 4)
    out.writeInt16LE(off < right.length ? right.readInt16LE(off) : 0, i * 4 + 2)
  }
  return out
}

class WavTrack {
  private readonly fd: number
  private readonly header: Buffer
  private bytes = 0
  private lastHeaderBytes = -1
  private unwrittenFrom = Infinity
  private readonly pending = new Set<Promise<void>>()
  private saved?: Promise<boolean>

  constructor(readonly path: string, channels: 1 | 2 = 1, appendExisting = false) {
    if (realpathSync(dirname(path)) !== dirname(path)) throw invalidOutput('音频输出目录已更改。')
    this.header = pcm16WavHeader(channels)
    if (appendExisting) {
      const fd = openSync(path, 'r+')
      try {
        const existingHeader = Buffer.alloc(44)
        const read = readSync(fd, existingHeader, 0, 44, 0)
        const valid = read === 44 &&
          existingHeader.toString('ascii', 0, 4) === 'RIFF' &&
          existingHeader.toString('ascii', 8, 16) === 'WAVEfmt ' &&
          existingHeader.readUInt16LE(20) === 1 &&
          existingHeader.readUInt16LE(22) === channels &&
          existingHeader.readUInt32LE(24) === targetSampleRate &&
          existingHeader.readUInt16LE(34) === 16 &&
          existingHeader.toString('ascii', 36, 40) === 'data'
        if (!valid) throw invalidOutput('现有 WAV 文件格式不兼容，无法续写。')
        const frameBytes = channels * 2
        const fileSize = statSync(path).size
        const declared = existingHeader.readUInt32LE(40)
        const maxAvailable = Math.max(0, fileSize - 44)
        const existingBytes = Math.min(declared, maxAvailable)
        this.bytes = existingBytes - (existingBytes % frameBytes)
        this.lastHeaderBytes = this.bytes
        this.fd = fd
      } catch (error) {
        try { close(fd, () => undefined) } catch { /* ignore */ }
        throw error
      }
      return
    }
    this.fd = openSync(path, 'wx', 0o600)
    this.scheduleHeaderUpdate(0)
  }

  hasRoom(bytes: number) {
    const size = this.bytes + bytes
    return this.header.length - 8 + size + size % 2 <= 0xffff_ffff
  }

  private scheduleHeaderUpdate(writtenBytes: number) {
    if (writtenBytes === this.lastHeaderBytes) return
    this.lastHeaderBytes = writtenBytes
    const header = Buffer.from(this.header)
    header.writeUInt32LE(header.length - 8 + writtenBytes + writtenBytes % 2, 4)
    header.writeUInt32LE(writtenBytes, header.length - 4)
    const task = writeAll(this.fd, header, 0).catch(() => undefined).finally(() => { this.pending.delete(task) })
    this.pending.add(task)
  }

  append(data: Buffer, completed: (error?: unknown) => void) {
    if (!data.length) { completed(); return }
    const position = this.bytes
    this.bytes += data.length
    const writeWithRetry = async () => {
      try {
        await writeAll(this.fd, data, this.header.length + position)
      } catch {
        await writeAll(this.fd, data, this.header.length + position)
      }
    }
    const task = writeWithRetry().then(
      () => {
        if (this.bytes - this.lastHeaderBytes >= headerFlushIntervalBytes && this.unwrittenFrom === Infinity) {
          this.scheduleHeaderUpdate(this.bytes)
        }
        completed()
      },
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
      await writeAll(this.fd, this.header, 0)
      await syncFile(this.fd)
      return bytes > 0
    } finally {
      await closeFile(this.fd)
    }
  }
}

/** Direct positioned 16 kHz PCM16 WAV writes (mono per-track or single continuous stereo L=mic/R=system). */
export class AudioFileOutput {
  private readonly tracks = new Map<Track | 'stereo', WavTrack[]>()
  private readonly resamplers = new Map<Track, Pcm16MonoResampler>()
  private readonly partNumbers = new Map<Track | 'stereo', number>()
  private readonly stereoBuffers: Record<Track, Buffer> = { microphone: Buffer.alloc(0), system: Buffer.alloc(0) }
  private inFlightBytes = 0
  private lastDiskCheckAt = 0
  private diskCheckInFlight = false
  private result?: Promise<{ audio_files: string[]; audio_save_failed?: true }>
  private failed = false
  private lowDisk = false

  private constructor(
    private readonly ownerRoot: string,
    private readonly captureSource: AudioCaptureSource,
    private readonly paths: Map<Track, string>,
    private readonly stereoPath?: string,
    private appendExisting = false,
    private readonly onLowDiskSpace?: () => void,
  ) {}

  static async prepare(
    root: string | undefined,
    owner: string,
    source: AudioCaptureSource,
    output: unknown,
    onLowDiskSpace?: () => void,
  ) {
    if (!root) throw invalidOutput('插件音频文件输出不可用。')
    const { ownerRoot, stereoPath, appendExisting, paths } = await outputPaths(root, owner, source, output)
    const instance = new AudioFileOutput(ownerRoot, source, paths, stereoPath, appendExisting, onLowDiskSpace)
    if (!(await hasEnoughDiskSpace(ownerRoot))) {
      instance.failed = true
      instance.lowDisk = true
      onLowDiskSpace?.()
    }
    instance.lastDiskCheckAt = Date.now()
    return instance
  }

  get saveFailed() { return this.failed }
  get lowDiskSpace() { return this.lowDisk }

  private checkDiskSpaceIfDue() {
    if (this.failed || this.diskCheckInFlight) return
    const now = Date.now()
    if (now - this.lastDiskCheckAt < diskCheckIntervalMs) return
    this.lastDiskCheckAt = now
    this.diskCheckInFlight = true
    void hasEnoughDiskSpace(this.ownerRoot).then((ok) => {
      if (!ok && !this.lowDisk) {
        this.failed = true
        this.lowDisk = true
        this.onLowDiskSpace?.()
      }
    }).finally(() => {
      this.diskCheckInFlight = false
    })
  }

  private ensureTrack(key: Track | 'stereo', incomingBytes: number) {
    const path = key === 'stereo' ? this.stereoPath : this.paths.get(key)
    if (!path) throw new Error('未指定音源的音频文件。')
    const channels: 1 | 2 = key === 'stereo' ? 2 : 1
    const tracks = this.tracks.get(key) ?? []
    let track = tracks.at(-1)
    if (!track || !track.hasRoom(incomingBytes)) {
      if (track) this.finishTrack(track)
      let part = this.partNumbers.get(key) ?? 0
      let nextPath: string
      do {
        part += 1
        nextPath = part === 1 ? path : path.slice(0, -4) + '-' + part + '.wav'
      } while (part > 1 && [...this.paths.values()].some((reserved) => reserved.toLowerCase() === nextPath.toLowerCase()))
      this.partNumbers.set(key, part)
      const useAppend = key === 'stereo' && part === 1 && this.appendExisting
      this.appendExisting = false
      track = new WavTrack(nextPath, channels, useAppend)
      tracks.push(track)
      this.tracks.set(key, tracks)
    }
    return track
  }

  private writeToTrack(key: Track | 'stereo', data: Buffer) {
    if (!data.length || this.failed) return
    if (this.inFlightBytes + data.length > maxInFlightBytes) {
      this.failed = true
      return
    }
    const track = this.ensureTrack(key, data.length)
    this.inFlightBytes += data.length
    track.append(data, (error) => {
      this.inFlightBytes -= data.length
      if (error) this.failed = true
    })
  }

  private drainStereo(flushAll: boolean) {
    const take = (track: Track, samples: number) => {
      const byteCount = Math.min(this.stereoBuffers[track].length, samples * 2)
      const chunk = this.stereoBuffers[track].subarray(0, byteCount)
      this.stereoBuffers[track] = this.stereoBuffers[track].subarray(byteCount)
      return chunk
    }
    if (this.captureSource !== 'mixed') {
      const active = this.captureSource
      const frames = Math.floor(this.stereoBuffers[active].length / 2)
      if (!frames) return
      const data = take(active, frames)
      const empty = Buffer.alloc(0)
      this.writeToTrack('stereo', interleaveStereoPcm16(
        active === 'microphone' ? data : empty,
        active === 'system' ? data : empty,
        frames,
      ))
      return
    }
    const micFrames = Math.floor(this.stereoBuffers.microphone.length / 2)
    const sysFrames = Math.floor(this.stereoBuffers.system.length / 2)
    const paired = Math.min(micFrames, sysFrames)
    if (paired > 0) {
      this.writeToTrack('stereo', interleaveStereoPcm16(take('microphone', paired), take('system', paired), paired))
    }
    const remMic = Math.floor(this.stereoBuffers.microphone.length / 2)
    const remSys = Math.floor(this.stereoBuffers.system.length / 2)
    if (flushAll) {
      const tail = Math.max(remMic, remSys)
      if (tail > 0) {
        this.writeToTrack('stereo', interleaveStereoPcm16(take('microphone', tail), take('system', tail), tail))
      }
      return
    }
    if (remMic > stereoLeadSamples) {
      const excess = remMic - stereoLeadSamples
      this.writeToTrack('stereo', interleaveStereoPcm16(take('microphone', excess), Buffer.alloc(0), excess))
    } else if (remSys > stereoLeadSamples) {
      const excess = remSys - stereoLeadSamples
      this.writeToTrack('stereo', interleaveStereoPcm16(Buffer.alloc(0), take('system', excess), excess))
    }
  }

  append(source: Track, format: AudioStreamFormat, pcm: Buffer) {
    if (this.result || this.failed) return
    this.checkDiskSpaceIfDue()
    try {
      let resampler = this.resamplers.get(source)
      if (!resampler) {
        resampler = new Pcm16MonoResampler()
        this.resamplers.set(source, resampler)
      }
      const data = resampler.push(pcm, format)
      if (!data.length) return
      if (this.stereoPath) {
        this.stereoBuffers[source] = this.stereoBuffers[source].length
          ? Buffer.concat([this.stereoBuffers[source], data])
          : data
        this.drainStereo(false)
        return
      }
      this.writeToTrack(source, data)
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
    if (!this.failed) {
      for (const [source, resampler] of this.resamplers) {
        try {
          const tail = resampler.finish()
          if (tail.length) {
            if (this.stereoPath) {
              this.stereoBuffers[source] = this.stereoBuffers[source].length
                ? Buffer.concat([this.stereoBuffers[source], tail])
                : tail
            } else {
              this.writeToTrack(source, tail)
            }
          }
        } catch {
          this.failed = true
        }
      }
      if (this.stereoPath && !this.failed) {
        try { this.drainStereo(true) } catch { this.failed = true }
      }
    }
    const tracks = [...this.tracks.values()].flat()
    const saved = await Promise.all(tracks.map((track) => this.finishTrack(track)))
    return {
      audio_files: tracks.filter((_track, index) => saved[index]).map((track) => track.path),
      ...(this.failed ? { audio_save_failed: true as const } : {}),
    }
  }
}
