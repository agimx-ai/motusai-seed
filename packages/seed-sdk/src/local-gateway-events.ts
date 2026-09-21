export type SeedLocalPluginRuntimeState = {
  plugin_id: string
  version: string
  state: 'ready' | 'failed'
  configuration_revision?: string
}

export type SeedLocalGatewaySnapshot = {
  type: 'gateway.ready'
  protocol_version: 1
  plugins: SeedLocalPluginRuntimeState[]
}

export type SeedLocalGatewayEvent =
  | { type: 'plugin.runtime.changed'; plugin: SeedLocalPluginRuntimeState | { plugin_id: string; state: 'unavailable' } }
  | { type: 'plugin.configuration.changed'; plugin_id: string; configuration_revision: string }
  | { type: 'client.authorization.changed'; client_id: string; installation_id: string; plugin_ids: string[]; state: 'authorized' | 'revoked' }
