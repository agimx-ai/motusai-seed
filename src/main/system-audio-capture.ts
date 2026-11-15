import type { AudioStreamFormat } from '@motus-ai/seed-sdk'

export type SystemAudioMetadata = {
  sampleRate: number; channelsPerFrame: number; bitsPerChannel: number; isFloat: boolean; encoding: string
}
export interface SystemAudioRecorder {
  on(event: 'data', listener: (chunk: { data: Buffer }) => void): this
  on(event: 'metadata', listener: (metadata: SystemAudioMetadata) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'stop', listener: () => void): this
  removeAllListeners(): this
  start(): Promise<void>
  stop(): Promise<void>
}

export type SystemAudioRecorderFactory = (nativeFormat?: boolean) => Promise<SystemAudioRecorder>

function cancelled() { return Object.assign(new Error('系统音频采集已取消。'), { code: 'audio_capture_cancelled' }) }

const defaultFactory: SystemAudioRecorderFactory = async (nativeFormat) => {
  if (process.platform === 'darwin') {
    const [major, minor] = process.getSystemVersion().split('.').map(Number)
    if (major! < 14 || (major === 14 && minor! < 2)) {
      throw Object.assign(new Error('系统音频采集需要 macOS 14.2 或更高版本。'), { code: 'audio_source_unsupported' })
    }
  }
  const { createSystemAudioRecorder } = await import('./system-audio-backends.js')
  return createSystemAudioRecorder(nativeFormat)
}

/** Core Audio Tap / WASAPI only. No screen, browser display media or video track. */
export class SystemAudioCapture {
  private recorder: SystemAudioRecorder | null = null
  private stopped = false
  private stopTask: Promise<void> | null = null
  private rejectReady: ((error: Error) => void) | null = null

  constructor(
    private readonly data: (pcm: Buffer, format?: AudioStreamFormat) => void,
    private readonly failed: (error: Error) => void,
    private readonly factory: SystemAudioRecorderFactory = defaultFactory,
    private readonly nativeFormat = false,
  ) {}

  async start() {
    const recorder = await (this.nativeFormat ? this.factory(true) : this.factory())
    if (this.stopped) {
      await recorder.stop()
      throw cancelled()
    }
    this.recorder = recorder
    let format: AudioStreamFormat | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let resolveReady!: () => void
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      this.rejectReady = reject
      timer = setTimeout(() => reject(new Error('未收到系统音频，请检查系统音频录制权限及输出设备。')), 15_000)
    })
    // Attach a rejection handler before native start, which can fail synchronously.
    void ready.catch(() => undefined)
    const fail = (error: Error) => {
      if (this.stopped) return
      this.rejectReady?.(error)
      void this.stop().catch(() => undefined)
      this.failed(error)
    }
    recorder.on('metadata', (metadata) => {
      const valid = this.nativeFormat
        ? Number.isSafeInteger(metadata.sampleRate) && metadata.sampleRate > 0
          && Number.isSafeInteger(metadata.channelsPerFrame) && metadata.channelsPerFrame > 0
          && [8, 16, 24, 32, 64].includes(metadata.bitsPerChannel) && typeof metadata.encoding === 'string'
        : metadata.sampleRate === 16_000 && metadata.channelsPerFrame === 1
          && metadata.bitsPerChannel === 16 && !metadata.isFloat && metadata.encoding === 'pcm_s16le'
      if (!valid) {
        fail(new Error(this.nativeFormat
          ? '系统音频采集返回了无效的格式。'
          : '系统音频格式不符合 PCM16 单声道 16 kHz 采集协议。'))
        return
      }
      format = {
        encoding: metadata.encoding, sample_rate: metadata.sampleRate, channels: metadata.channelsPerFrame,
        bits_per_sample: metadata.bitsPerChannel, layout: 'interleaved',
      }
      if (this.nativeFormat) resolveReady()
    })
    recorder.on('data', ({ data }) => {
      if (this.stopped) return
      if (!format || !Buffer.isBuffer(data) || !data.length ||
        data.length % (format.channels * format.bits_per_sample / 8) || data.length > 64_000) {
        fail(new Error('系统音频返回了无效的 PCM 数据。'))
        return
      }
      resolveReady()
      if (this.nativeFormat) this.data(data, format)
      else this.data(data)
    })
    recorder.on('error', fail)
    recorder.on('stop', () => fail(new Error('系统音频来源已断开。')))
    try {
      await recorder.start()
      await ready
    } catch (error) {
      await this.stop()
      throw error
    } finally {
      if (timer) clearTimeout(timer)
      this.rejectReady = null
    }
  }

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask
    this.stopped = true
    this.rejectReady?.(cancelled())
    const recorder = this.recorder
    this.recorder = null
    this.stopTask = (async () => {
      try { await recorder?.stop() } finally { recorder?.removeAllListeners() }
    })()
    return this.stopTask
  }
}
