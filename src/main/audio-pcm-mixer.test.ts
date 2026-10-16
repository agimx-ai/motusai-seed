import { describe, expect, it } from 'vitest'
import { AudioPcmMixer } from './audio-pcm-mixer'

function signal(length: number, sample: (index: number) => number) {
  const pcm = Buffer.alloc(length * 2)
  for (let index = 0; index < length; index++) pcm.writeInt16LE(Math.round(sample(index)), index * 2)
  return pcm
}

describe('single-track fixed audio mixing', () => {
  it('preserves arbitrary packet boundaries and the final partial frame', () => {
    const mixer = new AudioPcmMixer()
    const microphone = signal(1_003, () => 1_000)
    const system = signal(1_003, () => 2_000)
    const output = [
      mixer.push('microphone', microphone.subarray(0, 174)),
      mixer.push('system', system),
      mixer.push('microphone', microphone.subarray(174)),
      mixer.flush(),
    ]
    const pcm = Buffer.concat(output)
    expect(pcm.length).toBe(2_006)
    for (let index = 0; index < 1_003; index++) expect(pcm.readInt16LE(index * 2)).toBe(1_500)
    expect(mixer.flush().length).toBe(0)
  })

  it('keeps a fixed ratio for speech-shaped input, sustained signals and changing background levels', () => {
    const mixer = new AudioPcmMixer()
    for (let frame = 0; frame < 100; frame++) {
      const microphone = signal(320, (i) => frame < 25 ? 20 : frame < 50 ? 4_000 : 3_000 * Math.sin(2 * Math.PI * 400 * i / 16_000))
      const system = signal(320, (i) => (frame < 50 ? 10_000 : 2_000) * Math.sin(2 * Math.PI * 800 * i / 16_000))
      mixer.push('microphone', microphone)
      const output = mixer.push('system', system)
      expect(output.length).toBe(640)
      for (let offset = 0; offset < output.length; offset += 2) {
        expect(output.readInt16LE(offset)).toBe(Math.round((microphone.readInt16LE(offset) + system.readInt16LE(offset)) / 2))
      }
    }
  })

  it.each(['microphone', 'system'] as const)('retains %s at a fixed level when the other input is silent', (source) => {
    const mixer = new AudioPcmMixer()
    for (const sample of [20, 249, 250, 1_000, 10_000, -10_000]) {
      mixer.push('microphone', signal(320, () => source === 'microphone' ? sample : 0))
      const output = mixer.push('system', signal(320, () => source === 'system' ? sample : 0))
      for (let offset = 0; offset < output.length; offset += 2) expect(output.readInt16LE(offset)).toBe(Math.round(sample / 2))
    }
  })

  it('prevents overflow across the full PCM16 range without dynamic limiting', () => {
    const mixer = new AudioPcmMixer()
    const pairs = [[32_767, 32_767], [-32_768, -32_768], [32_767, -32_768], [30_000, 30_000], [-30_000, -30_000]]
    mixer.push('microphone', signal(320, (i) => pairs[i % pairs.length][0]))
    const output = mixer.push('system', signal(320, (i) => pairs[i % pairs.length][1]))
    for (let index = 0; index < 320; index++) {
      const pair = pairs[index % pairs.length]
      expect(output.readInt16LE(index * 2)).toBe(Math.round((pair[0] + pair[1]) / 2) || 0)
    }
  })

  it.each(['microphone', 'system'] as const)('pads only the missing %s tail and preserves every remaining sample', (source) => {
    const mixer = new AudioPcmMixer()
    const microphone = signal(source === 'microphone' ? 321 : 997, () => 1_000)
    const system = signal(source === 'system' ? 321 : 997, () => 2_000)
    const output = Buffer.concat([mixer.push('microphone', microphone), mixer.push('system', system), mixer.flush()])
    expect(output.length).toBe(997 * 2)
    for (let index = 0; index < 997; index++) {
      const mic = index * 2 < microphone.length ? 1_000 : 0
      const sys = index * 2 < system.length ? 2_000 : 0
      expect(output.readInt16LE(index * 2)).toBe((mic + sys) / 2)
    }
  })

  it('produces identical samples regardless of packet sizes and arrival order', () => {
    const microphone = signal(4_013, (i) => 12_000 * Math.sin(i / 17))
    const system = signal(4_013, (i) => 8_000 * Math.cos(i / 29))
    const reference = new AudioPcmMixer()
    const expected = Buffer.concat([reference.push('microphone', microphone), reference.push('system', system), reference.flush()])
    const mixer = new AudioPcmMixer()
    const chunks: Buffer[] = []
    for (let offset = 0; offset < microphone.length; offset += 194) {
      chunks.push(mixer.push('system', system.subarray(offset, offset + 194)))
      chunks.push(mixer.push('microphone', microphone.subarray(offset, offset + 194)))
    }
    chunks.push(mixer.flush())
    expect(Buffer.concat(chunks)).toEqual(expected)
  })

  it('resets queued samples across pause or session boundaries', () => {
    const mixer = new AudioPcmMixer()
    mixer.push('microphone', signal(20, () => 2_000))
    mixer.clear()
    expect(mixer.flush().length).toBe(0)
    mixer.push('microphone', signal(320, () => 1_000))
    const output = mixer.push('system', signal(320, () => 2_000))
    expect(output).toEqual(signal(320, () => 1_500))
  })

  it.each(['microphone', 'system'] as const)('bounds %s skew and rejects misaligned samples', (source) => {
    const mixer = new AudioPcmMixer()
    expect(() => mixer.push(source, Buffer.alloc(1))).toThrow('对齐')
    expect(mixer.flush().length).toBe(0)
    expect(() => mixer.push(source, Buffer.alloc(64_002))).toThrow('中断')
    expect(mixer.flush().length).toBe(0)
  })
})
