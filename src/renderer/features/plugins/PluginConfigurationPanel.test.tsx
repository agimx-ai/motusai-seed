import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { seedPluginConfigurationSchema } from '../../../shared/plugin-manifest'
import { SeedI18nProvider } from '../../i18n'
import { PluginConfigurationPanel } from './PluginConfigurationPanel'

const text = (value: string) => ({ en_US: value, zh_Hans: value })

describe('PluginConfigurationPanel header actions', () => {
  it('keeps iconless profile and contributed actions in one header row', () => {
    const configuration = seedPluginConfigurationSchema.parse({
      id: 'accounts', schema_version: 1, renderer: 'seed.profiles', title: text('Accounts'), description: text('Manage accounts'),
      profiles: {
        min_items: 0, max_items: 4, default_required: false, summary_fields: ['name'],
        fields: [{ key: 'name', type: 'text', label: text('Name') }],
        actions: { save: { label: text('Save') }, add: { label: text('Existing account'), placement: 'header' } },
      },
    })
    const html = renderToStaticMarkup(<SeedI18nProvider><PluginConfigurationPanel
      pluginId="com.example.accounts"
      configuration={configuration}
      state={{ persisted: true, values: { profiles: '[]', default_profile_id: '' }, configuredSecrets: [] }}
      pluginNames={new Map()}
      busy={false}
      headerActions={<button type="button">Connect account</button>}
      onSave={async () => undefined}
      onQueryOptions={async () => []}
      onQueryProfileStatuses={async () => []}
      onReconnectProfile={async () => undefined}
    /></SeedI18nProvider>)
    expect(html.indexOf('Existing account')).toBeLessThan(html.indexOf('Connect account'))
    expect(html.match(/Existing account/g)).toHaveLength(1)
    expect(html).toContain('flex shrink-0 items-center gap-2')
    expect(html).toContain('mt-8 first-of-type:mt-0')
    expect(html).not.toContain('<svg')
  })
})
