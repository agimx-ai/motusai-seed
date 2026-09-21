import { describe, expect, it } from 'vitest'
import { resolveSupportedSeedLocale } from './locale'

describe('Seed locale', () => {
  it('uses the first preferred system language instead of the application locale', () => {
    expect(resolveSupportedSeedLocale('system', ['zh-Hans-CN'], 'en-US')).toBe('zh-CN')
    expect(resolveSupportedSeedLocale('system', ['en-US', 'zh-Hans-CN'], 'zh-CN')).toBe('en-US')
  })

  it('honors an explicit language preference', () => {
    expect(resolveSupportedSeedLocale('zh-CN', ['en-US'], 'en-US')).toBe('zh-CN')
    expect(resolveSupportedSeedLocale('en-US', ['zh-Hans-CN'], 'zh-CN')).toBe('en-US')
  })

  it('falls back to the application locale when preferred languages are unavailable', () => {
    expect(resolveSupportedSeedLocale('system', [], 'zh-CN')).toBe('zh-CN')
    expect(resolveSupportedSeedLocale('system', [], 'en-US')).toBe('en-US')
  })
})
