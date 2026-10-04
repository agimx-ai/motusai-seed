import type { PluginDataResetResult } from '../../../shared/contracts'

export function pluginDataCleanupFeedback(result: PluginDataResetResult) {
  if (result.failed.length) {
    return result.reset.length
      ? { tone: 'warning', key: 'settings.pluginDataCleanupPartial' } as const
      : { tone: 'error', key: 'settings.pluginDataCleanupFailed' } as const
  }
  if (result.skipped.length) {
    return { tone: 'info', key: 'settings.pluginDataCleanupPreserved' } as const
  }
  if (!result.reset.length) {
    return { tone: 'info', key: 'settings.noOrphanedPluginData' } as const
  }
  return { tone: 'success', key: 'settings.pluginDataCleanupResult' } as const
}
