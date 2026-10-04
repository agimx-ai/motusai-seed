import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SeedI18nProvider } from '../../i18n'
import { PluginDataResetSetting } from './PluginDataResetSetting'
import { seedI18nResources } from '../../i18n/resources'

describe('Plugin data settings entry', () => {
  it('uses the existing settings row and makes the orphan-only scope explicit', () => {
    const html = renderToStaticMarkup(<SeedI18nProvider><PluginDataResetSetting catalog={[]} disabled={false} onList={async () => []} onReset={async () => true} /></SeedI18nProvider>)
    expect(html).toContain('清理插件数据')
    expect(html).toContain('清理已卸载插件保留的数据，不影响已安装插件。')
    expect(html).toContain('清理')
    expect(html).not.toContain('清理…')
    expect(html).not.toContain('重置')
    expect(html).not.toContain('alertdialog')
  })
  it.each(['zh-CN', 'en-US'] as const)('uses consistent cleanup terminology in %s', (locale) => {
    const copy = seedI18nResources[locale].app.settings
    const cleanup = locale === 'zh-CN' ? '清理' : 'clean'
    for (const key of ['cleanPluginData', 'cleanPluginDataDescription', 'cleanPluginDataAction', 'cleanPluginDataConfirmTitle', 'cleanPluginDataConfirmAction', 'noOrphanedPluginData', 'pluginDataCleanupResult'] as const) {
      expect(copy[key].toLowerCase()).toContain(cleanup)
      expect(copy[key]).not.toMatch(/重置|删除|遗留|Reset|Delete|[Ll]eftover/)
    }
    expect(copy).not.toHaveProperty('deletePluginData')
    expect(copy).not.toHaveProperty('resetPluginData')
  })
})
