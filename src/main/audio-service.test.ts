import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const { ipcMain } = vi.hoisted(() => ({
  ipcMain: {
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain,
  session: {},
  systemPreferences: {},
}))

import { AudioService } from './audio-service'
import { LatestAudioRecording } from './latest-audio-recording'

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
