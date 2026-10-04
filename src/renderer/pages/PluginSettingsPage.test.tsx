import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SeedSnapshot } from '../../shared/contracts'
import { SeedI18nProvider } from '../i18n'
import { PluginSettingsPage } from './PluginSettingsPage'
import { SettingsPage } from './SettingsPage'

describe('Plugin settings placement', () => {
  it('renders the shared cleanup setting on the plugin settings page', () => {
    const html = renderToStaticMarkup(<SeedI18nProvider><PluginSettingsPage catalog={[]} busy={false} onListOrphanedPluginData={async () => []} onResetOrphanedPluginData={async () => true} /></SeedI18nProvider>)
    expect(html).toContain('清理插件数据')
    expect(html).toContain('清理已卸载插件保留的数据，不影响已安装插件。')
    expect(html).not.toContain('界面主题')
    expect(html).not.toContain('登录时启动')
  })

  it('keeps general settings without a duplicate cleanup entry', () => {
    const snapshot = {
      appName: 'MotusAI Seed', appVersion: '0.2.6', platform: 'darwin', architecture: 'arm64',
      launchAtLogin: false, preventSystemSleep: false, update: { status: 'disabled' },
    } as SeedSnapshot
    const html = renderToStaticMarkup(<SeedI18nProvider><SettingsPage snapshot={snapshot} themePreference="system" resolvedTheme="dark" onThemeChange={() => {}} onPreventSystemSleepChange={() => {}} onLaunchAtLoginChange={() => {}} onCheckForUpdates={() => {}} onDownloadUpdate={() => {}} onInstallUpdate={() => {}} /></SeedI18nProvider>)
    expect(html).toContain('界面主题')
    expect(html).toContain('语言')
    expect(html).toContain('版本')
    expect(html).not.toContain('清理插件数据')
  })
})
