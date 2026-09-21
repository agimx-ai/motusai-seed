import { beforeEach, describe, expect, it, vi } from 'vitest'

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

type AudioServiceInternals = {
  window: { webContents: { send: ReturnType<typeof vi.fn> }; isDestroyed(): boolean }
  sessionId: string
  state: string
  pcmBytes: number
  pcmBaseOffsetBytes: number
  handleChunk(event: { sender: unknown }, sessionId: string, pcm: ArrayBuffer): void
}

describe('AudioService segmented capture', () => {
  beforeEach(() => vi.clearAllMocks())

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
