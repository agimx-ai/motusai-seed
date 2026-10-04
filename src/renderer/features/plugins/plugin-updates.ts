import type { SeedCatalogPlugin, SeedInstalledPlugin } from '../../../shared/contracts'

export function isCatalogPluginInstallable(plugin: SeedCatalogPlugin) {
  const latestRelease = plugin.versions.find((candidate) => candidate.version === plugin.latestVersion)
  return plugin.compatible && (latestRelease?.runtimeKind === 'sandboxed-web'
    || latestRelease?.runtimeKind === 'native-host' && plugin.publisherType === 'official')
}

export function getAvailablePluginUpdates(installedPlugins: SeedInstalledPlugin[], catalogPlugins: SeedCatalogPlugin[]) {
  const installedById = new Map(installedPlugins.map((plugin) => [plugin.id, plugin]))
  return catalogPlugins.filter((plugin) => {
    const installed = installedById.get(plugin.id)
    return Boolean(
      installed
      && installed.status !== 'incompatible'
      && installed.version !== plugin.latestVersion
      && isCatalogPluginInstallable(plugin),
    )
  })
}

export function countAvailablePluginUpdates(installedPlugins: SeedInstalledPlugin[], catalogPlugins: SeedCatalogPlugin[]) {
  return getAvailablePluginUpdates(installedPlugins, catalogPlugins).length
}

export async function updatePluginsSequentially(
  plugins: SeedCatalogPlugin[],
  install: (pluginId: string, version: string) => Promise<boolean>,
) {
  const result = { updated: 0, cancelled: 0, failed: [] as Array<{ plugin: SeedCatalogPlugin; reason: unknown }> }
  for (const plugin of plugins) {
    try {
      if (await install(plugin.id, plugin.latestVersion)) result.updated += 1
      else result.cancelled += 1
    } catch (reason) {
      result.failed.push({ plugin, reason })
    }
  }
  return result
}
