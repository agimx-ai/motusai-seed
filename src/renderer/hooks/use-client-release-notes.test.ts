import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useClientReleaseNotes } from './use-client-release-notes'

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as Array<() => (() => void) | undefined> }))
vi.mock('react', () => ({
  useState: (initial?: unknown) => {
    const index = hooks.cursor++
    if (index === hooks.values.length) hooks.values.push(initial)
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value }]
  },
  useEffect: (effect: () => (() => void) | undefined) => { hooks.effects.push(effect) },
  useCallback: (callback: unknown) => callback,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const notes = { version: '0.2.7', unread: true, notes: { 'zh-CN': '更新', en: 'Update' } }
const api = { clientReleaseNotes: vi.fn(), acknowledgeClientReleaseNotes: vi.fn() }

function render(ready = true) {
  hooks.cursor = 0
  return useClientReleaseNotes(ready)
}

beforeEach(() => {
  hooks.values = []
  hooks.effects = []
  vi.clearAllMocks()
  api.clientReleaseNotes.mockResolvedValue(notes)
  api.acknowledgeClientReleaseNotes.mockResolvedValue(undefined)
  vi.stubGlobal('window', { motusSeed: api })
})
afterEach(() => vi.unstubAllGlobals())

describe('automatic client release notes', () => {
  it('does not load before startup is ready', () => {
    render(false)
    hooks.effects[0]()
    expect(api.clientReleaseNotes).not.toHaveBeenCalled()
  })

  it('does not retain already-read content for manual reopening', async () => {
    api.clientReleaseNotes.mockResolvedValue({ ...notes, unread: false })
    render()
    hooks.effects[0]()
    await Promise.resolve()
    expect(render().notes).toBeUndefined()
    expect(render()).not.toHaveProperty('show')
    expect(render()).not.toHaveProperty('open')
  })

  it('clears pending content only after successful acknowledgement', async () => {
    render()
    hooks.effects[0]()
    await Promise.resolve()
    expect(render().notes).toEqual(notes)
    await render().close()
    expect(api.acknowledgeClientReleaseNotes).toHaveBeenCalledWith('0.2.7')
    expect(render().notes).toBeUndefined()
    expect(render().busy).toBe(false)
  })

  it('keeps pending content when acknowledgement fails so the user can retry', async () => {
    api.acknowledgeClientReleaseNotes.mockRejectedValueOnce(new Error('disk full'))
    render()
    hooks.effects[0]()
    await Promise.resolve()
    await render().close()
    expect(render().notes).toEqual(notes)
    expect(render().busy).toBe(false)
    await render().close()
    expect(render().notes).toBeUndefined()
  })

  it('ignores a load that completes after unmount', async () => {
    render()
    const cleanup = hooks.effects[0]()
    cleanup?.()
    await Promise.resolve()
    expect(render().notes).toBeUndefined()
  })
})
