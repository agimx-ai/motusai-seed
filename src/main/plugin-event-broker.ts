import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AvailablePluginEvent, PluginEvent } from '@motus-ai/seed-sdk';
import type { SeedPluginRuntimeDefinition } from '../shared/contracts';
import { pluginConsumesEvent } from '../shared/plugin-capability';
import type { PluginCapabilityCatalog } from './plugin-capability-catalog';

const identifier = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
const subscriptionInput = z.object({
  provider_plugin_id: z.string().min(1).max(256),
  capability: identifier,
  event: identifier,
  version: z.number().int().positive(),
}).strict();
type Input = z.infer<typeof subscriptionInput>;
type Delivery = { done: boolean; event?: PluginEvent };
type Subscription = {
  owner: string;
  ownerIdentity: SeedPluginRuntimeDefinition;
  providerIdentity: SeedPluginRuntimeDefinition;
  input: Input;
  contract: string;
  assertActive(): void;
  queue: Array<{ event: PluginEvent; bytes: number }>;
  bytes: number;
  error?: Error;
  pending?: { resolve(value: Delivery): void; reject(error: Error): void };
};

function failure(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

/** Online, bounded fan-out. Business state, recovery cursors and processing stay with plugins. */
export class PluginEventBroker {
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(
    private readonly plugins: () => SeedPluginRuntimeDefinition[],
    private readonly catalog: PluginCapabilityCatalog,
  ) {}

  private plugin(id: string) {
    const plugin = this.plugins().find((candidate) => candidate.package_id === id && candidate.has_service);
    if (!plugin || plugin.api_version !== 2)
      throw failure('plugin_event_unavailable', 'Plugin event owner is unavailable.');
    return plugin;
  }

  private offered(provider: SeedPluginRuntimeDefinition, input: Pick<Input, 'capability' | 'event' | 'version'>) {
    const capability = this.catalog.capabilities(provider).find((entry) => entry.id === input.capability);
    const event = capability?.events?.find((entry) => entry.name === input.event && entry.version === input.version);
    if (!capability || capability.exposure === 'local' || !event)
      throw failure('plugin_event_unavailable', 'The plugin does not offer this public event version.');
    return { capability, event };
  }

  private contract(consumer: SeedPluginRuntimeDefinition, input: Input) {
    const provider = this.plugin(input.provider_plugin_id);
    const { capability, event } = this.offered(provider, input);
    if (provider.package_id === consumer.package_id || !pluginConsumesEvent(consumer, capability, event.name))
      throw failure('plugin_event_denied', 'The plugin has not declared consumption of this public event.');
    return { provider, fingerprint: JSON.stringify([capability.version, event]) };
  }

  private validate(subscription: Subscription) {
    subscription.assertActive();
    const consumer = this.plugin(subscription.owner);
    const current = this.contract(consumer, subscription.input);
    if (consumer !== subscription.ownerIdentity || current.provider !== subscription.providerIdentity ||
        current.fingerprint !== subscription.contract)
      throw failure('plugin_event_contract_changed', 'Plugin event subscription contract changed. Subscribe again.');
  }

  private fail(subscription: Subscription, error: unknown) {
    subscription.error = error instanceof Error ? error : new Error(String(error));
    subscription.queue = [];
    subscription.bytes = 0;
    subscription.pending?.reject(subscription.error);
    subscription.pending = undefined;
  }

  /** Recheck existing grants when code registrations are published or withdrawn. */
  reconcile() {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.error) continue;
      try {
        this.validate(subscription);
      } catch (error) {
        this.fail(subscription, error);
      }
    }
  }

  closePlugin(packageId: string) {
    for (const [id, subscription] of this.subscriptions) {
      if (subscription.owner === packageId) {
        this.subscriptions.delete(id);
        subscription.pending?.resolve({ done: true });
      } else if (subscription.input.provider_plugin_id === packageId) {
        this.fail(subscription, failure('plugin_event_provider_stopped', 'Plugin event provider stopped. Subscribe again.'));
      }
    }
  }

  clear() {
    for (const subscription of this.subscriptions.values()) subscription.pending?.resolve({ done: true });
    this.subscriptions.clear();
  }

  async invoke(owner: string, args: Record<string, unknown>, assertActive: () => void = () => {}) {
    assertActive();
    const operation = z.enum(['list', 'publish', 'subscribe', 'next', 'unsubscribe']).parse(args.operation);
    if (operation === 'next' || operation === 'unsubscribe') {
      const id = z.string().uuid().parse(args.id);
      const subscription = this.subscriptions.get(id);
      if (subscription && subscription.owner !== owner)
        throw failure('plugin_event_denied', 'Plugin event subscription belongs to another plugin.');
      if (operation === 'unsubscribe') {
        this.subscriptions.delete(id);
        subscription?.pending?.resolve({ done: true });
        return null;
      }
      if (!subscription) throw failure('plugin_event_subscription_closed', 'Plugin event subscription is closed.');
      try {
        if (subscription.error) throw subscription.error;
        this.validate(subscription);
      } catch (error) {
        this.subscriptions.delete(id);
        this.fail(subscription, error);
        throw error;
      }
      if (subscription.pending) throw failure('plugin_event_concurrent_read', 'Only one event read may be pending.');
      const next = subscription.queue.shift();
      if (next) {
        subscription.bytes -= next.bytes;
        return { done: false, event: structuredClone(next.event) };
      }
      return await new Promise<Delivery>((resolve, reject) => { subscription.pending = { resolve, reject }; });
    }
    const plugin = this.plugin(owner);
    if (operation === 'list') {
      const offered: AvailablePluginEvent[] = [];
      for (const provider of this.plugins()) {
        if (!provider.has_service || provider.package_id === owner) continue;
        for (const capability of this.catalog.capabilities(provider))
          for (const event of capability.events ?? [])
            if (pluginConsumesEvent(plugin, capability, event.name))
              offered.push({ ...event, provider_plugin_id: provider.package_id,
                capability: capability.id, capability_version: capability.version });
      }
      return structuredClone(offered);
    }
    if (operation === 'subscribe') {
      const input = subscriptionInput.parse(args.subscription);
      const contract = this.contract(plugin, input);
      if (this.subscriptions.size >= 256 || [...this.subscriptions.values()].filter((entry) => entry.owner === owner).length >= 64)
        throw failure('plugin_event_limit', 'Plugin event subscription limit reached.');
      const id = randomUUID();
      this.subscriptions.set(id, {
        owner, ownerIdentity: plugin, providerIdentity: contract.provider,
        input, contract: contract.fingerprint, assertActive, queue: [], bytes: 0,
      });
      return { id };
    }
    const publication = z.object({
      capability: identifier, event: identifier, version: z.number().int().positive(), data: z.json(),
    }).strict().parse(args.publication);
    const { capability, event: definition } = this.offered(plugin, publication);
    const bytes = Buffer.byteLength(JSON.stringify(publication));
    if (bytes > 65_536) throw failure('plugin_event_size', 'Plugin event exceeds the 64 KiB size limit.');
    if (!this.catalog.validateEvent(plugin, capability.id, definition.name, publication.data))
      throw failure('plugin_event_schema', 'Plugin event data does not match its registered schema.');
    const event: PluginEvent = {
      id: randomUUID(), provider_plugin_id: owner,
      capability: capability.id, capability_version: capability.version,
      event: definition.name, event_version: definition.version,
      published_at: new Date().toISOString(), data: publication.data,
    };
    this.reconcile();
    for (const subscription of this.subscriptions.values()) {
      if (subscription.error || subscription.input.provider_plugin_id !== owner ||
          subscription.input.capability !== capability.id || subscription.input.event !== definition.name) continue;
      if (subscription.pending) {
        const pending = subscription.pending;
        subscription.pending = undefined;
        pending.resolve({ done: false, event: structuredClone(event) });
      } else if (subscription.queue.length >= 128 || subscription.bytes + bytes > 524_288) {
        this.fail(subscription, failure('plugin_event_overflow', 'Plugin event queue overflow. Resynchronize and subscribe again.'));
      } else {
        subscription.queue.push({ event, bytes });
        subscription.bytes += bytes;
      }
    }
    return structuredClone(event);
  }
}
