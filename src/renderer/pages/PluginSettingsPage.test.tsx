// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SeedSnapshot } from '../../shared/contracts'
import { SeedI18nProvider } from '../i18n'
import { PluginSettingsPage } from './PluginSettingsPage'
import { SettingsPage } from './SettingsPage'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Plugin settings placement', () => {
  it('renders the shared cleanup setting on the plugin settings page', () => {
    const html = renderToStaticMarkup(<SeedI18nProvider><PluginSettingsPage catalog={[]} busy={false} autoUpdatePlugins={true} onAutoUpdatePluginsChange={() => {}} onListOrphanedPluginData={async () => []} onResetOrphanedPluginData={async () => true} /></SeedI18nProvider>)
    expect(html).toContain('清理插件数据')
    expect(html).toContain('清理已卸载插件保留的数据，不影响已安装插件。')
    expect(html).not.toContain('界面主题')
    expect(html).not.toContain('登录时启动')
  })

  it('lets users toggle automatic updates by keyboard and blocks changes during a pending save', async () => {
    vi.stubGlobal('motusSeed', {
      snapshot: async () => ({ locale: 'zh-CN', languagePreference: 'zh-CN' }),
      subscribe: () => () => {},
    })
    const changed = vi.fn()
    function Page({ busy }: { busy: boolean }) {
      const [enabled, setEnabled] = useState(true)
      return <SeedI18nProvider><PluginSettingsPage catalog={[]} busy={busy} autoUpdatePlugins={enabled}
        onAutoUpdatePluginsChange={() => { changed(); setEnabled(!enabled) }}
        onListOrphanedPluginData={async () => []} onResetOrphanedPluginData={async () => true} /></SeedI18nProvider>
    }
    const user = userEvent.setup()
    const page = render(<Page busy={false} />)
    const toggle = page.getByRole('switch', { name: '自动更新插件' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await user.tab()
    expect(document.activeElement).toBe(toggle)
    await user.keyboard(' ')
    expect(changed).toHaveBeenCalledOnce()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    page.rerender(<Page busy={true} />)
    await user.click(toggle)
    expect(changed).toHaveBeenCalledOnce()
    page.rerender(<Page busy={false} />)
    await user.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
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
