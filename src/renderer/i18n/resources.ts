import type { Resource } from 'i18next'
import type { SeedLanguagePreference, SeedLocale } from '../../shared/contracts'
import enUSApp from './locales/en-US/app.json'
import zhCNApp from './locales/zh-CN/app.json'

export const seedLocales = ['zh-CN', 'en-US'] as const
export type { SeedLanguagePreference, SeedLocale }
export const defaultSeedLocale: SeedLocale = 'zh-CN'

export const seedI18nResources = {
  'zh-CN': { app: zhCNApp },
  'en-US': { app: enUSApp },
} as const satisfies Resource
