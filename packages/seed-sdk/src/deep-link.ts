export const seedDeepLinkScheme = 'motusai-seed'

export type SeedNavigationTarget = {
  destination: 'plugins'
  pluginId?: string
  query?: string
}

/** Builds a Seed deep link without coupling callers to the desktop implementation. */
export function createSeedDeepLink(target: SeedNavigationTarget): string {
  const url = new URL(`${seedDeepLinkScheme}://open/${target.destination}`)
  const pluginId = target.pluginId?.trim()
  const query = target.query?.trim()
  if (pluginId) url.searchParams.set('pluginId', pluginId)
  if (query) url.searchParams.set('query', query)
  return url.toString()
}
