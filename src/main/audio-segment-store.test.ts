import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AudioSegmentStore } from './audio-segment-store'

describe('AudioSegmentStore', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('persists FLAC by plugin and only removes a segment after acknowledgement', async () => {
    root = await mkdtemp(join(tmpdir(), 'seed-audio-store-'))
    const store = new AudioSegmentStore(root)
    const pcm = Buffer.alloc(16_000 * 2 * 2)
    for (let index = 0; index < pcm.byteLength / 2; index += 1) pcm.writeInt16LE(Math.round(Math.sin(index / 12) * 8_000), index * 2)

    await store.create('com.example.recorder', 'capture-1')
    const segment = await store.append('com.example.recorder', 'capture-1', pcm, 0, 2_000)
    const sessions = await store.list('com.example.recorder')
    const restored = await store.readSegment('com.example.recorder', 'capture-1', segment.segment_id)

    expect(sessions).toMatchObject([{ session_id: 'capture-1', state: 'interrupted', segments: [{ segment_id: segment.segment_id }] }])
    expect(restored.pcm.equals(pcm)).toBe(true)
    await store.acknowledge('com.example.recorder', 'capture-1', segment.segment_id)
    expect((await store.readSession('com.example.recorder', 'capture-1')).segments).toEqual([])

    await store.discard('com.example.recorder', 'capture-1')
    await expect(readFile(join(root, 'com.example.recorder', 'audio-sessions', 'capture-1', 'session.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
