import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AppUpdateStatus, SeedSnapshot } from '../../shared/contracts'
import { SeedI18nProvider } from '../i18n'
import { SettingsPage } from './SettingsPage'

function render(status: AppUpdateStatus = 'disabled', platform: NodeJS.Platform = 'darwin') {
  const snapshot = {
    appName: 'MotusAI Seed', appVersion: '0.2.8', platform, architecture: 'arm64',
    launchAtLogin: false, preventSystemSleep: false,
    update: { status, currentVersion: '0.2.8', availableVersion: '0.2.9', percent: 25 },
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

  it.each<[AppUpdateStatus, string]>([
    ['idle', '检查更新'],
    ['checking', '检查中…'],
    ['available', '下载新版本'],
    ['downloading', '下载中 25%'],
    ['downloaded', '重启更新'],
    ['up-to-date', '检查更新'],
    ['error', '下载新版本'],
  ])('preserves the normal update action when %s', (status, label) => {
    const html = render(status)
    expect(html.match(/seed-action-button/g)).toHaveLength(1)
    expect(html).toContain(label)
    expect(html).not.toContain('更新内容')
  })

  it('preserves the Windows download action', () => {
    expect(render('available', 'win32')).toContain('下载更新')
  })
})
