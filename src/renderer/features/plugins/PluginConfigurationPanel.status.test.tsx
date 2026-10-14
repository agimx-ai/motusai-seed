// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedPluginConfigurationSchema } from '../../../shared/plugin-manifest'
import { SeedI18nProvider } from '../../i18n'
import { PluginConfigurationPanel } from './PluginConfigurationPanel'

const text = (value: string) => ({ en_US: value, zh_Hans: value })
const configuration = seedPluginConfigurationSchema.parse({
  id: 'accounts', schema_version: 1, renderer: 'seed.profiles', title: text('Accounts'), description: text('Manage accounts'),
  profiles: {
    min_items: 0, max_items: 4, default_required: false, summary_fields: ['name'],
    status: { source: 'connections', refresh_interval_ms: 60_000 },
    fields: [{ key: 'name', type: 'text', label: text('Name') }],
    actions: { save: { label: text('Save') } },
  },
})

beforeEach(() => {
  vi.stubGlobal('motusSeed', {
    snapshot: async () => ({ locale: 'en-US', languagePreference: 'en-US' }),
    subscribe: () => () => undefined,
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function panel(
  status: 'connected' | 'disconnected',
  reconnectable: boolean,
  onReconnectProfile = vi.fn(async () => undefined),
) {
  return {
    onReconnectProfile,
    view: <SeedI18nProvider><PluginConfigurationPanel
      pluginId="com.example.accounts"
      configuration={configuration}
      state={{ persisted: true, values: { profiles: JSON.stringify([{ id: 'account-one', name: 'Account one' }]), default_profile_id: '' }, configuredSecrets: [] }}
      pluginNames={new Map()}
      busy={false}
      onSave={async () => true}
      onQueryOptions={async () => []}
      onQueryProfileStatuses={async () => [{ profileId: 'account-one', state: status, reconnectable }]}
      onReconnectProfile={onReconnectProfile}
    /></SeedI18nProvider>,
  }
}

describe('PluginConfigurationPanel profile connection status', () => {
  it('renders a connected state as a bordered text capsule instead of a dot', async () => {
    const { view } = panel('connected', false)
    render(view)

    const status = await screen.findByText('Connected')
    expect(status.className).toContain('rounded-full')
    expect(status.className).toContain('border-success/30')
    expect(status.querySelector('span')).toBeNull()
  })

  it('keeps a reconnectable state as an accessible capsule button', async () => {
    const user = userEvent.setup()
    const { view, onReconnectProfile } = panel('disconnected', true)
    render(view)

    const reconnect = await screen.findByRole('button', { name: 'Disconnected. Reconnect now' })
    expect(reconnect.textContent).toBe('Disconnected')
    await user.click(reconnect)
    await waitFor(() => expect(onReconnectProfile).toHaveBeenCalledWith({
      pluginId: 'com.example.accounts', configurationId: 'accounts', profileId: 'account-one',
    }))
  })
})
