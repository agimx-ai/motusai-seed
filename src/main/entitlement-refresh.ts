type InstalledPlugin = { id: string; visibility: 'public' | 'organization' }
type Entitlement = { plugin_id: string; visibility: 'public' | 'organization'; authorized: boolean }

export function entitlementRefreshChangesRuntime(
  installed: readonly InstalledPlugin[],
  authorized: ReadonlySet<string>,
  items: readonly Entitlement[],
  expired: boolean,
): boolean {
  if (expired) return true
  const nextAuthorized = new Set(items.filter((item) => item.authorized).map((item) => item.plugin_id))
  if (nextAuthorized.size !== authorized.size || [...nextAuthorized].some((id) => !authorized.has(id))) return true
  const visibilityById = new Map(items.map((item) => [item.plugin_id, item.visibility]))
  return installed.some((plugin) => {
    const visibility = visibilityById.get(plugin.id)
    return visibility !== undefined && visibility !== plugin.visibility
  })
}
