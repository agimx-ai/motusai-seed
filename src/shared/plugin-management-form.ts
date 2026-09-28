import type { SeedPluginManagementView } from './plugin-manifest'

export type ManagementInputField = NonNullable<SeedPluginManagementView['actions'][number]['input']>['fields'][number]
export type ManagementFormValues = Record<string, string | string[] | boolean>

const absoluteFilePath = /^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/

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
