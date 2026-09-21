import type { PluginConfigurationState, StoredPluginConfiguration } from '../shared/contracts'
import { resolveSeedLocalizedText, seedPluginConfigurationSchema, type SeedPluginConfiguration } from '../shared/plugin-manifest'

type Field = SeedPluginConfiguration['fields'][number]

export function brokerPluginConfigurationDeclaration(input: {
  configurationId: string
  published?: SeedPluginConfiguration
  bootstrap?: unknown
  runtimeKind: 'native-host' | 'sandboxed-web'
  permissions: readonly string[]
}): SeedPluginConfiguration | undefined {
  const bootstrap = input.runtimeKind === 'native-host' ? seedPluginConfigurationSchema.safeParse(input.bootstrap) : undefined
  const declaration = bootstrap?.success && bootstrap.data.id === input.configurationId
    ? bootstrap.data
    : input.published?.id === input.configurationId ? input.published : undefined
  return declaration && (!declaration.permission || input.permissions.includes(declaration.permission)) ? declaration : undefined
}

function localized(locale: string, enUS: string, zhHans: string) {
  return locale.toLowerCase().startsWith('en') ? enUS : zhHans
}

const emptyConfiguration = (): StoredPluginConfiguration => ({ schema_version: 1, profiles: [], default_profile_id: '', values: {} })

function matches(values: Record<string, string>, condition?: Field['visibleWhen']) {
  if (!condition) return true
  const expected = Array.isArray(condition.equals) ? condition.equals : [condition.equals]
  return expected.includes(values[condition.field] || '')
}

function defaultValue(field: Field) {
  return field.default ?? field.options?.[0]?.value ?? ''
}

function configurationContext(fields: Field[], submitted: Record<string, unknown>, current: Record<string, string> = {}) {
  const context = Object.fromEntries(fields.map((field) => [
    field.key,
    field.type === 'hidden'
      ? current[field.key] ?? defaultValue(field)
      : String(submitted[field.key] ?? defaultValue(field)),
  ]))
  for (const field of fields) {
    if (field.type !== 'select') continue
    const selected = context[field.key]
    const selectionChanged = !current[field.key] || selected !== current[field.key]
    const defaults = field.options?.find((option) => option.value === selected)?.defaults || {}
    for (const [key, value] of Object.entries(defaults)) {
      const target = fields.find((candidate) => candidate.key === key)
      if (target?.type === 'hidden' || (selectionChanged && submitted[key] === undefined)) context[key] = value
    }
  }
  return context
}

function defaultProfile(configuration: SeedPluginConfiguration, index: number) {
  const suffix = index === 0 ? 'default' : String(index + 1)
  return {
    id: `${configuration.profiles.idPrefix}-${suffix}`,
    ...configurationContext(configuration.profiles.fields, {}),
  }
}

export function initialPluginConfiguration(configuration: SeedPluginConfiguration): StoredPluginConfiguration {
  const profiles = Array.from({ length: configuration.profiles.minItems }, (_, index) => defaultProfile(configuration, index))
  return {
    schema_version: 1,
    profiles,
    default_profile_id: configuration.profiles.defaultRequired ? profiles[0]?.id || '' : '',
    values: Object.fromEntries(configuration.fields.map((field) => [field.key, defaultValue(field)])),
  }
}

function normalizeField(
  field: Field,
  submitted: Record<string, unknown>,
  current: Record<string, string>,
  context: Record<string, string>,
  secretConfigured: boolean,
  locale: string,
) {
  if (field.type === 'hidden') return context[field.key] || defaultValue(field)
  if (!matches(context, field.visibleWhen)) return ''
  const raw = String(submitted[field.key] ?? '').trim()
  const dependencyChanged = field.resetWhenChanged?.some((key) => context[key] !== current[key]) || false
  const value = field.type === 'secret' && !raw && secretConfigured && !dependencyChanged ? current[field.key] || '' : raw
  const required = field.required || matches(context, field.requiredWhen) && Boolean(field.requiredWhen)
  const label = resolveSeedLocalizedText(field.label, locale, field.key)
  if (required && !value) throw new Error(localized(locale, `${label} cannot be empty.`, `${label}不能为空。`))
  if (value.length > field.maxLength) throw new Error(localized(locale, `${label} is too long.`, `${label}过长。`))
  if (field.type === 'select' && value && !field.options?.some((option) => option.value === value)) throw new Error(localized(locale, `${label} has an invalid option.`, `${label}选项无效。`))
  if (field.type === 'url' && value) {
    try {
      const protocol = new URL(value).protocol.replace(':', '')
      if (!(field.schemes || ['https']).includes(protocol as 'http' | 'https')) throw new Error()
    } catch { throw new Error(localized(locale, `${label} is not a valid URL.`, `${label}不是有效的 URL。`)) }
  }
  return value
}

function submittedProfiles(value: string, locale: string) {
  try {
    const parsed = JSON.parse(value || '[]') as unknown
    if (!Array.isArray(parsed)) throw new Error()
    return parsed
  } catch { throw new Error(localized(locale, 'The plugin profile format is invalid.', '插件配置档案格式无效。')) }
}

export function normalizePluginConfiguration(
  configuration: SeedPluginConfiguration,
  submittedValues: Record<string, string>,
  currentValue?: StoredPluginConfiguration,
  locale = 'zh-CN',
): StoredPluginConfiguration {
  const current = currentValue || emptyConfiguration()
  const allowed = new Set(['profiles', 'default_profile_id', ...configuration.fields.map((field) => field.key)])
  if (Object.keys(submittedValues).some((key) => !allowed.has(key))) throw new Error(localized(locale, 'The plugin configuration contains undeclared fields.', '插件配置包含未声明字段。'))
  const rawProfiles = submittedProfiles(submittedValues.profiles, locale)
  if (rawProfiles.length < configuration.profiles.minItems || rawProfiles.length > configuration.profiles.maxItems) {
    throw new Error(localized(locale,
      `The plugin requires between ${configuration.profiles.minItems} and ${configuration.profiles.maxItems} profiles.`,
      `插件配置档案数量必须为 ${configuration.profiles.minItems}–${configuration.profiles.maxItems} 个。`,
    ))
  }
  const currentById = new Map(current.profiles.map((profile) => [profile.id, profile]))
  const ids = new Set<string>()
  const profiles = rawProfiles.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(localized(locale, 'The plugin profile format is invalid.', '插件配置档案格式无效。'))
    const source = raw as Record<string, unknown>
    const id = String(source.id || '').trim()
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/.test(id) || ids.has(id)) throw new Error(localized(locale, 'A plugin profile ID is invalid or duplicated.', '插件配置档案 ID 无效或重复。'))
    ids.add(id)
    const undeclared = Object.keys(source).filter((key) => key !== 'id' && !configuration.profiles.fields.some((field) => field.key === key))
    if (undeclared.length) throw new Error(localized(locale, 'A plugin profile contains undeclared fields.', '插件配置档案包含未声明字段。'))
    const previous = currentById.get(id) || {}
    const context = configurationContext(configuration.profiles.fields, source, previous)
    const result: Record<string, string> = { id }
    for (const field of configuration.profiles.fields) {
      result[field.key] = normalizeField(field, source, previous, context, Boolean(previous[field.key]), locale)
    }
    return result
  })
  const rootContext = configurationContext(configuration.fields, submittedValues, current.values)
  const values: Record<string, string> = {}
  for (const field of configuration.fields) {
    values[field.key] = normalizeField(field, submittedValues, current.values, rootContext, Boolean(current.values[field.key]), locale)
  }
  const requestedDefault = String(submittedValues.default_profile_id || '')
  const defaultId = ids.has(requestedDefault)
    ? requestedDefault
    : configuration.profiles.defaultRequired ? profiles[0]?.id || '' : ''
  if (configuration.profiles.defaultRequired && profiles.length > 0 && !defaultId) throw new Error(localized(locale, 'Select a default plugin profile.', '插件配置必须选择默认档案。'))
  return { schema_version: 1, profiles, default_profile_id: defaultId, values }
}

export function reconcilePluginConfigurationDefaultGroup(
  configurations: SeedPluginConfiguration[],
  values: ReadonlyMap<string, StoredPluginConfiguration>,
  changedConfigurationId: string,
) {
  const changedConfiguration = configurations.find((configuration) => configuration.id === changedConfigurationId)
  const group = changedConfiguration?.profiles.defaultGroup
  const result = new Map(values)
  if (!group) return result
  const grouped = configurations.filter((configuration) => configuration.profiles.defaultGroup === group)
  const changed = result.get(changedConfigurationId)
  if (changed?.default_profile_id) {
    for (const configuration of grouped) {
      if (configuration.id === changedConfigurationId) continue
      const value = result.get(configuration.id)
      if (value?.default_profile_id) result.set(configuration.id, { ...value, default_profile_id: '' })
    }
    return result
  }
  if (grouped.some((configuration) => Boolean(result.get(configuration.id)?.default_profile_id))) return result
  const fallback = grouped.find((configuration) => result.get(configuration.id)?.profiles.length)
  if (fallback) {
    const value = result.get(fallback.id)!
    result.set(fallback.id, { ...value, default_profile_id: value.profiles[0]?.id || '' })
  }
  return result
}

export function pluginConfigurationState(configuration: SeedPluginConfiguration, stored?: StoredPluginConfiguration): PluginConfigurationState {
  const value = stored || initialPluginConfiguration(configuration)
  const configuredSecrets: string[] = []
  const profiles = value.profiles.map((profile) => {
    const visible = { ...profile }
    for (const field of configuration.profiles.fields) {
      if (field.type !== 'secret') continue
      if (profile[field.key]) configuredSecrets.push(`profiles.${profile.id}.${field.key}`)
      visible[field.key] = ''
    }
    return visible
  })
  const values = { ...value.values }
  for (const field of configuration.fields) {
    if (field.type !== 'secret') continue
    if (values[field.key]) configuredSecrets.push(`values.${field.key}`)
    values[field.key] = ''
  }
  return { persisted: Boolean(stored), values: { ...values, profiles: JSON.stringify(profiles), default_profile_id: value.default_profile_id }, configuredSecrets }
}
