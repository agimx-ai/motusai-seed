// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdatePluginConfigurationInput } from '../../../shared/contracts'
import { seedPluginConfigurationSchema } from '../../../shared/plugin-manifest'
import { SeedI18nProvider } from '../../i18n'
import { PluginConfigurationPanel } from './PluginConfigurationPanel'

const text = (value: string) => ({ en_US: value, zh_Hans: value })
const initial = { service: 'agent', access: 'read_only', choice: 'one', effort: 'high', greeting: 'Hello' }
const query = vi.fn(async () => [
  { value: 'one', label: 'Model one', thinkingLevels: ['off', 'low', 'high'] },
  { value: 'two', label: 'Model two', thinkingLevels: ['off', 'low'] },
])
const configuration = (automatic: boolean) => seedPluginConfigurationSchema.parse({
  id: 'settings', schema_version: 1, renderer: 'seed.form', title: text('Settings'), description: text('Shared settings'),
  ...(automatic ? { save_mode: 'auto' } : { actions: { save: { label: text('Save') } } }),
  fields: [
    { key: 'service', type: 'select', label: text('Service'), options: ['agent', 'other'].map((value) => ({ value, label: text(value) })) },
    { key: 'access', type: 'select', label: text('Tool access'), options: ['read_only', 'all'].map((value) => ({ value, label: text(value) })) },
    { key: 'choice', type: 'text', label: text('Model and thinking'), control: 'model_select', thinking_field_key: 'effort', dynamic_options: { depends_on: ['service'], required_fields: ['service'] }, reset_when_changed: ['service'] },
    { key: 'effort', type: 'text', label: text('Effort'), reset_when_changed: ['service'] },
    { key: 'greeting', type: 'textarea', label: text('Greeting') },
  ],
})
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
  vi.stubGlobal('motusSeed', { snapshot: async () => ({ locale: 'en-US', languagePreference: 'en-US' }), subscribe: () => () => undefined })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
function mount(automatic = true, save = vi.fn<(_input: UpdatePluginConfigurationInput) => Promise<boolean>>(async () => true)) {
  const result = render(<SeedI18nProvider><PluginConfigurationPanel pluginId="com.example.any" configuration={configuration(automatic)}
    state={{ persisted: true, values: initial, configuredSecrets: [] }} pluginNames={new Map()} busy={false}
    onSave={save} onQueryOptions={query} onQueryProfileStatuses={async () => []} onReconnectProfile={async () => undefined}
  /></SeedI18nProvider>)
  return { ...result, save, user: userEvent.setup() }
}

describe('automatic configuration forms', () => {
  it('saves model and thinking atomically, with no save button and without closing the picker', async () => {
    const h = mount()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    const trigger = screen.getByRole('button', { name: 'Model and thinking' }) as HTMLButtonElement
    await waitFor(() => expect(trigger.disabled).toBe(false))
    expect(h.save).not.toHaveBeenCalled()
    await h.user.click(trigger)
    await h.user.click(screen.getByRole('option', { name: 'Model two' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledExactlyOnceWith({
      pluginId: 'com.example.any', configurationId: 'settings', values: { ...initial, choice: 'two', effort: '', profiles: '[]', default_profile_id: '' },
    }))
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    h.save.mockClear()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '1' } })
    await waitFor(() => expect(h.save).toHaveBeenCalledExactlyOnceWith({
      pluginId: 'com.example.any', configurationId: 'settings', values: { ...initial, choice: 'two', effort: 'low', profiles: '[]', default_profile_id: '' },
    }))
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
  it('saves tool access and resets both linked values when changing service', async () => {
    const h = mount()
    await h.user.click(screen.getByRole('button', { name: 'Tool access' }))
    await h.user.click(screen.getByRole('option', { name: 'all' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1))
    expect(h.save.mock.calls[0]![0].values).toMatchObject({ ...initial, access: 'all' })
    h.save.mockClear()
    await h.user.click(screen.getByRole('button', { name: 'Service' }))
    await h.user.click(screen.getByRole('option', { name: 'other' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1))
    expect(h.save.mock.calls[0]![0].values).toMatchObject({ ...initial, access: 'all', service: 'other', choice: '', effort: '' })
  })
  it('keeps failed drafts and offers retry, not a separate save button', async () => {
    const save = vi.fn<(_input: UpdatePluginConfigurationInput) => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true)
    const h = mount(true, save)
    fireEvent.change(screen.getByRole('textbox', { name: 'Greeting' }), { target: { value: 'Keep this' } })
    expect((await screen.findByRole('alert')).textContent).toContain('Your changes have been kept')
    expect((screen.getByRole('textbox', { name: 'Greeting' }) as HTMLTextAreaElement).value).toBe('Keep this')
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    await h.user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(h.save).toHaveBeenCalledTimes(2)
    expect(h.save.mock.calls[1]![0].values.greeting).toBe('Keep this')
  })
  it('waits for Chinese composition to finish before saving the greeting', async () => {
    vi.useFakeTimers()
    const h = mount()
    const input = screen.getByRole('textbox', { name: 'Greeting' })
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '欢迎' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(h.save).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '欢迎使用' } })
    fireEvent.compositionEnd(input)
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save.mock.calls[0]![0].values.greeting).toBe('欢迎使用')
  })
  it('keeps manual forms unchanged until Save is clicked', async () => {
    const h = mount(false)
    const input = screen.getByRole('textbox', { name: 'Greeting' })
    fireEvent.change(input, { target: { value: 'Manual draft' } })
    fireEvent.blur(input)
    expect(h.save).not.toHaveBeenCalled()
    await h.user.click(screen.getByRole('button', { name: 'Save' }))
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save.mock.calls[0]![0].values.greeting).toBe('Manual draft')
  })
})
