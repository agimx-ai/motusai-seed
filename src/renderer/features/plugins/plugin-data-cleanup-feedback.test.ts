import { describe, expect, it } from 'vitest'
import { seedI18nResources } from '../../i18n/resources'
import { pluginDataCleanupFeedback } from './plugin-data-cleanup-feedback'

describe('Plugin data cleanup feedback', () => {
  it('uses a short success message without execution statistics', () => {
    expect(pluginDataCleanupFeedback({ reset: ['a', 'b'], skipped: [], failed: [] }))
      .toEqual({ tone: 'success', key: 'settings.pluginDataCleanupResult' })
    expect(seedI18nResources['zh-CN'].app.settings.pluginDataCleanupResult).toBe('插件数据已清理。')
    expect(seedI18nResources['en-US'].app.settings.pluginDataCleanupResult).toBe('Plugin data cleaned up.')
  })
  it('warns on partial failure and errors on complete failure', () => {
    const failed = [{ id: 'a', message: '/private/path: technical error' }]
    expect(pluginDataCleanupFeedback({ reset: ['b'], skipped: [], failed }))
      .toEqual({ tone: 'warning', key: 'settings.pluginDataCleanupPartial' })
    expect(pluginDataCleanupFeedback({ reset: [], skipped: ['c'], failed }))
      .toEqual({ tone: 'error', key: 'settings.pluginDataCleanupFailed' })
  })
  it('explains protected data without calling it skipped or reporting success', () => {
    for (const reset of [[], ['b']]) {
      expect(pluginDataCleanupFeedback({ reset, skipped: ['a'], failed: [] }))
        .toEqual({ tone: 'info', key: 'settings.pluginDataCleanupPreserved' })
    }
  })
  it('uses the empty-state message when nothing was cleaned', () => {
    expect(pluginDataCleanupFeedback({ reset: [], skipped: [], failed: [] }))
      .toEqual({ tone: 'info', key: 'settings.noOrphanedPluginData' })
  })
  it.each(['zh-CN', 'en-US'] as const)('has user-facing result copy for %s', (locale) => {
    const copy = seedI18nResources[locale].app.settings
    for (const key of ['pluginDataCleanupResult', 'pluginDataCleanupPartial', 'pluginDataCleanupFailed', 'pluginDataCleanupPreserved'] as const) {
      expect(copy[key]).not.toMatch(/\{\{|跳过|Skipped|\b0\b/)
      expect(copy[key].length).toBeGreaterThan(0)
    }
  })
})
