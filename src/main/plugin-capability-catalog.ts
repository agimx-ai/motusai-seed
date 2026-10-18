import type { CapsPluginDescriptor, SeedPluginRuntimeDefinition } from '../shared/contracts';
import { capabilityProtocolDescriptor, pluginCapabilitySchema } from '../shared/plugin-capability';

/** Runtime registrations, never a second author-maintained manifest. */
export class PluginCapabilityCatalog {
  private entries = new Map<string, { owner: string; capabilities: CapsPluginDescriptor[] }>();
  private identity(plugin: SeedPluginRuntimeDefinition) {
    return JSON.stringify(plugin);
  }

  publish(plugin: SeedPluginRuntimeDefinition, input: unknown) {
    if (
      plugin.api_version !== 2 ||
      !Array.isArray(input) ||
      input.length > 128 ||
      JSON.stringify(input).length > 2 * 1024 * 1024
    )
      throw new Error('Invalid code capability publication.');
    const definitions = input.map((source) => pluginCapabilitySchema.parse(source));
    if (new Set(definitions.map((definition) => definition.id)).size !== definitions.length)
      throw new Error('Duplicate code capability publication.');
    const capabilities = definitions.map((definition) =>
      capabilityProtocolDescriptor(definition, plugin.sdk_manifest?.translations),
    );
    this.entries.set(plugin.package_id, { owner: this.identity(plugin), capabilities });
  }

  capabilities(plugin: SeedPluginRuntimeDefinition): CapsPluginDescriptor[] {
    const entry = this.entries.get(plugin.package_id);
    return entry?.owner === this.identity(plugin) ? entry.capabilities : [];
  }

  withCapabilities(plugin: SeedPluginRuntimeDefinition) {
    return { ...plugin, capabilities: this.capabilities(plugin) };
  }
  remove(id: string) {
    this.entries.delete(id);
  }
}
