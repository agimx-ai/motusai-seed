// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConfigurationDraft } from './use-configuration-draft'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { cleanup(); vi.useRealTimers() })
const source: Record<string, string> = { service: 'one', choice: 'model', effort: 'high', greeting: 'Hello' }
const advance = async (ms = 300) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

describe('configuration draft saves', () => {
  it('does not save on mount, refresh, or an unchanged selection', async () => {
    const save = vi.fn(async () => true)
    const h = renderHook(({ value }) => useConfigurationDraft(value, true, save), { initialProps: { value: source } })
    act(() => h.result.current.update({ ...source }))
    h.rerender({ value: { ...source, greeting: 'Changed elsewhere' } })
    await advance()
    expect(save).not.toHaveBeenCalled()
    expect(h.result.current.values.greeting).toBe('Changed elsewhere')
  })
  it('coalesces rapid edits and saves model and thinking together', async () => {
    const save = vi.fn(async () => true)
    const h = renderHook(() => useConfigurationDraft(source, true, save))
    act(() => h.result.current.update({ ...source, choice: 'two', effort: '' }))
    await advance(200)
    act(() => h.result.current.update({ ...source, choice: 'two', effort: 'low' }))
    await advance(299)
    expect(save).not.toHaveBeenCalled()
    await advance(1)
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...source, choice: 'two', effort: 'low' })
    expect(h.result.current.status).toBe('idle')
  })
  it('serializes saves and preserves newer edits across old store snapshots', async () => {
    let finish!: (value: boolean) => void
    const save = vi.fn<(values: typeof source) => Promise<boolean>>().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockResolvedValue(true)
    const h = renderHook(({ value }) => useConfigurationDraft(value, true, save), { initialProps: { value: source } })
    const first = { ...source, choice: 'two', effort: '' }
    const last = { ...first, effort: 'low', greeting: 'Latest' }
    act(() => h.result.current.update(first))
    await advance()
    act(() => h.result.current.update({ ...first, effort: 'low' }))
    act(() => h.result.current.update(last))
    await advance()
    expect(save).toHaveBeenCalledTimes(1)
    h.rerender({ value: first })
    expect(h.result.current.values).toEqual(last)
    await act(async () => { finish(true) })
    expect(save.mock.calls.map(([values]) => values)).toEqual([first, last])
    expect(h.result.current.values).toEqual(last)
  })
  it('adopts normalized saved values only after the latest save completes', async () => {
    let finish!: (value: boolean) => void
    const save = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve }))
    const h = renderHook(({ value }) => useConfigurationDraft(value, true, save), { initialProps: { value: source } })
    act(() => h.result.current.update({ ...source, greeting: '  Hi  ' }))
    await advance()
    h.rerender({ value: { ...source, greeting: 'Hi' } })
    expect(h.result.current.values.greeting).toBe('  Hi  ')
    await act(async () => { finish(true) })
    expect(h.result.current.values.greeting).toBe('Hi')
    expect(save).toHaveBeenCalledTimes(1)
  })
  it.each(['false', 'reject'] as const)('keeps failed drafts and requires an explicit retry after %s', async (failure) => {
    const save = vi.fn<(values: typeof source) => Promise<boolean>>()
    if (failure === 'false') save.mockResolvedValueOnce(false)
    else save.mockRejectedValueOnce(new Error('disk failed'))
    save.mockResolvedValue(true)
    const h = renderHook(() => useConfigurationDraft(source, true, save))
    const next = { ...source, greeting: 'Keep this' }
    act(() => h.result.current.update(next))
    await advance()
    expect(h.result.current.status).toBe('error')
    expect(h.result.current.values).toEqual(next)
    await advance(10_000)
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => { await h.result.current.flush() })
    expect(save).toHaveBeenLastCalledWith(next)
    expect(save).toHaveBeenCalledTimes(2)
    expect(h.result.current.status).toBe('idle')
  })
  it('saves the latest queued edit after an in-flight failure when the user retries', async () => {
    let finish!: (value: boolean) => void
    const save = vi.fn<(values: typeof source) => Promise<boolean>>().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockResolvedValue(true)
    const h = renderHook(() => useConfigurationDraft(source, true, save))
    act(() => h.result.current.update({ ...source, greeting: 'First' }))
    await advance()
    const latest = { ...source, greeting: 'Last' }
    act(() => h.result.current.update(latest))
    await advance()
    await act(async () => { finish(false) })
    expect(h.result.current.status).toBe('error')
    expect(h.result.current.values).toEqual(latest)
    await act(async () => { await h.result.current.flush() })
    expect(save).toHaveBeenLastCalledWith(latest)
  })
  it('flushes a pending edit on navigation and clears its timer', async () => {
    const save = vi.fn(async () => true)
    const h = renderHook(() => useConfigurationDraft(source, true, save))
    const next = { ...source, greeting: 'Before leaving' }
    act(() => h.result.current.update(next))
    await act(async () => { h.unmount() })
    expect(save).toHaveBeenCalledExactlyOnceWith(next)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('drains the last queued edit after navigation without starting a concurrent save', async () => {
    let finish!: (value: boolean) => void
    const save = vi.fn<(values: typeof source) => Promise<boolean>>().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockResolvedValue(true)
    const h = renderHook(() => useConfigurationDraft(source, true, save))
    act(() => h.result.current.update({ ...source, greeting: 'First' }))
    await advance()
    const next = { ...source, greeting: 'Last' }
    act(() => h.result.current.update(next))
    h.unmount()
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => { finish(true) })
    expect(save).toHaveBeenLastCalledWith(next)
    expect(save).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not retry a known failure merely because the form unmounts', async () => {
    const save = vi.fn(async () => false)
    const h = renderHook(() => useConfigurationDraft(source, true, save))
    act(() => h.result.current.update({ ...source, greeting: 'Unconfirmed' }))
    await advance()
    h.unmount()
    await advance(1000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('leaves manual forms as drafts until their separate submit flow is used', async () => {
    const save = vi.fn(async () => true)
    const h = renderHook(({ value }) => useConfigurationDraft(value, false, save), { initialProps: { value: source } })
    act(() => h.result.current.update({ ...source, greeting: 'Draft' }))
    await advance(1000)
    await act(async () => { await h.result.current.flush() })
    expect(save).not.toHaveBeenCalled()
    h.rerender({ value: { ...source, greeting: 'Saved externally' } })
    expect(h.result.current.values.greeting).toBe('Saved externally')
    h.unmount()
    expect(save).not.toHaveBeenCalled()
  })
})
