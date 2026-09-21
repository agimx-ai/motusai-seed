import type { PluginCapabilityGrant, SeedPluginRuntimeDefinition } from './contracts'

export function pluginCapabilityGrantIsDeclared(grant: PluginCapabilityGrant, plugins: SeedPluginRuntimeDefinition[]) {
  if (!plugins.some((plugin) => plugin.package_id === grant.consumerPluginId)) return false
  const provider = plugins.find((plugin) => plugin.package_id === grant.providerPluginId)
  return Boolean(provider?.capabilities.some((capability) => capability.id === grant.capability
    && capability.version === grant.capabilityVersion
    && capability.methods.some((method) => method.name === grant.method)))
}
