import type { SeedLocale } from './resources'

export function normalizeSeedLocale(value?: string | null): SeedLocale | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en-US'
  return undefined
}
