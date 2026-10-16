import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { spawn } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
import { MacSystemAudioRecorder, WindowsSystemAudioRecorder } from './system-audio-backends'

function helper() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
    kill: vi.fn((_signal: string) => { queueMicrotask(() => child.emit('close', 0)); return true }),
  })
  const launch = vi.fn(() => { queueMicrotask(() => child.emit('spawn')); return child })
  return { child, launch }
}

afterEach(() => vi.useRealTimers())

describe('pure system audio platform adapters', () => {
  it('launches only the fixed audio helper and handles split metadata / odd pipe boundaries', async () => {
    const { child, launch } = helper()
    const recorder = new MacSystemAudioRecorder('/app/audio/audiotee', launch as unknown as typeof spawn)
    const data = vi.fn()
    const metadata = vi.fn()
    const error = vi.fn()
    recorder.on('data', data).on('metadata', metadata).on('error', error)
    await recorder.start()
    expect(launch).toHaveBeenCalledWith('/app/audio/audiotee', ['--sample-rate', '16000', '--chunk-duration', '0.02'], { shell: false, stdio: 'pipe' })
    const message = JSON.stringify({ message_type: 'metadata', data: { sample_rate: 16000, channels_per_frame: 1, bits_per_channel: 16, is_float: false, encoding: 'pcm_s16le' } })
    child.stdout.write(Buffer.from([0, 1, 2]))
    expect(data).not.toHaveBeenCalled()
    child.stderr.write(message.slice(0, 12))
    child.stderr.write(`${message.slice(12)}\n`)
    expect(metadata).toHaveBeenCalledWith({ sampleRate: 16000, channelsPerFrame: 1, bitsPerChannel: 16, isFloat: false, encoding: 'pcm_s16le' })
    child.stdout.write(Buffer.from([3]))
    expect(data.mock.calls).toEqual([[{ data: Buffer.from([0, 1]) }], [{ data: Buffer.from([2, 3]) }]])
    child.stderr.write('non-json log\nnull\n')
    expect(error).not.toHaveBeenCalled()
    await Promise.all([recorder.stop(), recorder.stop()])
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
  })

  it('propagates helper permission errors and forcibly terminates a stuck helper', async () => {
    vi.useFakeTimers()
    const { child, launch } = helper()
    child.kill.mockImplementation((signal) => { if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null)); return true })
    const recorder = new MacSystemAudioRecorder('/app/audio/audiotee', launch as unknown as typeof spawn)
    const error = vi.fn()
    recorder.on('error', error)
    await recorder.start()
    child.stderr.write(`${JSON.stringify({ message_type: 'error', data: { message: 'System audio permission denied' } })}\n`)
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'System audio permission denied' }))
    const stopped = recorder.stop()
    await vi.advanceTimersByTimeAsync(3_000)
    await stopped
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('maps WASAPI events into the common PCM contract and clears polling on stop', async () => {
    vi.useFakeTimers()
    const events = [{ type: 4, sampleRate: 16000, channelsPerFrame: 1, bitsPerChannel: 16, isFloat: false, encoding: 'pcm_s16le' }, { type: 0, data: Buffer.alloc(640) }]
    const native = { startSystemAudio: vi.fn(), processEvents: vi.fn(() => events.splice(0)), stop: vi.fn() }
    const recorder = new WindowsSystemAudioRecorder(native)
    const metadata = vi.fn()
    const data = vi.fn()
    recorder.on('metadata', metadata).on('data', data)
    await recorder.start()
    expect(native.startSystemAudio).toHaveBeenCalledWith({ sampleRate: 16000, chunkDurationMs: 20, stereo: false, emitSilence: true, mute: false })
    await vi.advanceTimersByTimeAsync(10)
    expect(metadata).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 16000 }))
    expect(data).toHaveBeenCalledWith({ data: Buffer.alloc(640) })
    await recorder.stop()
    await recorder.stop()
    expect(native.stop).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('forwards WASAPI failures instead of silently switching sources', async () => {
    vi.useFakeTimers()
    const native = { startSystemAudio: vi.fn(), processEvents: vi.fn(() => [{ type: 3, message: 'Output device unavailable' }]), stop: vi.fn() }
    const recorder = new WindowsSystemAudioRecorder(native)
    const error = vi.fn()
    recorder.on('error', error)
    await recorder.start()
    await vi.advanceTimersByTimeAsync(10)
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'Output device unavailable' }))
    await recorder.stop()
  })
})
