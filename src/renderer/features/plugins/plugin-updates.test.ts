import { describe, expect, it, vi } from 'vitest'
import type { SeedCatalogPlugin, SeedInstalledPlugin } from '../../../shared/contracts'
import { countAvailablePluginUpdates, getAvailablePluginUpdates, updatePluginsSequentially } from './plugin-updates'

function installed(id: string, version: string, status: SeedInstalledPlugin['status'] = 'ready') {
  return { id, version, status } as SeedInstalledPlugin
}

function catalog(id: string, latestVersion: string, options: { compatible?: boolean; publisherType?: SeedCatalogPlugin['publisherType'] } = {}) {
  const publisherType = options.publisherType ?? 'official'
  return {
    id,
    latestVersion,
    compatible: options.compatible ?? true,
    publisherType,
    versions: [{ version: latestVersion, runtimeKind: 'native-host' }],
  } as SeedCatalogPlugin
}

describe('countAvailablePluginUpdates', () => {
  it('counts installed plugins with an actionable newer catalog version', () => {
    expect(countAvailablePluginUpdates(
      [installed('current', '1.0.0'), installed('outdated', '1.0.0')],
      [catalog('current', '1.0.0'), catalog('outdated', '1.1.0')],
    )).toBe(1)
  })

  it('does not count missing, incompatible, or non-installable plugins', () => {
    expect(countAvailablePluginUpdates(
      [installed('incompatible', '1.0.0', 'incompatible'), installed('community-native', '1.0.0')],
      [catalog('missing', '2.0.0'), catalog('incompatible', '2.0.0'), catalog('community-native', '2.0.0', { publisherType: 'community' })],
    )).toBe(0)
  })

  it('selects only installed, compatible updates from the entire supplied catalog', () => {
    const updates = getAvailablePluginUpdates(
      [installed('current', '1.0.0'), installed('update', '1.0.0'), installed('blocked', '1.0.0')],
      [catalog('new', '1.0.0'), catalog('current', '1.0.0'), catalog('blocked', '2.0.0', { compatible: false }), catalog('update', '2.0.0')],
    )
    expect(updates.map((plugin) => plugin.id)).toEqual(['update'])
  })
})

describe('updatePluginsSequentially', () => {
  it('waits for each install and targets the latest catalog version', async () => {
    let completeFirst!: (value: boolean) => void
    const install = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { completeFirst = resolve }))
      .mockResolvedValueOnce(true)
    const result = updatePluginsSequentially([catalog('first', '2.0.0'), catalog('second', '3.0.0')], install)
    expect(install.mock.calls).toEqual([['first', '2.0.0']])
    completeFirst(true)
    await expect(result).resolves.toEqual({ updated: 2, cancelled: 0, failed: [] })
    expect(install.mock.calls).toEqual([['first', '2.0.0'], ['second', '3.0.0']])
  })

  it('continues after a failure or cancellation and reports accurate results', async () => {
    const reason = new Error('Download failed')
    const failed = catalog('failed', '2.0.0')
    const install = vi.fn().mockRejectedValueOnce(reason).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await expect(updatePluginsSequentially([failed, catalog('cancelled', '2.0.0'), catalog('updated', '2.0.0')], install))
      .resolves.toEqual({ updated: 1, cancelled: 1, failed: [{ plugin: failed, reason }] })
    expect(install).toHaveBeenCalledTimes(3)
  })

  it('does not invoke installation when there are no updates', async () => {
    const install = vi.fn()
    await expect(updatePluginsSequentially([], install)).resolves.toEqual({ updated: 0, cancelled: 0, failed: [] })
    expect(install).not.toHaveBeenCalled()
  })
})
