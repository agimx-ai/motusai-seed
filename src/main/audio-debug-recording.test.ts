import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AudioDebugRecording } from './audio-debug-recording'

const roots: string[] = []
async function root() {
  const directory = await mkdtemp(join(tmpdir(), 'seed-audio-debug-test-'))
  roots.push(directory)
  return directory
}
afterEach(async () => { await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

describe('latest local audio diagnostics', () => {
  it('automatically saves exactly three private WAVs with the original samples', async () => {
    const directory = await root()
    const recording = await AudioDebugRecording.start(directory, 'mixed')
    const mic = Buffer.from([1, 0, 2, 0])
    recording.append('microphone', mic)
    mic.fill(9)
    recording.append('system', Buffer.from([3, 0, 4, 0]))
    recording.append('output', Buffer.from([5, 0]))
    recording.append('output', Buffer.from([6, 0]))
    const saving = recording.finish()
    expect(recording.finish()).toBe(saving)
    recording.append('output', Buffer.alloc(100))
    expect(await saving).toBe(join(directory, 'latest'))
    expect(await readdir(directory)).toEqual(['latest'])
    expect((await readdir(recording.directory)).sort()).toEqual(['microphone.wav', 'mixed.wav', 'system.wav'])
    for (const [filename, pcm] of [
      ['microphone.wav', [1, 0, 2, 0]], ['system.wav', [3, 0, 4, 0]], ['mixed.wav', [5, 0, 6, 0]],
    ] as const) {
      const file = join(recording.directory, filename)
      const wav = await readFile(file)
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
      expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ')
      expect(wav.readUInt32LE(4)).toBe(40)
      expect(wav.readUInt16LE(22)).toBe(1)
      expect(wav.readUInt32LE(24)).toBe(16_000)
      expect(wav.readUInt16LE(34)).toBe(16)
      expect(wav.readUInt32LE(40)).toBe(4)
      expect([...wav.subarray(44)]).toEqual([...pcm])
      if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
    }
    if (process.platform !== 'win32') expect((await stat(recording.directory)).mode & 0o777).toBe(0o700)
  })

  it('replaces the previous capture without retaining history or stale source files', async () => {
    const directory = await root()
    const first = await AudioDebugRecording.start(directory, 'mixed')
    first.append('microphone', Buffer.from([1, 0]))
    first.append('output', Buffer.from([2, 0]))
    await first.finish()
    await writeFile(join(first.directory, 'recording.json'), 'old diagnostics')
    const second = await AudioDebugRecording.start(directory, 'microphone')
    second.append('microphone', Buffer.from([3, 0]))
    second.append('system', Buffer.from([99, 0]))
    second.append('output', Buffer.from([3, 0]))
    await second.finish()
    expect(second.directory).toBe(first.directory)
    expect(await readdir(directory)).toEqual(['latest'])
    expect((await readdir(second.directory)).sort()).toEqual(['microphone.wav', 'output.wav'])
    expect([...((await readFile(join(second.directory, 'microphone.wav'))).subarray(44))]).toEqual([3, 0])
    const third = await AudioDebugRecording.start(directory, 'system')
    third.append('system', Buffer.from([4, 0]))
    third.append('output', Buffer.from([4, 0]))
    await third.finish()
    expect((await readdir(third.directory)).sort()).toEqual(['output.wav', 'system.wav'])
  })

  it('writes incrementally without truncating recordings after two minutes', async () => {
    const recording = await AudioDebugRecording.start(await root(), 'microphone')
    const pcm = Buffer.alloc(16_000 * 2, 7)
    for (let second = 0; second < 121; second++) {
      recording.append('microphone', pcm)
      recording.append('output', pcm)
      await Reflect.get(recording, 'writes')
    }
    expect((await stat(join(recording.directory, 'microphone.wav'))).size).toBe(44 + pcm.length * 121)
    expect(Reflect.get(recording, 'pendingBytes')).toBe(0)
    await recording.finish()
    const wav = await readFile(join(recording.directory, 'microphone.wav'))
    expect(wav.readUInt32LE(40)).toBe(pcm.length * 121)
    expect(wav.subarray(44).every((sample) => sample === 7)).toBe(true)
    expect(pcm[0]).toBe(7)
  })

  it('bounds queued diagnostics if the disk cannot keep up, then closes every file', async () => {
    const recording = await AudioDebugRecording.start(await root(), 'mixed')
    recording.append('microphone', Buffer.alloc(2 * 1024 * 1024 + 2))
    await expect(recording.finish()).rejects.toThrow('cannot keep up')
    for (const { file } of Reflect.get(recording, 'tracks').values()) {
      await expect(file.stat()).rejects.toMatchObject({ code: 'EBADF' })
    }
  })

  it.skipIf(process.platform === 'win32')('rejects symlinked roots or destinations without touching their targets', async () => {
    const directory = await root()
    const target = await root()
    await writeFile(join(target, 'keep'), 'untouched')
    await symlink(target, join(directory, 'linked-root'), 'dir')
    await expect(AudioDebugRecording.start(join(directory, 'linked-root'), 'mixed')).rejects.toThrow('local directory')
    await symlink(target, join(directory, 'latest'), 'dir')
    await expect(AudioDebugRecording.start(directory, 'mixed')).rejects.toThrow('local directory')
    expect(await readFile(join(target, 'keep'), 'utf8')).toBe('untouched')
  })
})
