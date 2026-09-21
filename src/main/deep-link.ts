import {
  seedDeepLinkScheme,
  type SeedNavigationTarget,
} from '@motusai/seed-sdk'

type SeedDeepLinkParser = (url: URL) => SeedNavigationTarget | null

const routes = new Map<string, SeedDeepLinkParser>([
  ['/plugins', (url) => {
    const pluginId = url.searchParams.get('pluginId')?.trim()
    const query = url.searchParams.get('query')?.trim()
    if ((pluginId && pluginId.length > 200) || (query && query.length > 200)) return null
    return {
      destination: 'plugins',
      ...(pluginId ? { pluginId } : {}),
      ...(query ? { query } : {}),
    }
  }],
])

export function parseSeedDeepLink(value: string): SeedNavigationTarget | null {
  try {
    const url = new URL(value)
    if (
      url.protocol !== `${seedDeepLinkScheme}:`
      || url.hostname !== 'open'
      || url.username
      || url.password
      || url.port
      || url.hash
    ) return null
    const route = routes.get(url.pathname)
    if (!route) return null
    return route(url)
  } catch {
    return null
  }
}

export function seedDeepLinkFromArguments(argumentsValue: string[]) {
  return argumentsValue.map(parseSeedDeepLink).find((request) => request !== null) ?? null
}
