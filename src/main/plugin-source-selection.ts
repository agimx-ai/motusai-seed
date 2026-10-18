import { compareSeedVersions } from '../shared/seed-version';

/** Highest local version wins; equal versions retain development hot reload. */
export function selectDevelopmentOverrides<T extends { installed: { id: string; version: string } }>(
  development: readonly T[],
  installed: readonly { id: string; version: string }[],
): T[] {
  const installedById = new Map(installed.map((plugin) => [plugin.id, plugin]));
  return development.filter((entry) => {
    const release = installedById.get(entry.installed.id);
    return !release || compareSeedVersions(entry.installed.version, release.version) >= 0;
  });
}
