// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AudioCaptureCommand } from '../../../shared/audio-capture'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function host(getUserMedia = vi.fn(async () => mediaStream())) {
  vi.resetModules()
  let listener!: (value: AudioCaptureCommand) => void
  const order: string[] = []
  const emit = vi.fn((event: { type: string }) => { order.push(event.type) })
  const chunk = vi.fn(() => { order.push('chunk') })
  const contexts: FakeContext[] = []
  class FakeContext {
    sampleRate = 16_000
    state = 'running'
    audioWorklet = { addModule: vi.fn(async () => undefined) }
    close = vi.fn(async () => { this.state = 'closed' })
    suspend = vi.fn(async () => { this.state = 'suspended' })
    resume = vi.fn(async () => { this.state = 'running' })
    createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }))
    destination = {}
    constructor(public options: unknown) { contexts.push(this) }
  }
  class FakeWorklet {
    port = {
      onmessage: null as ((event: unknown) => void) | null,
      close: vi.fn(),
      postMessage: vi.fn(() => queueMicrotask(() => {
        this.port.onmessage?.({ data: { type: 'pcm', pcm: new ArrayBuffer(24) } })
        this.port.onmessage?.({ data: { type: 'flushed' } })
      })),
    }
    connect = vi.fn()
    disconnect = vi.fn()
  }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('AudioWorkletNode', FakeWorklet)
  window.AudioContext = FakeContext as unknown as typeof AudioContext
  window.seedAudioCapture = { ready: vi.fn(), emit, chunk, subscribe: (value) => { listener = value; return () => undefined } }
  await import('./index')
  return { listener, emit, chunk, contexts, order }
}

function mediaStream() {
  const track = { readyState: 'live', onended: null, stop: vi.fn() }
  return { getTracks: () => [track], getAudioTracks: () => [track], track }
}

describe('AudioWorklet capture lifecycle', () => {
  it('flushes remaining PCM before stopped and keeps pause/resume in the same context', async () => {
    const { listener, emit, contexts, order } = await host()
    listener({ type: 'start', session_id: 'one' })
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'started' })))
    expect(contexts[0].options).toEqual({ sampleRate: 16_000 })
    listener({ type: 'pause', session_id: 'one' })
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith({ type: 'paused', session_id: 'one' }))
    listener({ type: 'resume', session_id: 'one' })
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith({ type: 'resumed', session_id: 'one' }))
    listener({ type: 'stop', session_id: 'one' })
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith({ type: 'stopped', session_id: 'one' }))
    expect(order.indexOf('chunk')).toBeLessThan(order.indexOf('stopped'))
    expect(contexts).toHaveLength(1)
    expect(contexts[0].close).toHaveBeenCalledOnce()
  })

  it('disposes a cancelled late permission result without closing a newer capture', async () => {
    let grant!: (value: ReturnType<typeof mediaStream>) => void
    const old = mediaStream(), current = mediaStream()
    const getUserMedia = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { grant = resolve })).mockResolvedValue(current)
    const { listener, emit } = await host(getUserMedia)
    listener({ type: 'start', session_id: 'old' })
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce())
    listener({ type: 'stop', session_id: 'old' })
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith({ type: 'stopped', session_id: 'old' }))
    listener({ type: 'start', session_id: 'new' })
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'started', session_id: 'new' })))
    grant(old)
    await vi.waitFor(() => expect(old.track.stop).toHaveBeenCalledOnce())
    expect(current.track.stop).not.toHaveBeenCalled()
    listener({ type: 'stop', session_id: 'new' })
    await vi.waitFor(() => expect(current.track.stop).toHaveBeenCalledOnce())
  })
})
