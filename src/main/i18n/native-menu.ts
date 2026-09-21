import type { SeedLanguagePreference } from '../../shared/contracts'
import enUS from './locales/en-US/menu.json'
import zhCN from './locales/zh-CN/menu.json'
import { resolveSeedLocale } from './locale'

export type NativeMenuMessages = typeof zhCN

export function nativeMenuMessages(preference: SeedLanguagePreference): NativeMenuMessages {
  return resolveSeedLocale(preference) === 'zh-CN' ? zhCN : enUS
}

export function nativeMenuLabel(template: string, appName: string) {
  return template.replaceAll('{{appName}}', appName)
}
