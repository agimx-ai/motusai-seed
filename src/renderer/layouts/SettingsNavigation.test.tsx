import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { seedI18nResources, type SeedLocale } from '../i18n/resources'
import { isSettingsView, type SettingsView } from '../lib/display'
import { SettingsNavigation } from './SettingsNavigation'

function renderNavigation(view: SettingsView, locale: SeedLocale) {
  const instance = i18next.createInstance()
  void instance.init({ resources: seedI18nResources, defaultNS: 'app', lng: locale, initAsync: false })
  return renderToStaticMarkup(<I18nextProvider i18n={instance}><SettingsNavigation view={view} onNavigate={() => {}} /></I18nextProvider>)
}

describe('Settings navigation categories', () => {
  it('matches the measured 30px rows with 1px gaps and preserves other sizing', () => {
    const html = renderNavigation('settings', 'zh-CN')
    expect(html.match(/h-\[30px\]/g)).toHaveLength(3)
    expect(html.match(/width="16" height="16"/g)).toHaveLength(4)
    expect(html).not.toContain('width="17"')
    expect(html.match(/px-3 text-left text-\[14px\]/g)).toHaveLength(4)
    expect(html.match(/grid gap-px/g)).toHaveLength(2)
    expect(html.match(/gap-2 /g)).toHaveLength(4)
    expect(html).not.toContain('gap-2.5')
    expect(html).toContain('mb-2 mt-5 px-1')
  })

  it('separates muted medium-weight group headings from normal foreground choices', () => {
    const html = renderNavigation('settings', 'zh-CN')
    expect(html.match(/text-\[14px\] font-medium text-muted-foreground/g)).toHaveLength(2)
    const groups = html.match(/<nav[^>]*>(.*?)<\/nav>/g)!.join('')
    expect(groups.match(/text-\[14px\] font-normal/g)).toHaveLength(3)
    expect(groups).not.toContain('text-muted-foreground')
    expect(groups.match(/bg-transparent text-foreground/g)).toHaveLength(2)
  })

  it.each(['zh-CN', 'en-US'] as const)('places plugins under integrations, not personal, in %s', (locale) => {
    const html = renderNavigation('plugin-settings', locale)
    const labels = seedI18nResources[locale].app.nav
    const personal = html.match(new RegExp(`<nav[^>]*aria-label="${labels.personal}"[^>]*>(.*?)</nav>`))?.[1]
    const integrations = html.match(new RegExp(`<nav[^>]*aria-label="${labels.integrations}"[^>]*>(.*?)</nav>`))?.[1]
    expect(personal).toContain(labels.general)
    expect(personal).toContain(labels.profile)
    expect(personal).not.toContain(labels.plugins)
    expect(integrations).toContain(labels.plugins)
    expect(integrations).toContain('bg-[var(--sidebar-item-active)]')
    expect(personal).not.toContain('bg-[var(--sidebar-item-active)] text-foreground')
    expect(html).toContain(labels.backToApp)
  })

  it.each(['settings', 'usage', 'plugin-settings'] as const)('keeps %s inside settings and selects one item', (view) => {
    expect(isSettingsView(view)).toBe(true)
    const html = renderNavigation(view, 'zh-CN')
    expect(html.match(/bg-\[var\(--sidebar-item-active\)\] text-foreground/g)).toHaveLength(1)
  })

  it.each(['overview', 'plugins', 'activity'] as const)('keeps the main %s view outside settings', (view) => {
    expect(isSettingsView(view)).toBe(false)
  })
})
