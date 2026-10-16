import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SystemAudioCapture } from './system-audio-capture'

const format = { sampleRate: 16_000, channelsPerFrame: 1, bitsPerChannel: 16, isFloat: false, encoding: 'pcm_s16le' }

function nativeRecorder() {
  const recorder = Object.assign(new EventEmitter(), { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) })
  return recorder
}

afterEach(() => vi.useRealTimers())

describe('native system audio capture', () => {
  it('waits for real PCM readiness, accepts silence, and releases all native listeners on stop', async () => {
    const recorder = nativeRecorder()
    const data = vi.fn()
    const failed = vi.fn()
    const capture = new SystemAudioCapture(data, failed, async () => recorder)
    const start = capture.start()
    await vi.waitFor(() => expect(recorder.start).toHaveBeenCalledOnce())
    recorder.emit('metadata', format)
    const pcm = Buffer.alloc(640)
    recorder.emit('data', { data: pcm })
    await start
    expect(data).toHaveBeenCalledWith(pcm)
    expect(failed).not.toHaveBeenCalled()
    await Promise.all([capture.stop(), capture.stop()])
    expect(recorder.stop).toHaveBeenCalledOnce()
    expect(recorder.eventNames()).toEqual([])
  })

  it.each([
    { ...format, channelsPerFrame: 2 }, { ...format, sampleRate: 48_000 }, { ...format, isFloat: true },
  ])('rejects unexpected native metadata without silently reinterpreting samples (%j)', async (metadata) => {
    const recorder = nativeRecorder()
    const failed = vi.fn()
    const capture = new SystemAudioCapture(vi.fn(), failed, async () => recorder)
    const rejected = expect(capture.start()).rejects.toThrow('格式')
    await vi.waitFor(() => expect(recorder.start).toHaveBeenCalledOnce())
    recorder.emit('metadata', metadata)
    await rejected
    expect(failed).toHaveBeenCalledOnce()
    expect(recorder.stop).toHaveBeenCalledOnce()
  })

  it.each([Buffer.alloc(1), Buffer.alloc(0), Buffer.alloc(64_002)])('rejects malformed or oversized PCM and releases capture', async (data) => {
    const recorder = nativeRecorder()
    const capture = new SystemAudioCapture(vi.fn(), vi.fn(), async () => recorder)
    const rejected = expect(capture.start()).rejects.toThrow('无效')
    await vi.waitFor(() => expect(recorder.start).toHaveBeenCalledOnce())
    recorder.emit('metadata', format)
    recorder.emit('data', { data })
    await rejected
    expect(recorder.stop).toHaveBeenCalledOnce()
  })

  it('cancels initialization while the native factory is pending without starting a late recorder', async () => {
    const recorder = nativeRecorder()
    let resolve!: (value: typeof recorder) => void
    const capture = new SystemAudioCapture(vi.fn(), vi.fn(), () => new Promise((done) => { resolve = done }))
    const rejected = expect(capture.start()).rejects.toThrow('取消')
    await capture.stop()
    resolve(recorder)
    await rejected
    expect(recorder.start).not.toHaveBeenCalled()
    expect(recorder.stop).toHaveBeenCalledOnce()
  })

  it('cancels a pending first-frame wait and releases capture', async () => {
    const recorder = nativeRecorder()
    const capture = new SystemAudioCapture(vi.fn(), vi.fn(), async () => recorder)
    const rejected = expect(capture.start()).rejects.toThrow('取消')
    await vi.waitFor(() => expect(recorder.start).toHaveBeenCalledOnce())
    await capture.stop()
    await rejected
    expect(recorder.stop).toHaveBeenCalledOnce()
  })

  it('fails initialization if no samples arrive rather than reporting a successful empty recording', async () => {
    vi.useFakeTimers()
    const recorder = nativeRecorder()
    const capture = new SystemAudioCapture(vi.fn(), vi.fn(), async () => recorder)
    const rejected = expect(capture.start()).rejects.toThrow('未收到')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejected
    expect(recorder.stop).toHaveBeenCalledOnce()
  })

  it('cleans up permission/start failures and signals an unexpected backend stop', async () => {
    const denied = nativeRecorder()
    denied.start.mockRejectedValueOnce(new Error('permission denied'))
    const capture = new SystemAudioCapture(vi.fn(), vi.fn(), async () => denied)
    await expect(capture.start()).rejects.toThrow('permission denied')
    expect(denied.stop).toHaveBeenCalledOnce()
    const recorder = nativeRecorder()
    const failed = vi.fn()
    const active = new SystemAudioCapture(vi.fn(), failed, async () => recorder)
    const started = active.start()
    await vi.waitFor(() => expect(recorder.start).toHaveBeenCalledOnce())
    recorder.emit('metadata', format)
    recorder.emit('data', { data: Buffer.alloc(640) })
    await started
    recorder.emit('stop')
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: '系统音频来源已断开。' }))
    await active.stop()
    expect(recorder.stop).toHaveBeenCalledOnce()
  })
})
