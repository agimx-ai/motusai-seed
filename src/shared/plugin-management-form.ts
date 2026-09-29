import type { SeedPluginManagementView } from './plugin-manifest'

export type ManagementInputField = NonNullable<SeedPluginManagementView['actions'][number]['input']>['fields'][number]
export type ManagementFormValues = Record<string, string | string[] | boolean>

export function resolveManagementInitialValues(fields: ManagementInputField[], source: unknown, values: ManagementFormValues): ManagementFormValues {
  const resolved = { ...values }
  for (const field of fields) {
    if (resolved[field.key] !== undefined || !field.initialValuePath) continue
    const initial = field.initialValuePath.split('.').filter(Boolean).reduce<unknown>((current, key) => (
      current && typeof current === 'object' && !Array.isArray(current) ? (current as Record<string, unknown>)[key] : undefined
    ), source)
    if (typeof initial === 'string') resolved[field.key] = initial
    else if (field.type === 'files' && Array.isArray(initial) && initial.every((entry) => typeof entry === 'string')) resolved[field.key] = initial
  }
  return resolved
}

export function resolveManagementModelValues(toolbar: SeedPluginManagementView['toolbar'], fields: ManagementInputField[], values: ManagementFormValues): ManagementFormValues {
  const resolved = { ...values }
  for (const item of toolbar) {
    if (item.type !== 'select_field' || item.control !== 'model_select') continue
    const field = fields.find((candidate) => candidate.key === item.fieldKey)
    if (!field?.options?.length) continue
    if (!field.options.some((option) => option.value === resolved[field.key])) {
      resolved[field.key] = (field.options.find((option) => option.is_default) || field.options[0])!.value
    }
    if (item.thinkingFieldKey) {
      const selected = field.options.find((option) => option.value === resolved[field.key])
      const thinking = resolved[item.thinkingFieldKey]
      if (thinking && !selected?.thinking_levels?.includes(String(thinking) as 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')) resolved[item.thinkingFieldKey] = ''
    }
  }
  return resolved
}

const absoluteFilePath = /^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/

export function resolveManagementInputFields(fields: ManagementInputField[], source: unknown): ManagementInputField[] {
  return fields.map((field) => {
    if (field.type !== 'select' || !field.optionsPath) return field
    const options = field.optionsPath.split('.').filter(Boolean).reduce<unknown>((value, key) => (
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined
    ), source)
    const seen = new Set<string>()
    return { ...field, options: Array.isArray(options) ? options.filter((option): option is NonNullable<ManagementInputField['options']>[number] => {
      if (!option || typeof option !== 'object' || Array.isArray(option)) return false
      const entry = option as Record<string, unknown>
      const label = entry.label
      if (typeof entry.value !== 'string' || !entry.value || entry.value.length > 200 || seen.has(entry.value)
        || !label || typeof label !== 'object' || Array.isArray(label)) return false
      const localized = label as Record<string, unknown>
      if (typeof localized.en_US !== 'string' || !localized.en_US || localized.en_US.length > 100
        || typeof localized.zh_Hans !== 'string' || !localized.zh_Hans || localized.zh_Hans.length > 100) return false
      if (entry.is_default !== undefined && typeof entry.is_default !== 'boolean') return false
      if (entry.group !== undefined && entry.group !== 'seed' && entry.group !== 'custom') return false
      if (entry.icon_data_url !== undefined && (typeof entry.icon_data_url !== 'string' || entry.icon_data_url.length > 350_000
        || !/^data:image\/(?:svg\+xml|png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(entry.icon_data_url))) return false
      if (entry.thinking_levels !== undefined && (!Array.isArray(entry.thinking_levels) || entry.thinking_levels.length > 7
        || entry.thinking_levels.some((level) => !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level)))) return false
      seen.add(entry.value)
      return true
    }).slice(0, 32) : [] }
  })
}

export function managementFormArguments(fields: ManagementInputField[], values: ManagementFormValues) {
  const argumentsValue: Record<string, unknown> = {}
  for (const field of fields) {
    const value = values[field.key]
    if (field.type === 'checkbox') argumentsValue[field.key] = value === true
    else if (field.type === 'files') argumentsValue[field.key] = Array.isArray(value) ? value : []
    else if (field.type === 'number') {
      if (typeof value === 'string' && value.trim()) argumentsValue[field.key] = Number(value)
    } else argumentsValue[field.key] = typeof value === 'string' ? value : ''
  }
  return argumentsValue
}

export function invalidManagementInput(fields: ManagementInputField[], argumentsValue: Record<string, unknown>) {
  for (const field of fields) {
    const value = argumentsValue[field.key]
    const missing = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
    if (missing) {
      if (field.required) return field.key
      continue
    }
    if (field.type === 'checkbox') {
      if (typeof value !== 'boolean' || (field.required && !value)) return field.key
      continue
    }
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)
        || (field.minValue !== undefined && value < field.minValue)
        || (field.maxValue !== undefined && value > field.maxValue)) return field.key
      continue
    }
    if (field.type === 'files') {
      if (!Array.isArray(value) || value.length > 32 || value.some((path) => typeof path !== 'string'
        || path.length > field.maxLength || path.includes('\0') || !absoluteFilePath.test(path)
        || (field.accept?.length && !field.accept.some((extension) => path.toLowerCase().endsWith(extension.toLowerCase()))))) return field.key
      continue
    }
    if (typeof value !== 'string' || value.length > field.maxLength || value.includes('\0') || (field.required && !value.trim())) return field.key
    if (field.type === 'select' && !field.options?.some((option) => option.value === value)) return field.key
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return field.key
    if (field.type === 'url') {
      try { if (!['http:', 'https:'].includes(new URL(value).protocol)) return field.key }
      catch { return field.key }
    }
    if (field.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
        || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) return field.key
    }
    if (field.type === 'file') {
      if (!absoluteFilePath.test(value)) return field.key
      if (field.accept?.length && !field.accept.some((extension) => value.toLowerCase().endsWith(extension.toLowerCase()))) return field.key
    }
  }
  return null
}
