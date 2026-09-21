import { describe, expect, it } from 'vitest'
import type { SeedCatalogPlugin, SeedInstalledPlugin } from '../../../shared/contracts'
import { countAvailablePluginUpdates } from './plugin-updates'

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
})
