import { seedDeepLinkScheme } from '@motus-ai/seed-sdk'
import { z } from 'zod'
import type { SeedAppNavigationTarget } from '../shared/contracts'

type SeedDeepLinkParser = (url: URL) => SeedAppNavigationTarget | null

const tipIdSchema = z.uuid()
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
  ['/experience-tips', (url) => {
    if (url.searchParams.size !== 1) return null
    const tipId = tipIdSchema.safeParse(url.searchParams.get('tipId'))
    return tipId.success ? { destination: 'experience-tips', tipId: tipId.data } : null
  }],
])

export function parseSeedDeepLink(value: string): SeedAppNavigationTarget | null {
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
