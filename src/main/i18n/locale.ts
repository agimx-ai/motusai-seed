import { app } from 'electron'
import type { SeedLanguagePreference, SeedLocale } from '../../shared/contracts'

export function resolveSupportedSeedLocale(
  preference: SeedLanguagePreference,
  preferredSystemLanguages: string[],
  applicationLocale: string,
): SeedLocale {
  if (preference !== 'system') return preference
  const preferred = preferredSystemLanguages[0] || applicationLocale
  return preferred.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

export function resolveSeedLocale(preference: SeedLanguagePreference): SeedLocale {
  return resolveSupportedSeedLocale(preference, app.getPreferredSystemLanguages(), app.getLocale())
}
