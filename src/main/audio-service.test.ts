import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createAudioClient, type AudioStreamFormat } from '../../packages/seed-sdk/src/audio'

const { ipcMain } = vi.hoisted(() => ({
  ipcMain: {
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain,
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
  session: {},
  systemPreferences: {},
}))

import { AudioService } from './audio-service'
import { LatestAudioRecording } from './latest-audio-recording'
import type { SystemAudioRecorderFactory } from './system-audio-capture'

type AudioServiceInternals = {
  window: { webContents: { send: ReturnType<typeof vi.fn> }; isDestroyed(): boolean }
  sessionId: string
  state: string
  pcmBytes: number
  pcmBaseOffsetBytes: number
  handleChunk(event: { sender: unknown }, sessionId: string, pcm: ArrayBuffer): void
}

describe('AudioService segmented capture', () => {
  const hostPlatform = process.platform
  const setPlatform = (platform: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value: platform })
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => setPlatform(hostPlatform))

  it('exposes only the current stop task and clears its association when capture resets', async () => {
    const status: ReturnType<AudioService['snapshot']>[] = []
    const service = new AudioService((value) => status.push(value))
    Object.assign(service, { state: 'recording', pcmBytes: 640, sessionId: 'capture', ownerPackageId: 'plugin-a' })
    const internal = service as any
    vi.spyOn(internal, 'stopInputs').mockResolvedValue(undefined)
    vi.spyOn(internal, 'captureSegment').mockResolvedValue({ audio_session_id: 'segment' })
    await service.invoke({ operation: 'capture.stop' }, 'plugin-a', 'actual-task')
    expect(status.find((value) => value.state === 'stopping')).toMatchObject({ task_id: 'actual-task' })
    expect(service.snapshot()).not.toHaveProperty('task_id')
    Object.assign(service, { state: 'recording', pcmBytes: 640, sessionId: 'other-capture', ownerPackageId: 'plugin-a' })
    status.length = 0
    await service.invoke({ operation: 'capture.stop' }, 'plugin-a')
    expect(status.find((value) => value.state === 'stopping')).not.toHaveProperty('task_id')
    await service.destroy()
  })

  it('preserves samples arriving while a durable segment is being encoded', async () => {
    const service = new AudioService()
    const internal = service as unknown as AudioServiceInternals & {
      ownerPackageId: string
      durableStore: unknown
    }
    const webContents = { send: vi.fn() }
    internal.window = { webContents, isDestroyed: () => false }
    internal.sessionId = 'encoding-race'
    internal.ownerPackageId = 'plugin-a'
    internal.state = 'recording'
    let finish!: (value: { segment_id: string }) => void
    internal.durableStore = { append: vi.fn(() => new Promise((resolve) => { finish = resolve })) }
    internal.handleChunk({ sender: webContents }, internal.sessionId, new ArrayBuffer(64_000))
    const segment = service.invoke({ operation: 'capture.segment' }, 'plugin-a')
    internal.handleChunk({ sender: webContents }, internal.sessionId, new ArrayBuffer(640))
    finish({ segment_id: 'persisted-1' })
    await segment
    expect(internal.pcmBytes).toBe(32_640)
    expect(internal.pcmBaseOffsetBytes).toBe(32_000)
  })

  it('rejects invalid audio sources before touching OS capture', async () => {
    const service = new AudioService()
    await expect(service.invoke({ operation: 'capture.start', source: 'screen' }, 'plugin-a')).rejects.toMatchObject({ code: 'audio_source_invalid' })
    expect(service.snapshot()).toMatchObject({ state: 'idle', source: 'microphone' })
    await service.destroy()
  })

  const liveFormat: AudioStreamFormat = {
    encoding: 'pcm_f32le', sample_rate: 44_100, channels: 2, bits_per_sample: 32, layout: 'planar',
  }

  function microphoneStream(factory?: SystemAudioRecorderFactory, dataRoot?: string) {
    const service = new AudioService(undefined, dataRoot, factory)
    const internal = service as unknown as AudioServiceInternals & {
      ensureMicrophonePermission(): Promise<void>
      ensureWindow(): Promise<unknown>
      handleCaptureEvent(event: { sender: unknown }, value: Record<string, unknown>): void
      handleChunk(event: { sender: unknown }, sessionId: string, pcm: ArrayBuffer, format: AudioStreamFormat): void
    }
    let tail: ArrayBuffer | undefined
    const webContents = { send: vi.fn((_channel, command: { type: string; session_id: string }) => {
      const type = { start: 'started', pause: 'paused', resume: 'resumed', stop: 'stopped' }[command.type]
      if (command.type === 'stop' && tail) push(tail)
      if (type) internal.handleCaptureEvent({ sender: webContents }, { session_id: command.session_id, type })
    }) }
    internal.window = Object.assign({ webContents, isDestroyed: () => false }, { destroy: vi.fn() })
    vi.spyOn(internal, 'ensureMicrophonePermission').mockResolvedValue()
    vi.spyOn(internal, 'ensureWindow').mockResolvedValue(internal.window)
    function push(buffer: ArrayBuffer) {
      internal.handleChunk({ sender: webContents }, internal.sessionId, buffer, liveFormat)
    }
    return { service, internal, push, tail: (buffer: ArrayBuffer) => { tail = buffer } }
  }

  it('streams beyond the segmented PCM limit and releases a waiting read on plugin unload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seed-audio-unload-'))
    await mkdir(join(root, 'plugin-a'))
    const { service, internal, push } = microphoneStream(undefined, root)
    const session_id = randomUUID()
    const next = (owner = 'plugin-a') => service.invoke({ operation: 'stream.next', session_id }, owner)
    try {
      await service.invoke({ operation: 'stream.record', session_id, output: { microphone: 'raw.wav' } }, 'plugin-a')
      await expect(next('plugin-b')).rejects.toMatchObject({ code: 'audio_session_forbidden' })
      const data = new ArrayBuffer(64 * 1024)
      for (let sequence = 0; sequence < 170; sequence++) {
        const delivery = next()
        push(data)
        expect(await delivery).toMatchObject({ done: false, chunks: [{ sequence, sample_offset: data.byteLength / 8 * sequence }] })
        await delay(1)
      }
      expect(internal.pcmBytes).toBe(0)
      const pending = next()
      await service.releasePlugin('plugin-a')
      await expect(pending).resolves.toEqual({ done: true, chunks: [] })
      await expect(next()).rejects.toMatchObject({ code: 'audio_stream_closed' })
      expect(service.snapshot().state).toBe('idle')
      const wav = await readFile(join(root, 'plugin-a', 'raw.wav'))
      expect(wav.readUInt32LE(54)).toBe(170 * data.byteLength)
    } finally {
      await service.destroy()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('records all samples during a stalled realtime read and resumes on the next new frame', async () => {
    const data = await mkdtemp(join(tmpdir(), 'seed-audio-file-'))
    const owner = join(data, 'plugin-a')
    await mkdir(owner)
    const { service, push, tail } = microphoneStream(undefined, data)
    const report = vi.fn()
    const sdk = createAudioClient((_service, args) => service.invoke(args, 'plugin-a'), new AbortController().signal, report)
    try {
      const recording = await sdk.startRecording({ output: { microphone: 'raw.wav' } })
      const expected: Buffer[] = []
      const feed = (value: number) => {
        const left = 0.25, right = value / 100
        const input = new Float32Array(16_000)
        input.fill(left, 0, 8_000).fill(right, 8_000)
        const interleaved = Buffer.alloc(input.byteLength)
        for (let offset = 0; offset < interleaved.length; offset += 8) {
          interleaved.writeFloatLE(left, offset)
          interleaved.writeFloatLE(right, offset + 4)
        }
        expected.push(interleaved)
        push(input.buffer)
      }
      const first = recording.nextFrame()
      feed(0)
      await expect(first).resolves.toMatchObject({ sequence: 0, sample_offset: 0, frames: 8_000, format: liveFormat })
      await recording.pause()
      push(Float32Array.of(0.9, 0.9).buffer)
      await recording.resume()

      // Write a large span of audio without any realtime read pending.
      for (let index = 1; index <= 40; index++) {
        feed(index)
        await delay(1)
      }
      expect(service.snapshot()).toMatchObject({ state: 'recording' })
      const skip = new AbortController()
      const cancelled = recording.nextFrame(skip.signal)
      const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
      skip.abort()
      await rejected
      feed(41)

      let delivered = false
      const fresh = recording.nextFrame().then((frame) => { delivered = true; return frame })
      await delay(10)
      expect(delivered).toBe(false)
      feed(42)
      const frame = await fresh
      expect(frame).toMatchObject({ sequence: 42, sample_offset: 42 * 8_000 })
      expect(Buffer.from(frame!.data).readFloatLE(32_000)).toBe(Math.fround(0.42))
      const pending = recording.nextFrame()
      tail(Float32Array.of(0.5, -0.5).buffer)
      const stopped = await recording.stop()
      expect((await pending)?.sequence).toBe(43)
      expect(stopped).toMatchObject({ audio_files: [await realpath(join(owner, 'raw.wav'))] })
      expect(stopped.audio_save_failed).toBeUndefined()
      const wav = await readFile(stopped.audio_files[0]!)
      const last = Buffer.alloc(8)
      last.writeFloatLE(0.5)
      last.writeFloatLE(-0.5, 4)
      expect(wav.readUInt32LE(24)).toBe(44_100)
      expect(wav.readUInt16LE(22)).toBe(2)
      expect(wav.readUInt32LE(54)).toBe(wav.length - 58)
      expect(wav.subarray(58).equals(Buffer.concat([...expected, last]))).toBe(true)
      expect(report).not.toHaveBeenCalled()
    } finally {
      await service.destroy()
      await rm(data, { recursive: true, force: true })
    }
  })

  it('keeps the realtime stream independent of an output failure and confines file targets to the plugin', async () => {
    const data = await mkdtemp(join(tmpdir(), 'seed-audio-targets-'))
    const owner = join(data, 'plugin-a')
    await mkdir(owner)
    await symlink(data, join(owner, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
    const { service, push } = microphoneStream(undefined, data)
    const sdk = createAudioClient((_service, args) => service.invoke(args, 'plugin-a'), new AbortController().signal, vi.fn())
    try {
      await expect(sdk.startRecording({ output: { microphone: 'outside/raw.wav' } })).rejects.toMatchObject({ code: 'audio_output_invalid' })
      await expect(sdk.startRecording({ output: { microphone: '../raw.wav' } })).rejects.toMatchObject({ code: 'audio_output_invalid' })
      const recording = await sdk.startRecording({ output: { microphone: 'raw.wav' } })
      const path = join(owner, 'raw.wav')
      await writeFile(path, 'existing file')
      const frame = recording.nextFrame()
      push(Float32Array.of(0.25, 0.5).buffer)
      await expect(frame).resolves.toMatchObject({ sequence: 0 })
      expect(service.snapshot()).toMatchObject({ state: 'recording', audio_save_failed: true })
      expect(await recording.stop()).toMatchObject({ audio_files: [], audio_save_failed: true })
      expect(await readFile(path, 'utf8')).toBe('existing file')
    } finally {
      await service.destroy()
      await rm(data, { recursive: true, force: true })
    }
  })

  it('retains both source tracks and starts a new WAV on a native format change', async () => {
    setPlatform('darwin')
    const data = await mkdtemp(join(tmpdir(), 'seed-audio-tracks-'))
    await mkdir(join(data, 'plugin-a'))
    const format = { sampleRate: 48_000, channelsPerFrame: 1, bitsPerChannel: 16, encoding: 'pcm_s16le', isFloat: false }
    const recorder = Object.assign(new EventEmitter(), {
      start: async () => { recorder.emit('metadata', format) },
      stop: async () => undefined,
    })
    const factory = vi.fn(async () => recorder)
    const { service, push } = microphoneStream(factory, data)
    const sdk = createAudioClient((_service, args) => service.invoke(args, 'plugin-a'), new AbortController().signal, vi.fn())
    try {
      const recording = await sdk.startRecording({
        source: 'mixed', output: { microphone: 'original-2.wav', system: 'original.wav' },
      })
      expect(factory).toHaveBeenCalledExactlyOnceWith(true)
      const system = recording.nextFrame()
      recorder.emit('data', { data: Buffer.from([1, 2]) })
      await expect(system).resolves.toMatchObject({
        source: 'system', sequence: 0, sample_offset: 0, frames: 1,
        format: { sample_rate: 48_000, channels: 1 }, data: Uint8Array.of(1, 2),
      })
      recorder.emit('metadata', { ...format, sampleRate: 44_100 })
      recorder.emit('data', { data: Buffer.from([3, 4]) })
      const microphone = recording.nextFrame()
      push(Float32Array.of(0.25, 0.5).buffer)
      await expect(microphone).resolves.toMatchObject({
        source: 'microphone', sequence: 2, sample_offset: 0, frames: 1, format: liveFormat,
        data: new Uint8Array(Float32Array.of(0.25, 0.5).buffer),
      })
      const result = await recording.stop()
      const root = await realpath(join(data, 'plugin-a'))
      expect(result.audio_files).toEqual(['original.wav', 'original-3.wav', 'original-2.wav'].map((name) => join(root, name)))
      expect(result.audio_save_failed).toBeUndefined()
      const [first, second, mic] = await Promise.all(result.audio_files.map((path) => readFile(path)))
      expect(first!.readUInt32LE(24)).toBe(48_000)
      expect(first!.subarray(44)).toEqual(Buffer.from([1, 2]))
      expect(second!.readUInt32LE(24)).toBe(44_100)
      expect(second!.subarray(44)).toEqual(Buffer.from([3, 4]))
      expect(mic!.subarray(58)).toEqual(Buffer.from(Float32Array.of(0.25, 0.5).buffer))
    } finally {
      await service.destroy()
      await rm(data, { recursive: true, force: true })
    }
  })

  it('cancels an SDK recording during device permission and discards late startup', async () => {
    const data = await mkdtemp(join(tmpdir(), 'seed-audio-permission-'))
    await mkdir(join(data, 'plugin-a'))
    const { service, internal } = microphoneStream(undefined, data)
    let allow!: () => void
    const permission = vi.mocked(internal.ensureMicrophonePermission)
    permission.mockImplementation(() => new Promise<void>((resolve) => { allow = resolve }))
    const signal = new AbortController()
    const audio = createAudioClient((_service, args) => service.invoke(args, 'plugin-a'), signal.signal, vi.fn())
    try {
      const started = audio.startRecording({ output: { microphone: 'raw.wav' } })
      const failed = expect(started).rejects.toThrow()
      await vi.waitFor(() => expect(permission).toHaveBeenCalledOnce())
      signal.abort()
      await vi.waitFor(() => expect(service.snapshot().state).toBe('idle'))
      allow()
      await failed
      expect(internal.window.webContents.send).not.toHaveBeenCalledWith('seed-audio:command', expect.objectContaining({ type: 'start' }))
    } finally {
      await service.destroy()
      await rm(data, { recursive: true, force: true })
    }
  })

  it.each(['system', 'mixed'])('rejects %s capture on Linux without opening capture devices', async (source) => {
    setPlatform('linux')
    const factory = vi.fn()
    const service = new AudioService(undefined, undefined, factory)
    const internal = service as unknown as { ensureWindow(): Promise<unknown>; ensureMicrophonePermission(): Promise<void> }
    const window = vi.spyOn(internal, 'ensureWindow')
    const microphone = vi.spyOn(internal, 'ensureMicrophonePermission')
    await expect(service.invoke({ operation: 'capture.start', source }, 'plugin-a')).rejects.toMatchObject({ code: 'audio_source_unsupported' })
    expect(factory).not.toHaveBeenCalled()
    expect(window).not.toHaveBeenCalled()
    expect(microphone).not.toHaveBeenCalled()
    expect(service.snapshot()).toMatchObject({ state: 'idle', source: 'microphone' })
    await service.destroy()
  })

  it('observes both inputs and the single mixed output without changing segmented PCM', async () => {
    const service = new AudioService()
    const append = vi.fn()
    const internal = service as unknown as AudioServiceInternals & { acceptPcm(source: string, pcm: Buffer): void }
    const webContents = { send: vi.fn() }
    Object.assign(service, {
      window: { webContents, isDestroyed: () => false }, sessionId: 'local-recording', ownerPackageId: 'plugin-a', source: 'mixed', state: 'recording',
      localRecording: { append, finish: vi.fn(async () => '/local/recordings') },
    })
    const mic = new Int16Array(320).fill(1_000).buffer
    const sys = Buffer.from(new Int16Array(320).fill(2_000).buffer)
    internal.handleChunk({ sender: webContents }, 'local-recording', mic)
    internal.acceptPcm('system', sys)
    expect(append.mock.calls.map(([name]) => name)).toEqual(['microphone', 'system', 'output'])
    const segment = await service.invoke({ operation: 'capture.segment' }, 'plugin-a') as { audio_session_id: string }
    const pcm = service.consume(segment.audio_session_id, 'plugin-a').pcm
    expect(pcm.length).toBe(640)
    for (let offset = 0; offset < pcm.length; offset += 2) expect(pcm.readInt16LE(offset)).toBe(1_500)
    Object.assign(service, { window: null, sessionId: '', ownerPackageId: '', state: 'idle' })
    await service.destroy()
  })

  it('does not fail capture if local recording setup or final saving fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const setup = vi.spyOn(LatestAudioRecording, 'start').mockRejectedValue(new Error('recording disk unavailable'))
    const service = new AudioService(undefined, undefined, undefined, '/local/recordings')
    const internal = service as unknown as AudioServiceInternals & {
      ensureMicrophonePermission(): Promise<void>; ensureWindow(): Promise<unknown>
      handleCaptureEvent(event: { sender: unknown }, value: Record<string, unknown>): void
    }
    const webContents = { send: vi.fn((_channel, command) => {
      internal.handleCaptureEvent({ sender: webContents }, { session_id: command.session_id, type: command.type === 'start' ? 'started' : 'stopped' })
    }) }
    internal.window = { webContents, isDestroyed: () => false }
    vi.spyOn(internal, 'ensureMicrophonePermission').mockResolvedValue()
    vi.spyOn(internal, 'ensureWindow').mockResolvedValue(internal.window)
    try {
      expect(await service.invoke({ operation: 'capture.start', session_id: 'recording-failure' })).toMatchObject({ state: 'recording' })
      const recording = { append: vi.fn(), finish: vi.fn(async () => { throw new Error('disk full') }) }
      Object.assign(service, { localRecording: recording })
      internal.handleChunk({ sender: webContents }, 'recording-failure', new Int16Array(320).fill(123).buffer)
      const result = await service.invoke({ operation: 'capture.stop' }) as { audio_session_id: string }
      expect(service.consume(result.audio_session_id).pcm.readInt16LE(0)).toBe(123)
      expect(service.snapshot().state).toBe('idle')
      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      Object.assign(internal, { window: null })
      await service.destroy()
      setup.mockRestore()
      warn.mockRestore()
    }
  })

  it('automatically saves every capture and waits for the old files to close before opening new recording files', async () => {
    const service = new AudioService(undefined, undefined, undefined, '/local/recordings')
    let finishFirst!: () => void
    const first = { append: vi.fn(), finish: vi.fn(() => new Promise<string>((resolve) => { finishFirst = () => resolve('/local/recordings/latest') })) }
    const second = { append: vi.fn(), finish: vi.fn(async () => '/local/recordings/latest') }
    const setup = vi.spyOn(LatestAudioRecording, 'start')
      .mockResolvedValueOnce(first as unknown as LatestAudioRecording)
      .mockResolvedValueOnce(second as unknown as LatestAudioRecording)
    const internal = service as unknown as AudioServiceInternals & {
      ensureMicrophonePermission(): Promise<void>; ensureWindow(): Promise<unknown>
      handleCaptureEvent(event: { sender: unknown }, value: Record<string, unknown>): void
      fail(message: string): void
    }
    const webContents = { send: vi.fn((_channel, command) => {
      internal.handleCaptureEvent({ sender: webContents }, { session_id: command.session_id, type: command.type === 'start' ? 'started' : 'stopped' })
    }) }
    internal.window = { webContents, isDestroyed: () => false }
    vi.spyOn(internal, 'ensureMicrophonePermission').mockResolvedValue()
    vi.spyOn(internal, 'ensureWindow').mockResolvedValue(internal.window)
    try {
      await service.invoke({ operation: 'capture.start', session_id: 'first' })
      expect(setup).toHaveBeenCalledExactlyOnceWith('/local/recordings', 'microphone')
      internal.fail('capture failed')
      const starting = service.invoke({ operation: 'capture.start', session_id: 'second' })
      await Promise.resolve()
      expect(setup).toHaveBeenCalledTimes(1)
      finishFirst()
      expect(await starting).toMatchObject({ state: 'recording', session_id: 'second' })
      expect(setup).toHaveBeenCalledTimes(2)
      internal.handleChunk({ sender: webContents }, 'second', new Int16Array(320).fill(123).buffer)
      await service.invoke({ operation: 'capture.stop' })
      expect(second.append.mock.calls.map(([name]) => name)).toEqual(['microphone', 'output'])
      expect(second.finish).toHaveBeenCalledOnce()
    } finally {
      Object.assign(internal, { window: null })
      await service.destroy()
      setup.mockRestore()
    }
  })

  it('closes recording files cancelled during setup before allowing another recording to reuse the destination', async () => {
    const service = new AudioService(undefined, undefined, undefined, '/local/recordings')
    const recording = { append: vi.fn(), finish: vi.fn(async () => '/local/recordings/latest') }
    let ready!: (recording: LatestAudioRecording) => void
    const setup = vi.spyOn(LatestAudioRecording, 'start').mockImplementationOnce(() => new Promise((resolve) => { ready = resolve }))
    const internal = service as unknown as AudioServiceInternals & {
      ensureMicrophonePermission(): Promise<void>; ensureWindow(): Promise<unknown>
      handleCaptureEvent(event: { sender: unknown }, value: Record<string, unknown>): void
    }
    const webContents = { send: vi.fn((_channel, command) => {
      internal.handleCaptureEvent({ sender: webContents }, { session_id: command.session_id, type: command.type === 'start' ? 'started' : 'stopped' })
    }) }
    internal.window = { webContents, isDestroyed: () => false }
    vi.spyOn(internal, 'ensureMicrophonePermission').mockResolvedValue()
    vi.spyOn(internal, 'ensureWindow').mockResolvedValue(internal.window)
    try {
      const starting = service.invoke({ operation: 'capture.start', session_id: 'cancel-during-setup' })
      const rejected = expect(starting).rejects.toMatchObject({ code: 'audio_capture_cancelled' })
      await vi.waitFor(() => expect(ready).toBeTypeOf('function'))
      const cancelled = service.invoke({ operation: 'capture.cancel' })
      ready(recording as unknown as LatestAudioRecording)
      await rejected
      expect(await cancelled).toMatchObject({ state: 'cancelled' })
      expect(recording.finish).toHaveBeenCalledOnce()
      expect(service.snapshot().state).toBe('idle')
    } finally {
      Object.assign(internal, { window: null })
      await service.destroy()
      setup.mockRestore()
    }
  })

  it('cancels an in-flight start without letting a late permission result replace a new capture', async () => {
    const service = new AudioService()
    const internal = service as unknown as { ensureMicrophonePermission(): Promise<void>; ensureWindow(): Promise<unknown>; reset(): void; source: string; state: string }
    let grant!: () => void
    vi.spyOn(internal, 'ensureMicrophonePermission').mockImplementation(() => new Promise<void>((done) => { grant = done }))
    const window = vi.spyOn(internal, 'ensureWindow')
    const oldStart = service.invoke({ operation: 'capture.start', session_id: 'old' }, 'plugin-a')
    const rejected = expect(oldStart).rejects.toMatchObject({ code: 'audio_capture_cancelled' })
    await vi.waitFor(() => expect(grant).toBeTypeOf('function'))
    internal.reset()
    Object.assign(internal, { source: 'system', state: 'recording' })
    grant()
    await rejected
    expect(window).not.toHaveBeenCalled()
    expect(service.snapshot()).toMatchObject({ state: 'recording', source: 'system' })
    internal.reset()
    await service.destroy()
  })

  it.each(['microphone', 'system', 'mixed'] as const)('forwards %s and preserves segmented PCM, pause/resume and cleanup', async (source) => {
    if (source !== 'microphone') setPlatform('darwin')
    const recorder = Object.assign(new EventEmitter(), {
      start: vi.fn(async () => {
        recorder.emit('metadata', { sampleRate: 16_000, channelsPerFrame: 1, bitsPerChannel: 16, isFloat: false, encoding: 'pcm_s16le' })
        recorder.emit('data', { data: Buffer.alloc(640) })
      }), stop: vi.fn(async () => undefined),
    })
    const factory = vi.fn(async () => recorder)
    const service = new AudioService(undefined, undefined, factory)
    const internal = service as unknown as {
      ensureMicrophonePermission(): Promise<void>
      ensureWindow(): Promise<unknown>
      window: unknown
      state: string
      handleCaptureEvent(event: { sender: unknown }, value: Record<string, unknown>): void
      handleChunk(event: { sender: unknown }, sessionId: string, pcm: ArrayBuffer): void
    }
    const webContents = {
      send: vi.fn((_channel: string, command: { type: string; session_id: string }) => {
        const type = { start: 'started', pause: 'paused', resume: 'resumed', stop: 'stopped' }[command.type]
        if (type) internal.handleCaptureEvent({ sender: webContents }, { type, session_id: command.session_id })
      }),
    }
    internal.window = { webContents, isDestroyed: () => false, destroy: vi.fn() }
    const permission = vi.spyOn(internal, 'ensureMicrophonePermission').mockResolvedValue()
    const window = vi.spyOn(internal, 'ensureWindow').mockResolvedValue(internal.window)
    expect(await service.invoke({ operation: 'capture.start', source, session_id: 'capture-1' }, 'plugin-a')).toMatchObject({ source, state: 'recording' })
    expect(permission).toHaveBeenCalledTimes(source === 'system' ? 0 : 1)
    expect(window).toHaveBeenCalledTimes(source === 'system' ? 0 : 1)
    expect(factory).toHaveBeenCalledTimes(source === 'microphone' ? 0 : 1)
    await expect(service.invoke({ operation: 'capture.segment' }, 'plugin-b')).rejects.toMatchObject({ code: 'audio_session_forbidden' })
    await service.invoke({ operation: 'capture.pause' }, 'plugin-a')
    expect(service.snapshot()).toMatchObject({ state: 'paused', source })
    await service.invoke({ operation: 'capture.resume' }, 'plugin-a')
    const pcm = new Int16Array(16_000).fill(1_000).buffer
    const systemPcm = Buffer.from(new Int16Array(16_000).fill(2_000).buffer)
    internal.handleChunk({ sender: webContents }, 'capture-1', pcm)
    if (source !== 'microphone') recorder.emit('data', { data: systemPcm })
    const result = await service.invoke({ operation: 'capture.stop' }, 'plugin-a') as { audio_session_id: string }
    const captured = service.consume(result.audio_session_id, 'plugin-a').pcm
    expect(captured.byteLength).toBe(pcm.byteLength)
    const expected = source === 'mixed' ? 1_500 : source === 'system' ? 2_000 : 1_000
    for (let offset = 0; offset < captured.length; offset += 2) expect(captured.readInt16LE(offset)).toBe(expected)
    expect(service.snapshot()).toMatchObject({ state: 'idle' })
    await service.destroy()
    expect(recorder.stop).toHaveBeenCalledTimes(source === 'microphone' ? 0 : 1)
  })

  it('does not let another plugin reuse an active capture ID or silently change its source', async () => {
    setPlatform('darwin')
    const service = new AudioService()
    Object.assign(service, { sessionId: 'active', ownerPackageId: 'plugin-a', source: 'mixed', state: 'recording' })
    await expect(service.invoke({ operation: 'capture.start', session_id: 'active', source: 'mixed' }, 'plugin-b')).rejects.toMatchObject({ code: 'audio_session_busy' })
    await expect(service.invoke({ operation: 'capture.start', session_id: 'active', source: 'microphone' }, 'plugin-a')).rejects.toMatchObject({ code: 'audio_session_busy' })
    expect(await service.invoke({ operation: 'capture.start', session_id: 'active', source: 'mixed' }, 'plugin-a')).toMatchObject({ source: 'mixed' })
    Object.assign(service, { state: 'idle', sessionId: '' })
    await service.destroy()
  })

  it('reports native initialization failure without opening a microphone or a display picker', async () => {
    setPlatform('darwin')
    const service = new AudioService(undefined, undefined, async () => { throw new Error('System audio permission denied') })
    const internal = service as unknown as { ensureWindow(): Promise<unknown>; ensureMicrophonePermission(): Promise<void> }
    const window = vi.spyOn(internal, 'ensureWindow')
    const microphone = vi.spyOn(internal, 'ensureMicrophonePermission')
    await expect(service.invoke({ operation: 'capture.start', source: 'system' }, 'plugin-a')).rejects.toMatchObject({ code: 'audio_capture_failed' })
    expect(window).not.toHaveBeenCalled()
    expect(microphone).not.toHaveBeenCalled()
    await service.destroy()
  })

  it('cancels pending native initialization without letting a late recorder replace a new session', async () => {
    setPlatform('darwin')
    const recorder = Object.assign(new EventEmitter(), { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) })
    let resolve!: (value: typeof recorder) => void
    const service = new AudioService(undefined, undefined, () => new Promise((done) => { resolve = done }))
    const start = service.invoke({ operation: 'capture.start', source: 'system' }, 'plugin-a')
    const rejected = expect(start).rejects.toMatchObject({ code: 'audio_capture_cancelled' })
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    await service.invoke({ operation: 'capture.cancel' }, 'plugin-a')
    Object.assign(service, { source: 'microphone', state: 'recording' })
    resolve(recorder)
    await rejected
    expect(recorder.start).not.toHaveBeenCalled()
    expect(recorder.stop).toHaveBeenCalledOnce()
    expect(service.snapshot()).toMatchObject({ state: 'recording', source: 'microphone' })
    Object.assign(service, { state: 'idle' })
    await service.destroy()
  })

  it('keeps the PCM buffer bounded while preserving the global timeline', async () => {
    const service = new AudioService()
    const internal = service as unknown as AudioServiceInternals
    const webContents = { send: vi.fn() }
    internal.window = { webContents, isDestroyed: () => false }
    internal.sessionId = 'recording-1'
    internal.state = 'recording'

    const eightSeconds = Buffer.alloc(16_000 * 2 * 8)
    let previousEndMs = 0
    for (let index = 0; index < 48; index += 1) {
      internal.handleChunk({ sender: webContents }, internal.sessionId, eightSeconds.buffer)
      const segment = await service.invoke({ operation: 'capture.segment' }) as {
        audio_session_id: string
        start_ms: number
        end_ms: number
      }
      expect(segment.start_ms).toBe(index === 0 ? 0 : previousEndMs - 1_000)
      expect(segment.end_ms).toBe((index + 1) * 8_000)
      expect(internal.pcmBytes).toBe(16_000 * 2)
      service.consume(segment.audio_session_id)
      previousEndMs = segment.end_ms
    }

    expect(internal.pcmBaseOffsetBytes).toBe(16_000 * 2 * (48 * 8 - 1))
    expect(webContents.send).not.toHaveBeenCalledWith('seed-audio:command', expect.objectContaining({ type: 'stop' }))
  })
})

describe('AudioService system sleep lifecycle', () => {
  async function setup(source: 'microphone' | 'system' | 'mixed' = 'mixed') {
    const recorders: Array<EventEmitter & { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = []
    const factory = vi.fn(async () => {
      const recorder = Object.assign(new EventEmitter(), {
        start: vi.fn(async () => {
          recorder.emit('metadata', { sampleRate: 16_000, channelsPerFrame: 1, bitsPerChannel: 16, isFloat: false, encoding: 'pcm_s16le' })
          recorder.emit('data', { data: Buffer.alloc(640) })
        }), stop: vi.fn(async () => undefined),
      })
      recorders.push(recorder)
      return recorder
    })
    const service = new AudioService(undefined, undefined, factory)
    const internal = service as any
    const webContents = { send: vi.fn((_channel, command) => {
      const type = { start: 'started', stop: 'stopped', pause: 'paused', resume: 'resumed' }[command.type as string]
      internal.handleCaptureEvent({ sender: webContents }, { type, session_id: command.session_id })
    }) }
    internal.window = { webContents, isDestroyed: () => false, destroy: vi.fn() }
    vi.spyOn(internal, 'ensureWindow').mockResolvedValue(internal.window)
    vi.spyOn(internal, 'ensureMicrophonePermission').mockResolvedValue()
    await service.invoke({ operation: 'capture.start', source, session_id: 'sleep-session' }, 'sleep-plugin')
    const frame = Buffer.alloc(640, 1)
    const feed = () => {
      if (source !== 'system') internal.handleChunk({ sender: webContents }, internal.inputSessionId, frame.buffer)
      if (source !== 'microphone') recorders.at(-1)!.emit('data', { data: frame })
    }
    return { service, internal, webContents, recorders, factory, feed }
  }

  it.each(['microphone', 'system', 'mixed'] as const)('retains the %s capture and PCM timeline across sleep, rejecting old input incarnations', async (source) => {
    const { service, internal, webContents, recorders, feed } = await setup(source)
    try {
      feed()
      const first = await service.invoke({ operation: 'capture.segment' }, 'sleep-plugin') as { audio_session_id: string; end_ms: number }
      expect(first.end_ms).toBe(20)
      const oldToken = internal.inputSessionId
      internal.handleSuspend()
      const pausedDuration = service.snapshot().duration_ms
      expect(service.snapshot()).toMatchObject({ state: 'paused', suspension_reason: 'system_sleep' })
      // A microphone that keeps producing during macOS suspension cannot trip the mixer anymore.
      internal.handleChunk({ sender: webContents }, oldToken, new ArrayBuffer(96_000))
      await internal.sleepTask
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + 20_000)
      expect(service.snapshot().duration_ms).toBeLessThan(pausedDuration + 100)
      internal.handleResume()
      await internal.recoveryTask
      expect(service.snapshot()).toMatchObject({ state: 'recording', session_id: 'sleep-session', source })
      expect(service.snapshot().suspension_reason).toBeUndefined()
      expect(service.snapshot().duration_ms).toBeLessThan(pausedDuration + 1000)
      expect(recorders.length).toBe(source === 'microphone' ? 0 : 2)
      internal.handleChunk({ sender: webContents }, oldToken, new ArrayBuffer(96_000))
      internal.handleCaptureEvent({ sender: webContents }, { type: 'error', session_id: oldToken, message: 'late old error' })
      feed()
      const second = await service.invoke({ operation: 'capture.segment' }, 'sleep-plugin') as { end_ms: number }
      expect(second.end_ms).toBe(40)
      expect(service.consume(first.audio_session_id, 'sleep-plugin').pcm.length).toBe(640)
      expect(service.snapshot().state).toBe('recording')
    } finally { vi.restoreAllMocks(); await service.destroy() }
  })

  it('does not restart a user-paused recording until explicitly resumed', async () => {
    const { service, internal, factory } = await setup()
    try {
      await service.invoke({ operation: 'capture.pause' }, 'sleep-plugin')
      internal.handleSuspend()
      await internal.sleepTask
      internal.handleResume()
      expect(factory).toHaveBeenCalledTimes(1)
      expect(service.snapshot()).toMatchObject({ state: 'paused' })
      await service.invoke({ operation: 'capture.resume' }, 'sleep-plugin')
      expect(factory).toHaveBeenCalledTimes(2)
      expect(service.snapshot().state).toBe('recording')
    } finally { vi.restoreAllMocks(); await service.destroy() }
  })

  it.each(['capture.cancel', 'capture.stop'] as const)('%s during sleep prevents wake from restarting inputs', async (operation) => {
    const { service, internal, factory, feed } = await setup()
    try {
      feed()
      internal.handleSuspend()
      await service.invoke({ operation }, 'sleep-plugin')
      internal.handleResume()
      expect(service.snapshot().state).toBe('idle')
      expect(factory).toHaveBeenCalledTimes(1)
    } finally { await service.destroy() }
  })

  it('can cancel a pending wake and rejects a late native recorder without resurrecting capture', async () => {
    const { service, internal, factory, recorders } = await setup()
    try {
      internal.handleSuspend()
      await internal.sleepTask
      let resolve!: (recorder: typeof recorders[number]) => void
      factory.mockImplementationOnce(() => new Promise(done => { resolve = done }))
      internal.handleResume()
      const recovering = internal.recoveryTask
      await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
      await service.invoke({ operation: 'capture.cancel' }, 'sleep-plugin')
      const late = Object.assign(new EventEmitter(), { start: vi.fn(), stop: vi.fn(async () => undefined) })
      resolve(late)
      await recovering
      expect(late.start).not.toHaveBeenCalled()
      expect(late.stop).toHaveBeenCalledOnce()
      expect(service.snapshot().state).toBe('idle')
    } finally { await service.destroy() }
  })

  it('recovers after a second sleep interrupts a pending wake', async () => {
    const { service, internal, factory, recorders } = await setup()
    try {
      internal.handleSuspend()
      await internal.sleepTask
      let resolve!: (recorder: typeof recorders[number]) => void
      factory.mockImplementationOnce(() => new Promise(done => { resolve = done }))
      internal.handleResume()
      const firstWake = internal.recoveryTask
      await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
      internal.handleSuspend()
      await internal.sleepTask
      internal.handleResume()
      const late = Object.assign(new EventEmitter(), { start: vi.fn(), stop: vi.fn(async () => undefined) })
      resolve(late)
      await firstWake
      await vi.waitFor(() => expect(service.snapshot().state).toBe('recording'))
      expect(factory).toHaveBeenCalledTimes(3)
      expect(late.start).not.toHaveBeenCalled()
    } finally { await service.destroy() }
  })

  it('honors a user pause while wake is pending, then allows an explicit resume', async () => {
    const { service, internal, factory, recorders } = await setup()
    try {
      internal.handleSuspend()
      await internal.sleepTask
      let resolve!: (recorder: typeof recorders[number]) => void
      factory.mockImplementationOnce(() => new Promise(done => { resolve = done }))
      internal.handleResume()
      const recovering = internal.recoveryTask
      await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
      await service.invoke({ operation: 'capture.pause' }, 'sleep-plugin')
      const late = Object.assign(new EventEmitter(), { start: vi.fn(), stop: vi.fn(async () => undefined) })
      resolve(late)
      await recovering
      expect(service.snapshot().state).toBe('paused')
      expect(factory).toHaveBeenCalledTimes(2)
      await service.invoke({ operation: 'capture.resume' }, 'sleep-plugin')
      expect(service.snapshot().state).toBe('recording')
      expect(factory).toHaveBeenCalledTimes(3)
    } finally { await service.destroy() }
  })

  it('retains the actual wake failure for the owning plugin after the transient host failure resets', async () => {
    const { service, internal, factory } = await setup()
    try {
      internal.handleSuspend()
      await internal.sleepTask
      factory.mockRejectedValueOnce(new Error('Output device unavailable after wake'))
      internal.handleResume()
      await internal.recoveryTask
      expect(service.snapshot()).toMatchObject({ state: 'failed', error: 'Output device unavailable after wake' })
      internal.reset()
      expect(await service.invoke({ operation: 'capture.status' }, 'sleep-plugin')).toMatchObject({ state: 'failed', error: 'Output device unavailable after wake' })
      expect(await service.invoke({ operation: 'capture.status' }, 'other-plugin')).toMatchObject({ state: 'idle' })
    } finally { await service.destroy() }
  })
})
