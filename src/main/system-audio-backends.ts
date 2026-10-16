import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { SystemAudioRecorder } from './system-audio-capture'

const load = createRequire(__filename)

/** AudioTee's verified universal binary targets macOS 14.2, unlike the N-API Mac prebuilds. */
export class MacSystemAudioRecorder extends EventEmitter implements SystemAudioRecorder {
  private child: ChildProcessWithoutNullStreams | null = null
  private stderr = ''
  private pcm: Buffer = Buffer.alloc(0)
  private hasMetadata = false
  private stopTask: Promise<void> | null = null

  constructor(private readonly binaryPath: string, private readonly launch: typeof spawn = spawn) { super() }

  async start() {
    const child = this.launch(this.binaryPath, ['--sample-rate', '16000', '--chunk-duration', '0.02'], { shell: false, stdio: 'pipe' }) as ChildProcessWithoutNullStreams
    this.child = child
    child.stdout.on('data', (data: Buffer) => {
      if (this.stopTask) return
      this.pcm = Buffer.concat([this.pcm, data])
      if (this.pcm.length > 128_000) { this.emit('error', new Error('系统音频缓冲超限。')); return }
      this.flushPcm()
    })
    child.stderr.on('data', (data: Buffer) => {
      if (this.stopTask) return
      this.stderr += data.toString('utf8')
      if (this.stderr.length > 32_000) { this.stderr = ''; this.emit('error', new Error('系统音频状态数据超限。')); return }
      let newline: number
      while ((newline = this.stderr.indexOf('\n')) !== -1) {
        const line = this.stderr.slice(0, newline)
        this.stderr = this.stderr.slice(newline + 1)
        this.readMessage(line)
      }
    })
    child.on('error', (error) => this.emit('error', error))
    child.on('close', (code) => {
      if (this.stderr.trim()) this.readMessage(this.stderr)
      this.stderr = ''
      this.child = null
      if (!this.stopTask && code !== 0) this.emit('error', new Error(`系统音频采集进程已退出：${code}`))
      this.emit('stop')
    })
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
  }

  private readMessage(line: string) {
    let message: { message_type?: string; data?: Record<string, unknown> }
    try { message = JSON.parse(line) as typeof message } catch { return }
    if (!message || typeof message !== 'object') return
    const data = message.data && typeof message.data === 'object' ? message.data : {}
    if (message.message_type === 'metadata') {
      this.hasMetadata = true
      this.emit('metadata', {
        sampleRate: data.sample_rate, channelsPerFrame: data.channels_per_frame,
        bitsPerChannel: data.bits_per_channel, isFloat: data.is_float, encoding: data.encoding,
      })
      this.flushPcm()
    } else if (message.message_type === 'error') {
      this.emit('error', new Error(String(data.message || '系统音频采集失败。').slice(0, 1000)))
    }
  }

  private flushPcm() {
    if (!this.hasMetadata) return
    while (this.pcm.length >= 2) {
      const length = Math.min(this.pcm.length - this.pcm.length % 2, 32_000)
      const data = this.pcm.subarray(0, length)
      this.pcm = this.pcm.subarray(length)
      this.emit('data', { data })
    }
  }

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask
    const child = this.child
    this.stopTask = !child ? Promise.resolve() : new Promise<void>((resolve) => {
      const timeout = setTimeout(() => child.kill('SIGKILL'), 3_000)
      child.once('close', () => { clearTimeout(timeout); this.pcm = Buffer.alloc(0); resolve() })
      child.kill('SIGTERM')
    })
    return this.stopTask
  }
}

type NativeEvent = { type: number; data?: Buffer; message?: string; sampleRate?: number; channelsPerFrame?: number; bitsPerChannel?: number; isFloat?: boolean; encoding?: string }
export interface WasapiRecorder {
  startSystemAudio(options: Record<string, unknown>): void
  processEvents(): NativeEvent[]
  stop(): void
}

export class WindowsSystemAudioRecorder extends EventEmitter implements SystemAudioRecorder {
  private timer: ReturnType<typeof setInterval> | null = null
  private active = false
  constructor(private readonly native: WasapiRecorder) { super() }
  async start() {
    this.native.startSystemAudio({ sampleRate: 16_000, chunkDurationMs: 20, stereo: false, emitSilence: true, mute: false })
    this.active = true
    this.timer = setInterval(() => this.poll(), 10)
  }
  private poll() {
    try {
      for (const event of this.native.processEvents()) {
        if (event.type === 0 && event.data) this.emit('data', { data: event.data })
        else if (event.type === 2) this.emit('stop')
        else if (event.type === 3) this.emit('error', new Error(event.message || '系统音频采集失败。'))
        else if (event.type === 4) this.emit('metadata', event)
      }
    } catch (error) { this.emit('error', error instanceof Error ? error : new Error(String(error))) }
  }
  async stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (!this.active) return
    this.active = false
    this.poll()
    this.native.stop()
  }
}

export function createSystemAudioRecorder(): SystemAudioRecorder {
  if (process.platform === 'darwin') {
    const binary = app.isPackaged ? join(process.resourcesPath, 'audio', 'audiotee')
      : join(dirname(load.resolve('audiotee')), '..', 'bin', 'audiotee')
    return new MacSystemAudioRecorder(binary)
  }
  if (process.platform === 'win32' && ['x64', 'arm64'].includes(process.arch)) {
    const binding = load(`@native-audio-node/win32-${process.arch}`) as { AudioRecorderNative: new () => WasapiRecorder }
    return new WindowsSystemAudioRecorder(new binding.AudioRecorderNative())
  }
  throw Object.assign(new Error('当前平台不支持系统音频采集。'), { code: 'audio_source_unsupported' })
}
