import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AudioFileOutput } from './audio-file-output'

const format48k = {
  encoding: 'pcm_f32le',
  sample_rate: 48_000,
  channels: 2,
  bits_per_sample: 32,
  layout: 'planar',
} as const

function sineChunk48k(freqHz: number, durationMs: number, startSample = 0, amp = 0.5) {
  const frames = Math.round((48_000 * durationMs) / 1_000)
  const planar = new Float32Array(frames * 2)
  for (let i = 0; i < frames; i++) {
    const v = amp * Math.sin((2 * Math.PI * freqHz * (startSample + i)) / 48_000)
    planar[i] = v
    planar[frames + i] = v
  }
  return Buffer.from(planar.buffer)
}

function channelRms(wav: Buffer, channel: 0 | 1, startSec: number, endSec: number) {
  const startFrame = Math.floor(startSec * 16_000)
  const endFrame = Math.min(Math.floor((wav.length - 44) / 4), Math.floor(endSec * 16_000))
  let sumSq = 0
  let count = 0
  for (let frame = startFrame; frame < endFrame; frame++) {
    const sample = wav.readInt16LE(44 + frame * 4 + channel * 2) / 32_768
    sumSq += sample * sample
    count += 1
  }
  return count ? Math.sqrt(sumSq / count) : 0
}

describe('AudioFileOutput continuous 16kHz stereo WAV', () => {
  it('separates microphone (L) and system (R) cleanly and stays synced when system audio is silent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seed-stereo-sync-'))
    const pluginDir = join(root, 'plugin')
    await mkdir(pluginDir)
    try {
      const out = await AudioFileOutput.prepare(root, 'plugin', 'mixed', { stereo: '000001-microphone.wav' })
      // 0.0s -> 1.0s: only microphone produces audio (simulates Windows emitSilence:false)
      for (let i = 0; i < 50; i++) {
        out.append('microphone', format48k, sineChunk48k(440, 20, i * 960))
      }
      // 1.0s -> 2.0s: both microphone (440 Hz) and system (880 Hz) produce audio
      for (let i = 50; i < 100; i++) {
        out.append('microphone', format48k, sineChunk48k(440, 20, i * 960))
        out.append('system', format48k, sineChunk48k(880, 20, (i - 50) * 960))
      }
      const result = await out.finish()
      expect(result.audio_save_failed).toBeUndefined()
      expect(result.audio_files).toHaveLength(1)

      const wav = await readFile(result.audio_files[0]!)
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
      expect(wav.readUInt16LE(20)).toBe(1) // PCM
      expect(wav.readUInt16LE(22)).toBe(2) // Stereo
      expect(wav.readUInt32LE(24)).toBe(16_000)
      expect(wav.readUInt16LE(34)).toBe(16)
      const dataBytes = wav.readUInt32LE(40)
      expect(dataBytes).toBe(wav.length - 44)
      const durSec = dataBytes / (16_000 * 4)
      expect(durSec).toBeGreaterThan(1.95)
      expect(durSec).toBeLessThan(2.1)

      // First second: L active, R silent (0)
      expect(channelRms(wav, 0, 0.1, 0.8)).toBeGreaterThan(0.2)
      expect(channelRms(wav, 1, 0.1, 0.8)).toBe(0)
      // Second second: both L and R active and aligned
      expect(channelRms(wav, 0, 1.2, 1.8)).toBeGreaterThan(0.2)
      expect(channelRms(wav, 1, 1.2, 1.8)).toBeGreaterThan(0.2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('appends seamlessly across repeated microphone <-> mixed switches into one single stereo WAV', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seed-stereo-switch-'))
    const pluginDir = join(root, 'plugin')
    await mkdir(pluginDir)
    try {
      const relPath = '000001-microphone.wav'
      // Segment 1: microphone only (1s)
      const s1 = await AudioFileOutput.prepare(root, 'plugin', 'microphone', { stereo: relPath })
      for (let i = 0; i < 50; i++) s1.append('microphone', format48k, sineChunk48k(440, 20, i * 960))
      const r1 = await s1.finish()
      expect(r1.audio_save_failed).toBeUndefined()

      // Segment 2: mixed (1s) appending to same file
      const s2 = await AudioFileOutput.prepare(root, 'plugin', 'mixed', { stereo: relPath, append: true })
      for (let i = 0; i < 50; i++) {
        s2.append('microphone', format48k, sineChunk48k(440, 20, i * 960))
        s2.append('system', format48k, sineChunk48k(880, 20, i * 960))
      }
      const r2 = await s2.finish()
      expect(r2.audio_save_failed).toBeUndefined()

      // Segment 3: back to microphone only (1s)
      const s3 = await AudioFileOutput.prepare(root, 'plugin', 'microphone', { stereo: relPath, append: true })
      for (let i = 0; i < 50; i++) s3.append('microphone', format48k, sineChunk48k(440, 20, i * 960))
      const r3 = await s3.finish()
      expect(r3.audio_save_failed).toBeUndefined()

      // Segment 4: back to mixed (1s)
      const s4 = await AudioFileOutput.prepare(root, 'plugin', 'mixed', { stereo: relPath, append: true })
      for (let i = 0; i < 50; i++) {
        s4.append('microphone', format48k, sineChunk48k(440, 20, i * 960))
        s4.append('system', format48k, sineChunk48k(880, 20, i * 960))
      }
      const r4 = await s4.finish()
      expect(r4.audio_save_failed).toBeUndefined()
      expect(r4.audio_files).toEqual(r1.audio_files)

      const wav = await readFile(r4.audio_files[0]!)
      const dataBytes = wav.readUInt32LE(40)
      expect(dataBytes).toBe(wav.length - 44)
      const durSec = dataBytes / (16_000 * 4)
      expect(durSec).toBeGreaterThan(3.95)
      expect(durSec).toBeLessThan(4.05)

      // Verify each 1-second segment's L/R timeline
      expect(channelRms(wav, 0, 0.2, 0.8)).toBeGreaterThan(0.2)
      expect(channelRms(wav, 1, 0.2, 0.8)).toBe(0)
      expect(channelRms(wav, 0, 1.2, 1.8)).toBeGreaterThan(0.2)
      expect(channelRms(wav, 1, 1.2, 1.8)).toBeGreaterThan(0.2)
      expect(channelRms(wav, 0, 2.2, 2.8)).toBeGreaterThan(0.2)
      expect(channelRms(wav, 1, 2.2, 2.8)).toBe(0)
      expect(channelRms(wav, 0, 3.2, 3.8)).toBeGreaterThan(0.2)
      expect(channelRms(wav, 1, 3.2, 3.8)).toBeGreaterThan(0.2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('boosts quiet system audio toward -18 dBFS without amplifying near-silence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seed-stereo-agc-'))
    const pluginDir = join(root, 'plugin')
    await mkdir(pluginDir)
    try {
      const out = await AudioFileOutput.prepare(root, 'plugin', 'mixed', { stereo: '000001-microphone.wav' })
      // Feed 2s of quiet (-35 dBFS, amp=0.025) system audio and near-silent (-65 dBFS, amp=0.0008) mic floor
      for (let i = 0; i < 100; i++) {
        out.append('microphone', format48k, sineChunk48k(440, 20, i * 960, 0.0008))
        out.append('system', format48k, sineChunk48k(880, 20, i * 960, 0.025))
      }
      const result = await out.finish()
      expect(result.audio_save_failed).toBeUndefined()
      const wav = await readFile(result.audio_files[0]!)
      // After AGC settles (1.0s-1.8s), quiet system audio (input RMS ~0.0177) should be boosted toward ~0.125
      const sysRms = channelRms(wav, 1, 1.0, 1.8)
      const micRms = channelRms(wav, 0, 1.0, 1.8)
      expect(sysRms).toBeGreaterThan(0.08)
      expect(sysRms).toBeLessThan(0.2)
      // Noise floor below -50 dBFS stays un-amplified
      expect(micRms).toBeLessThan(0.002)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects appending to a non-WAV or incompatible existing file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seed-stereo-invalid-'))
    const pluginDir = join(root, 'plugin')
    await mkdir(pluginDir)
    try {
      await writeFile(join(pluginDir, 'bad.wav'), 'not a valid wav file')
      const out = await AudioFileOutput.prepare(root, 'plugin', 'microphone', { stereo: 'bad.wav', append: true })
      out.append('microphone', format48k, sineChunk48k(440, 20))
      const result = await out.finish()
      expect(result.audio_save_failed).toBe(true)
      expect(result.audio_files).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
