import { describe, expect, it, vi } from 'vitest'
import { ClientReleaseNotesService, nextReleaseReadState, type ClientReleaseReadState } from './client-release-notes'

const contents = { version: '0.2.7', notes: { 'zh-CN': '# Seed 0.2.7\n\n更新说明', en: '# Seed 0.2.7\n\nRelease notes' } }

function persistence(initial?: ClientReleaseReadState) {
  let saved = initial
  return { read: async () => saved, write: vi.fn(async (state: ClientReleaseReadState) => { saved = state }) }
}

describe('Client release notes', () => {
  it('shows the current release on first launch until confirmed, then stays closed across restart', async () => {
    const storage = persistence()
    const service = new ClientReleaseNotesService(contents, storage)
    await service.initialize('0.2.7', true)
    expect(service.snapshot().unread).toBe(true)
    // Exiting before acknowledgement must not lose the pending release.
    const reopened = new ClientReleaseNotesService(contents, storage)
    await reopened.initialize('0.2.7', true)
    expect(reopened.snapshot().unread).toBe(true)
    await reopened.acknowledge('0.2.7')
    const acknowledged = new ClientReleaseNotesService(contents, storage)
    await acknowledged.initialize('0.2.7', true)
    expect(acknowledged.snapshot().unread).toBe(false)
  })

  it('shows the installed version once when skipping releases', async () => {
    const storage = persistence({ highestVersion: '0.1.9', pendingVersion: '0.1.9' })
    const service = new ClientReleaseNotesService(contents, storage)
    await service.initialize('0.2.7', true)
    expect(service.snapshot().unread).toBe(true)
    expect(storage.write).toHaveBeenLastCalledWith({ highestVersion: '0.2.7', pendingVersion: '0.2.7' })
  })

  it('does not show acknowledged versions again after downgrade and re-upgrade', () => {
    const saved = { highestVersion: '0.2.7' }
    expect(nextReleaseReadState('0.2.6', saved)).toEqual(saved)
    expect(nextReleaseReadState('0.2.7', saved)).toEqual(saved)
    expect(nextReleaseReadState('0.2.8', saved)).toEqual({ highestVersion: '0.2.8', pendingVersion: '0.2.8' })
    expect(nextReleaseReadState('0.2.7', { highestVersion: '0.2.7-beta.1' }).pendingVersion).toBe('0.2.7')
  })

  it('does not consume real acknowledgement state in development', async () => {
    const storage = persistence({ highestVersion: '0.2.7', pendingVersion: '0.2.7' })
    const service = new ClientReleaseNotesService(contents, storage)
    await service.initialize('0.2.7', false)
    await service.acknowledge('0.2.7')
    expect(service.snapshot().unread).toBe(false)
    expect(service.snapshot().notes).toEqual(contents.notes)
    expect(storage.write).not.toHaveBeenCalled()
  })

  it('rejects mismatched bundles and stale acknowledgements', async () => {
    const service = new ClientReleaseNotesService(contents, persistence())
    await expect(service.initialize('0.2.8', true)).rejects.toThrow('match')
    await service.initialize('0.2.7', true)
    await expect(service.acknowledge('0.2.6')).rejects.toThrow('different')
    expect(service.snapshot().unread).toBe(true)
  })

  it('keeps the popup unread if saving fails, and supports retry', async () => {
    const storage = persistence()
    const service = new ClientReleaseNotesService(contents, storage)
    await service.initialize('0.2.7', true)
    storage.write.mockRejectedValueOnce(new Error('disk full'))
    await expect(service.acknowledge('0.2.7')).rejects.toThrow('disk full')
    expect(service.snapshot().unread).toBe(true)
    await service.acknowledge('0.2.7')
    expect(service.snapshot().unread).toBe(false)
  })
})
