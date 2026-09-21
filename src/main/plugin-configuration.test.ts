import { describe, expect, it } from 'vitest'
import { seedPluginConfigurationSchema } from '../shared/plugin-manifest'
import { brokerPluginConfigurationDeclaration, initialPluginConfiguration, normalizePluginConfiguration, pluginConfigurationState, reconcilePluginConfigurationDefaultGroup } from './plugin-configuration'

const configurationInput = {
  id: 'search-providers',
  schema_version: 1,
  renderer: 'seed.profiles',
  title: { en_US: 'Search providers', zh_Hans: '搜索服务' },
  description: { en_US: 'Configure search.', zh_Hans: '配置搜索。' },
  fields: [{
    key: 'note', type: 'textarea', span: 'full', label: { en_US: 'Note', zh_Hans: '备注' }, default: 'hello',
  }],
  actions: { save: { label: { en_US: 'Save note', zh_Hans: '保存备注' } } },
  profiles: {
    id_prefix: 'search',
    min_items: 1,
    max_items: 4,
    summary_fields: ['provider'],
    fields: [
      {
        key: 'provider', type: 'select', span: 'small', label: { en_US: 'Provider', zh_Hans: '供应商' }, required: true,
        options: [
          { value: 'searxng', label: { en_US: 'SearXNG', zh_Hans: 'SearXNG' } },
          { value: 'tavily', label: { en_US: 'Tavily', zh_Hans: 'Tavily' } },
        ],
      },
      {
        key: 'base_url', type: 'url', span: 'default', label: { en_US: 'URL', zh_Hans: '地址' }, schemes: ['http', 'https'],
        required_when: { field: 'provider', equals: 'searxng' },
        visible_when: { field: 'provider', equals: 'searxng' },
      },
      {
        key: 'api_key', type: 'secret', span: 'full', label: { en_US: 'API key', zh_Hans: 'API Key' },
        required_when: { field: 'provider', equals: 'tavily' },
        visible_when: { field: 'provider', equals: 'tavily' },
      },
    ],
    actions: {
      add: { label: { en_US: 'Add', zh_Hans: '添加' } },
      save: { label: { en_US: 'Save', zh_Hans: '保存' } },
      remove: { label: { en_US: 'Remove', zh_Hans: '移除' } },
      set_default: {
        label: { en_US: 'Set default', zh_Hans: '设为默认' },
        selected_label: { en_US: 'Default', zh_Hans: '默认' },
      },
    },
  },
}
const configuration = seedPluginConfigurationSchema.parse(configurationInput)

describe('broker configuration bootstrap', () => {
  it('uses the registered native declaration before contributions have been published', () => {
    const current: any = structuredClone(configurationInput)
    current.profiles.fields[1].placeholder = { en_US: 'Service URL', zh_Hans: '服务地址' }
    const resolved = brokerPluginConfigurationDeclaration({ configurationId: 'search-providers', bootstrap: current, runtimeKind: 'native-host', permissions: [] })
    expect(resolved?.profiles.fields[1]?.placeholder).toEqual(current.profiles.fields[1].placeholder)
    expect(brokerPluginConfigurationDeclaration({ configurationId: 'other', bootstrap: current, runtimeKind: 'native-host', permissions: [] })).toBeUndefined()
    expect(brokerPluginConfigurationDeclaration({ configurationId: 'search-providers', bootstrap: current, runtimeKind: 'sandboxed-web', permissions: [] })).toBeUndefined()
  })

  it('still enforces the declared permission and broker-only secret boundary', () => {
    const restricted: any = { ...configurationInput, permission: 'network.connect.internet', secret_access: 'broker' }
    expect(brokerPluginConfigurationDeclaration({ configurationId: 'search-providers', bootstrap: restricted, runtimeKind: 'native-host', permissions: [] })).toBeUndefined()
    expect(brokerPluginConfigurationDeclaration({ configurationId: 'search-providers', bootstrap: restricted, runtimeKind: 'native-host', permissions: ['network.connect.internet'] })?.secretAccess).toBe('broker')
  })
})
const linkedConfiguration = seedPluginConfigurationSchema.parse({
  id: 'models',
  schema_version: 1,
  renderer: 'seed.profiles',
  title: { en_US: 'Models', zh_Hans: '模型' },
  description: { en_US: 'Configure models.', zh_Hans: '配置模型。' },
  fields: [],
  profiles: {
    id_prefix: 'model',
    min_items: 1,
    max_items: 4,
    default_required: true,
    summary_fields: ['provider', 'model'],
    fields: [
      {
        key: 'provider', type: 'select', label: { en_US: 'Provider', zh_Hans: '供应商' }, required: true,
        options: [
          {
            value: 'deepseek', label: { en_US: 'DeepSeek', zh_Hans: 'DeepSeek' },
            defaults: { model: 'deepseek-chat', model_catalog_url: 'https://api.deepseek.com/models' },
          },
          {
            value: 'xiaomi', label: { en_US: 'Xiaomi', zh_Hans: '小米' },
            defaults: { model: 'mimo-v2.5', model_catalog_url: 'https://api.xiaomimimo.com/v1/models' },
          },
        ],
      },
      { key: 'model', type: 'text', label: { en_US: 'Model', zh_Hans: '模型' }, required: true, default: 'deepseek-chat' },
      {
        key: 'api_key', type: 'secret', label: { en_US: 'API key', zh_Hans: 'API Key' }, required: true,
        reset_when_changed: ['provider'],
      },
      { key: 'model_catalog_url', type: 'hidden', default: 'https://api.deepseek.com/models' },
    ],
    actions: { save: { label: { en_US: 'Save', zh_Hans: '保存' } } },
  },
})

describe('generic plugin profiles configuration', () => {
  it('supports configuration sections with no initial profiles', () => {
    const optional = seedPluginConfigurationSchema.parse({
      ...configurationInput,
      id: 'optional-sources',
      profiles: { ...configurationInput.profiles, min_items: 0, default_required: false },
    })
    expect(initialPluginConfiguration(optional)).toMatchObject({ profiles: [], default_profile_id: '' })
    expect(normalizePluginConfiguration(optional, { profiles: '[]', default_profile_id: '' })).toMatchObject({ profiles: [], default_profile_id: '' })
  })

  it('keeps one default profile across configuration sections in the same group', () => {
    const hosted = seedPluginConfigurationSchema.parse({
      ...configurationInput,
      id: 'hosted-model',
      fields: [],
      actions: undefined,
      profiles: { ...configurationInput.profiles, default_group: 'conversation-model', min_items: 1, max_items: 1, default_required: false },
    })
    const custom = seedPluginConfigurationSchema.parse({
      ...configurationInput,
      id: 'custom-models',
      fields: [],
      actions: undefined,
      profiles: { ...configurationInput.profiles, default_group: 'conversation-model', min_items: 0, default_required: false },
    })
    const hostedValue = { ...initialPluginConfiguration(hosted), default_profile_id: 'search-default' }
    const customValue = {
      ...initialPluginConfiguration(custom),
      profiles: [{ id: 'search-custom', provider: 'searxng', base_url: 'https://example.com', api_key: '' }],
      default_profile_id: 'search-custom',
    }
    const selectedCustom = reconcilePluginConfigurationDefaultGroup(
      [hosted, custom],
      new Map([['hosted-model', hostedValue], ['custom-models', customValue]]),
      'custom-models',
    )
    expect(selectedCustom.get('hosted-model')?.default_profile_id).toBe('')
    expect(selectedCustom.get('custom-models')?.default_profile_id).toBe('search-custom')

    const restoredHosted = reconcilePluginConfigurationDefaultGroup(
      [hosted, custom],
      new Map([
        ['hosted-model', { ...hostedValue, default_profile_id: '' }],
        ['custom-models', { ...customValue, profiles: [], default_profile_id: '' }],
      ]),
      'custom-models',
    )
    expect(restoredHosted.get('hosted-model')?.default_profile_id).toBe('search-default')
  })

  it('derives hidden fields from the selected option instead of trusting stale submitted values', () => {
    expect(initialPluginConfiguration(linkedConfiguration).profiles[0]).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-chat',
      model_catalog_url: 'https://api.deepseek.com/models',
    })
    const current = {
      schema_version: 1 as const,
      profiles: [{
        id: 'model-main', provider: 'deepseek', model: 'deepseek-chat', api_key: 'deepseek-key',
        model_catalog_url: 'https://api.deepseek.com/models',
      }],
      default_profile_id: 'model-main',
      values: {},
    }
    const switched = normalizePluginConfiguration(linkedConfiguration, {
      profiles: JSON.stringify([{
        id: 'model-main', provider: 'xiaomi', model: 'mimo-v2.5', api_key: 'xiaomi-key',
        model_catalog_url: 'https://api.deepseek.com/models',
      }]),
      default_profile_id: 'model-main',
    }, current)
    expect(switched.profiles[0]).toMatchObject({
      provider: 'xiaomi',
      model: 'mimo-v2.5',
      api_key: 'xiaomi-key',
      model_catalog_url: 'https://api.xiaomimimo.com/v1/models',
    })

    const repaired = normalizePluginConfiguration(linkedConfiguration, {
      profiles: JSON.stringify([{
        id: 'model-main', provider: 'xiaomi', model: 'mimo-v2.5', api_key: '',
        model_catalog_url: 'https://api.xiaomimimo.com/v1/models',
      }]),
      default_profile_id: 'model-main',
    }, {
      ...current,
      profiles: [{
        id: 'model-main', provider: 'xiaomi', model: 'mimo-v2.5', api_key: 'xiaomi-key',
        model_catalog_url: 'https://api.deepseek.com/models',
      }],
    })
    expect(repaired.profiles[0]).toMatchObject({
      provider: 'xiaomi',
      api_key: 'xiaomi-key',
      model_catalog_url: 'https://api.xiaomimimo.com/v1/models',
    })
  })

  it('accepts the new field width enum and rejects the legacy half width', () => {
    expect(configuration.profiles.fields.map((field) => field.span)).toEqual(['small', 'default', 'full'])
    const legacy = structuredClone(configurationInput)
    legacy.profiles.fields[0]!.span = 'half'
    expect(seedPluginConfigurationSchema.safeParse(legacy).success).toBe(false)
  })

  it('rejects legacy service, fields, and model_profiles configuration formats', () => {
    expect(() => seedPluginConfigurationSchema.parse({
      service: 'models.chat',
      type: 'model_profiles',
      title: { en_US: 'Models', zh_Hans: '模型' },
      description: { en_US: 'Legacy.', zh_Hans: '旧格式。' },
    })).toThrow()
  })

  it('validates conditional fields and accepts explicitly allowed HTTP URLs', () => {
    const value = normalizePluginConfiguration(configuration, {
      profiles: JSON.stringify([{ id: 'search-main', provider: 'searxng', base_url: 'http://192.168.2.58:8080', api_key: '' }]),
      default_profile_id: 'search-main',
      note: 'local',
    })
    expect(value.profiles[0]).toMatchObject({ provider: 'searxng', base_url: 'http://192.168.2.58:8080', api_key: '' })
    expect(value.values.note).toBe('local')
  })

  it('preserves an omitted configured secret and masks it from renderer state', () => {
    const current = {
      schema_version: 1 as const,
      profiles: [{ id: 'search-main', provider: 'tavily', base_url: '', api_key: 'secret-key' }],
      default_profile_id: 'search-main',
      values: { note: 'hello' },
    }
    const value = normalizePluginConfiguration(configuration, {
      profiles: JSON.stringify([{ id: 'search-main', provider: 'tavily', base_url: '', api_key: '' }]),
      default_profile_id: 'search-main',
      note: 'hello',
    }, current)
    expect(value.profiles[0]?.api_key).toBe('secret-key')
    const state = pluginConfigurationState(configuration, value)
    expect(state.persisted).toBe(true)
    expect(JSON.stringify(state)).not.toContain('secret-key')
    expect(state.configuredSecrets).toEqual(['profiles.search-main.api_key'])
  })

  it('distinguishes an initial profile draft from persisted configuration', () => {
    const initialState = pluginConfigurationState(configuration)
    expect(initialState.persisted).toBe(false)
    expect(JSON.parse(initialState.values.profiles)).toHaveLength(configuration.profiles.minItems)

    const persisted = initialPluginConfiguration(configuration)
    expect(pluginConfigurationState(configuration, persisted).persisted).toBe(true)
  })

  it('rejects undeclared fields and missing conditional values', () => {
    expect(() => normalizePluginConfiguration(configuration, {
      profiles: JSON.stringify([{ id: 'search-main', provider: 'searxng', base_url: '', api_key: '', extra: 'nope' }]),
      default_profile_id: 'search-main',
      note: 'hello',
    })).toThrow('未声明字段')
    expect(() => normalizePluginConfiguration(configuration, {
      profiles: JSON.stringify([{ id: 'search-main', provider: 'tavily', base_url: '', api_key: '' }]),
      default_profile_id: 'search-main',
      note: 'hello',
    })).toThrow('API Key')
  })

  it('uses the selected client language and the plugin-owned field label', () => {
    expect(() => normalizePluginConfiguration(configuration, {
      profiles: JSON.stringify([{ id: 'search-main', provider: 'tavily', base_url: '', api_key: '' }]),
      default_profile_id: 'search-main',
      note: 'hello',
    }, undefined, 'en-US')).toThrow('API key cannot be empty.')
  })
})
