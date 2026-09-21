import type { SeedCatalogPlugin, SeedInstalledPlugin } from '../../../shared/contracts'

export function isCatalogPluginInstallable(plugin: SeedCatalogPlugin) {
  const latestRelease = plugin.versions.find((candidate) => candidate.version === plugin.latestVersion)
  return plugin.compatible && (latestRelease?.runtimeKind === 'sandboxed-web'
    || latestRelease?.runtimeKind === 'native-host' && plugin.publisherType === 'official')
}

export function countAvailablePluginUpdates(installedPlugins: SeedInstalledPlugin[], catalogPlugins: SeedCatalogPlugin[]) {
  const installedById = new Map(installedPlugins.map((plugin) => [plugin.id, plugin]))
  return catalogPlugins.reduce((count, plugin) => {
    const installed = installedById.get(plugin.id)
    const available = Boolean(
      installed
      && installed.status !== 'incompatible'
      && installed.version !== plugin.latestVersion
      && isCatalogPluginInstallable(plugin),
    )
    return count + Number(available)
  }, 0)
}
