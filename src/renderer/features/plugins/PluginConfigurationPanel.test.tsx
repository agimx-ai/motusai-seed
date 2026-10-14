import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { seedPluginConfigurationSchema } from '../../../shared/plugin-manifest'
import { SeedI18nProvider } from '../../i18n'
import { PluginConfigurationPanel } from './PluginConfigurationPanel'

const text = (value: string) => ({ en_US: value, zh_Hans: value })

describe('PluginConfigurationPanel header actions', () => {
  it.each(['default', 'form'] as const)('renders a $s model picker in the form body without duplicating its linked thinking field', (size) => {
    const configuration = seedPluginConfigurationSchema.parse({
      id: 'preferences', schema_version: 1, renderer: 'seed.form', title: text('Preferences'), description: text('Global settings'),
      fields: [
        { key: 'service', type: 'text', label: text('Service') },
        { key: 'choice', type: 'text', label: text('Model and thinking'), control: 'model_select', size, thinking_field_key: 'effort', dynamic_options: { depends_on: ['service'], required_fields: ['service'] } },
        { key: 'effort', type: 'text', label: text('Duplicated thinking field') },
      ], actions: { save: { label: text('Save') } },
    })
    const html = renderToStaticMarkup(<SeedI18nProvider><PluginConfigurationPanel
      pluginId="com.example.arbitrary" configuration={configuration}
      state={{ persisted: true, values: { service: 'service-one', choice: 'model-one', effort: 'high' }, configuredSecrets: [] }}
      pluginNames={new Map()} busy={false} onSave={async () => true} onQueryOptions={async () => []}
      onQueryProfileStatuses={async () => []} onReconnectProfile={async () => undefined}
    /></SeedI18nProvider>)
    expect(html).toContain('Model and thinking')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('Duplicated thinking field')
    expect(html.match(/<input /g)).toHaveLength(1)
    expect(html.indexOf('Model and thinking')).toBeGreaterThan(html.indexOf('<form'))
    expect(html.includes('style="height:var(--text-input-height)"')).toBe(size === 'form')
    expect(html.includes('border-input')).toBe(size === 'form')
    expect(html.includes('px-[var(--text-input-padding-x)]')).toBe(size === 'form')
    expect(html.includes('seed-action-button')).toBe(size === 'default')
  })
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
      onSave={async () => true}
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
