import { describe, expect, it } from 'vitest'
import { decodePcm16Flac, encodePcm16Flac } from './audio-flac'

describe('FLAC audio persistence', () => {
  it('round-trips PCM 16-bit audio without loss', async () => {
    const pcm = Buffer.alloc(16_000 * 2)
    for (let index = 0; index < 16_000; index += 1) pcm.writeInt16LE(Math.round(Math.sin(index / 20) * 12_000), index * 2)

    const encoded = await encodePcm16Flac(pcm, 16_000, 1)
    const decoded = await decodePcm16Flac(encoded)

    expect(encoded.subarray(0, 4).toString()).toBe('fLaC')
    expect(encoded.byteLength).toBeLessThan(pcm.byteLength)
    expect(decoded).toMatchObject({ sampleRate: 16_000, channels: 1 })
    expect(decoded.pcm.equals(pcm)).toBe(true)
  })
})
