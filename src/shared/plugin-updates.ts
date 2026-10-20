import type { SeedCatalogPlugin, SeedInstalledPlugin } from './contracts';
import { compareSeedVersions } from './seed-version';

export function isCatalogPluginInstallable(plugin: SeedCatalogPlugin) {
  const latestRelease = plugin.versions.find((candidate) => candidate.version === plugin.latestVersion);
  return (
    plugin.compatible &&
    (latestRelease?.runtimeKind === 'sandboxed-web' ||
      (latestRelease?.runtimeKind === 'native-host' && plugin.publisherType === 'official'))
  );
}

export function getAvailablePluginUpdates(
  installedPlugins: SeedInstalledPlugin[],
  catalogPlugins: SeedCatalogPlugin[],
) {
  const installedById = new Map(installedPlugins.map((plugin) => [plugin.id, plugin]));
  return catalogPlugins.filter((plugin) => {
    const installed = installedById.get(plugin.id);
    return Boolean(
      installed &&
        compareSeedVersions(installed.version, plugin.latestVersion) < 0 &&
        isCatalogPluginInstallable(plugin),
    );
  });
}

export function countAvailablePluginUpdates(
  installedPlugins: SeedInstalledPlugin[],
  catalogPlugins: SeedCatalogPlugin[],
) {
  return getAvailablePluginUpdates(installedPlugins, catalogPlugins).length;
}
