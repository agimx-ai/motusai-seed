import { describe, expect, it } from 'vitest'
import { seedI18nResources } from './resources'
import { normalizeSeedLocale } from './runtime'

function leafKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))
}

describe('Seed i18n', () => {
  it('keeps locale resources structurally identical', () => {
    expect(leafKeys(seedI18nResources['en-US']).sort()).toEqual(leafKeys(seedI18nResources['zh-CN']).sort())
  })

  it('normalizes supported language variants', () => {
    expect(normalizeSeedLocale('zh-Hans-CN')).toBe('zh-CN')
    expect(normalizeSeedLocale('en-GB')).toBe('en-US')
    expect(normalizeSeedLocale('fr-FR')).toBeUndefined()
  })

  it('discloses that diagnostic uploads include the latest recording in both languages', () => {
    expect(seedI18nResources['en-US'].app.activity.uploadLogsDescription).toContain("latest recording's")
    expect(seedI18nResources['zh-CN'].app.activity.uploadLogsDescription).toContain('最近一次录音')
  })
})
