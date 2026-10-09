import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SeedSnapshot } from '../../shared/contracts'
import { SeedI18nProvider } from '../i18n'
import { SettingsPage } from './SettingsPage'

function render() {
  const snapshot = {
    appName: 'MotusAI Seed', appVersion: '0.2.7', platform: 'darwin', architecture: 'arm64',
    launchAtLogin: false, preventSystemSleep: false, update: { status: 'disabled' },
  } as SeedSnapshot
  return renderToStaticMarkup(<SeedI18nProvider><SettingsPage snapshot={snapshot} themePreference="system" resolvedTheme="light" onThemeChange={() => {}} onPreventSystemSleepChange={() => {}} onLaunchAtLoginChange={() => {}} onCheckForUpdates={() => {}} onDownloadUpdate={() => {}} onInstallUpdate={() => {}} /></SeedI18nProvider>)
}

describe('Settings version row', () => {
  it('keeps only the update action, without a duplicate release notes entry', () => {
    const html = render()
    expect(html.match(/seed-action-button/g)).toHaveLength(1)
    expect(html).toContain('检查更新')
    expect(html).not.toContain('更新内容')
  })
})
