import { isDeepStrictEqual } from 'node:util'
import type { SeedPluginRuntimeDefinition } from '../shared/contracts'

function withoutConfigurationRevision(plugin: SeedPluginRuntimeDefinition) {
  const { configuration_revision: _configurationRevision, ...definition } = plugin
  return definition
}

export function currentNativePluginRuntimeDefinition(
  requested: SeedPluginRuntimeDefinition | undefined,
  configured: SeedPluginRuntimeDefinition | undefined,
) {
  if (!requested || !configured) return null
  if (isDeepStrictEqual(requested, configured)) return configured
  if (requested.configuration_revision === configured.configuration_revision) return null
  return isDeepStrictEqual(withoutConfigurationRevision(requested), withoutConfigurationRevision(configured))
    ? configured
    : null
}
