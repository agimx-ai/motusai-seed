import type { CapsPluginDescriptor, SeedPluginRuntimeDefinition } from '../shared/contracts';
import { capabilityProtocolDescriptor, pluginCapabilitySchema } from '../shared/plugin-capability';
import Ajv, { type ValidateFunction } from 'ajv';

/** Runtime registrations, never a second author-maintained manifest. */
export class PluginCapabilityCatalog {
  private entries = new Map<string, {
    owner: string;
    capabilities: CapsPluginDescriptor[];
    events: Map<string, ValidateFunction>;
  }>();
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
    const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
    const events = new Map<string, ValidateFunction>();
    for (const capability of capabilities)
      for (const event of capability.events ?? [])
        events.set(capability.id + '\0' + event.name, ajv.compile(event.dataSchema));
    this.entries.set(plugin.package_id, { owner: this.identity(plugin), capabilities, events });
  }

  capabilities(plugin: SeedPluginRuntimeDefinition): CapsPluginDescriptor[] {
    const entry = this.entries.get(plugin.package_id);
    return entry?.owner === this.identity(plugin) ? entry.capabilities : [];
  }

  validateEvent(plugin: SeedPluginRuntimeDefinition, capability: string, event: string, data: unknown) {
    const entry = this.entries.get(plugin.package_id);
    const validator = entry?.owner === this.identity(plugin) ? entry.events.get(capability + '\0' + event) : undefined;
    return Boolean(validator?.(data));
  }

  withCapabilities(plugin: SeedPluginRuntimeDefinition) {
    return { ...plugin, capabilities: this.capabilities(plugin) };
  }
  remove(id: string) {
    this.entries.delete(id);
  }
}
