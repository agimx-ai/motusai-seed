import { describe, expect, it } from 'vitest'
import type { SeedCatalogPlugin, SeedInstalledPlugin } from './contracts'
import { countAvailablePluginUpdates, getAvailablePluginUpdates } from './plugin-updates'

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
  it('only offers versions newer than the selected local source, including development plugins', () => {
    const development = { ...installed('dev', '0.2.0'), source: 'development' as const }
    expect(countAvailablePluginUpdates([development], [catalog('dev', '1.1.0')])).toBe(1)
    expect(countAvailablePluginUpdates([{ ...development, version: '1.1.0' }], [catalog('dev', '1.1.0')])).toBe(0)
    expect(countAvailablePluginUpdates([{ ...development, version: '1.2.0' }], [catalog('dev', '1.1.0')])).toBe(0)
    expect(countAvailablePluginUpdates([installed('formal', '1.2.0')], [catalog('formal', '1.1.0')])).toBe(0)
  })

  it('counts installed plugins with an actionable newer catalog version', () => {
    expect(countAvailablePluginUpdates(
      [installed('current', '1.0.0'), installed('outdated', '1.0.0')],
      [catalog('current', '1.0.0'), catalog('outdated', '1.1.0')],
    )).toBe(1)
  })

  it('offers a compatible upgrade for an incompatible installed version', () => {
    const previous = installed('migrating', '1.0.0', 'incompatible')
    const next = catalog('migrating', '2.0.0')
    expect(getAvailablePluginUpdates([previous], [next])).toEqual([next])
    expect(countAvailablePluginUpdates([previous], [next])).toBe(1)
    expect(countAvailablePluginUpdates([previous], [catalog('migrating', '1.0.0')])).toBe(0)
    expect(countAvailablePluginUpdates([previous], [catalog('migrating', '0.9.0')])).toBe(0)
  })

  it('does not count missing plugins or incompatible/non-installable target releases', () => {
    expect(countAvailablePluginUpdates(
      [installed('incompatible', '1.0.0', 'incompatible'), installed('community-native', '1.0.0')],
      [catalog('missing', '2.0.0'), catalog('incompatible', '2.0.0', { compatible: false }), catalog('community-native', '2.0.0', { publisherType: 'community' })],
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
