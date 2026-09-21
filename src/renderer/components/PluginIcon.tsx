import type { SeedCatalogPlugin, SeedInstalledPlugin } from '../../shared/contracts'
import { AdaptiveIcon } from './ResourceCard'

export function PluginIcon({ iconUrl, iconDarkUrl, large = false }: {
  iconUrl?: string
  iconDarkUrl?: string
  large?: boolean
}) {
  return <AdaptiveIcon iconUrl={iconUrl} iconDarkUrl={iconDarkUrl} large={large} />
}

export function InstalledPluginIcon({ plugin, large = false }: {
  plugin: SeedInstalledPlugin
  large?: boolean
}) {
  return <PluginIcon iconUrl={plugin.iconDataUrl} iconDarkUrl={plugin.iconDarkDataUrl} large={large} />
}

export function CatalogPluginIcon({ plugin, large = false }: {
  plugin: SeedCatalogPlugin
  large?: boolean
}) {
  return <PluginIcon iconUrl={plugin.iconUrl} iconDarkUrl={plugin.iconDarkUrl} large={large} />
}
