import { describe, expect, it, vi } from 'vitest';
import { createPluginEventClient, type CapabilityDefinition } from '@motus-ai/seed-sdk';
import type { SeedPluginRuntimeDefinition } from '../shared/contracts';
import { PluginCapabilityCatalog } from './plugin-capability-catalog';
import { PluginEventBroker } from './plugin-event-broker';

const definition: CapabilityDefinition = {
  id: 'probe', version: 1, exposure: 'plugin', methods: [],
  events: [{ name: 'changed', version: 1, dataSchema: {
    type: 'object', additionalProperties: false,
    properties: { value: { type: 'integer' } }, required: ['value'],
  } }],
};
const input = { provider_plugin_id: 'com.example.source', capability: 'probe', event: 'changed', version: 1 };

function fixture() {
  const source = { package_id: input.provider_plugin_id, api_version: 2, has_service: true, consumes: [] } as unknown as SeedPluginRuntimeDefinition;
  const consumer = (id: string): SeedPluginRuntimeDefinition => ({ ...source, package_id: id, consumes: [{ capability: 'probe', events: ['changed'] }] });
  const first = consumer('com.example.first'), second = consumer('com.example.second');
  let plugins = [source, first, second];
  const catalog = new PluginCapabilityCatalog();
  catalog.publish(source, [structuredClone(definition)]);
  const bus = new PluginEventBroker(() => plugins, catalog);
  const invoke = (owner: string, operation: string, args = {}) => bus.invoke(owner, { operation, ...args });
  const open = async (owner = first.package_id) => (await invoke(owner, 'subscribe', { subscription: input })) as { id: string };
  const publish = (value = 1) => invoke(source.package_id, 'publish', {
    publication: { capability: 'probe', event: 'changed', version: 1, data: { value } },
  });
  const client = (owner: string, signal = new AbortController().signal, report = vi.fn()) =>
    createPluginEventClient((_service, args) => bus.invoke(owner, args), signal, report);
  return { source, first, second, catalog, bus, invoke, open, publish, client, setPlugins: (next: typeof plugins) => { plugins = next; } };
}

describe('public plugin events', () => {
  it('discovers only explicitly consumed events, independently of callable methods', async () => {
    const f = fixture();
    expect(await f.client(f.first.package_id).list()).toEqual([{
      ...definition.events![0], provider_plugin_id: f.source.package_id, capability: 'probe', capability_version: 1,
    }]);
    f.first.consumes = [{ capability: 'probe', methods: ['changed'] }];
    expect(await f.client(f.first.package_id).list()).toEqual([]);
    await expect(f.open()).rejects.toMatchObject({ code: 'plugin_event_denied' });
    f.first.consumes = [{ match: { method_annotation: 'seed.stream', equals: true } }];
    await expect(f.open()).rejects.toMatchObject({ code: 'plugin_event_denied' });
    f.catalog.publish(f.source, [{ ...definition, exposure: 'local' }]);
    expect(await f.client(f.second.package_id).list()).toEqual([]);
    await expect(f.open(f.second.package_id)).rejects.toMatchObject({ code: 'plugin_event_unavailable' });
  });

  it('fans out isolated copies, attributes the publisher and preserves per-subscription order', async () => {
    const f = fixture(), one = await f.open(), two = await f.open(f.second.package_id);
    const waiting = f.invoke(f.first.package_id, 'next', one);
    const published = await f.publish();
    const received = await waiting as any;
    expect(received).toEqual({ done: false, event: published });
    expect(received.event).toMatchObject({ provider_plugin_id: f.source.package_id, event_version: 1, data: { value: 1 } });
    expect(received.event.id).toMatch(/^[0-9a-f-]{36}$/);
    received.event.data.value = 99;
    expect(await f.invoke(f.second.package_id, 'next', two)).toMatchObject({ event: { data: { value: 1 } } });
    await f.publish(2); await f.publish(3);
    expect(await f.invoke(f.first.package_id, 'next', one)).toMatchObject({ event: { data: { value: 2 } } });
    expect(await f.invoke(f.first.package_id, 'next', one)).toMatchObject({ event: { data: { value: 3 } } });
    f.bus.clear();
  });

  it('rejects undeclared publishers, unsupported versions, forged identity, non-JSON and invalid/oversized data', async () => {
    const f = fixture();
    const publication = { capability: 'probe', event: 'changed', version: 1, data: { value: 1 } };
    await expect(f.invoke(f.first.package_id, 'publish', { publication })).rejects.toMatchObject({ code: 'plugin_event_unavailable' });
    for (const change of [{ event: 'missing' }, { version: 2 }])
      await expect(f.invoke(f.source.package_id, 'publish', { publication: { ...publication, ...change } })).rejects.toMatchObject({ code: 'plugin_event_unavailable' });
    await expect(f.invoke(f.source.package_id, 'publish', { publication: { ...publication, provider_plugin_id: f.first.package_id } })).rejects.toThrow();
    await expect(f.invoke(f.source.package_id, 'publish', { publication: { ...publication, data: { value: 'wrong' } } })).rejects.toMatchObject({ code: 'plugin_event_schema' });
    await expect(f.invoke(f.source.package_id, 'publish', { publication: { ...publication, data: undefined } })).rejects.toThrow();
    await expect(f.invoke(f.source.package_id, 'publish', { publication: { ...publication, data: 'x'.repeat(65537) } })).rejects.toMatchObject({ code: 'plugin_event_size' });
    expect(() => f.catalog.publish(f.source, [{ ...definition, events: [{ ...definition.events![0], dataSchema: { type: 'invalid-type' } }] }])).toThrow();
  });

  it('keeps subscription reads and cancellation bound to the owning plugin', async () => {
    const f = fixture(), subscription = await f.open();
    for (const operation of ['next', 'unsubscribe'])
      await expect(f.invoke(f.second.package_id, operation, subscription)).rejects.toMatchObject({ code: 'plugin_event_denied' });
    const next = f.invoke(f.first.package_id, 'next', subscription);
    await expect(f.invoke(f.first.package_id, 'next', subscription)).rejects.toMatchObject({ code: 'plugin_event_concurrent_read' });
    await f.invoke(f.first.package_id, 'unsubscribe', subscription);
    expect(await next).toEqual({ done: true });
    await f.invoke(f.first.package_id, 'unsubscribe', subscription);
    await expect(f.invoke(f.first.package_id, 'next', subscription)).rejects.toMatchObject({ code: 'plugin_event_subscription_closed' });
  });

  it('ends only a slow subscription on overflow, without blocking the publisher or other subscribers', async () => {
    const f = fixture(), slow = await f.open(), fast = await f.open(f.second.package_id);
    for (let value = 0; value < 129; value++) {
      await f.publish(value);
      expect(await f.invoke(f.second.package_id, 'next', fast)).toMatchObject({ event: { data: { value } } });
    }
    await expect(f.invoke(f.first.package_id, 'next', slow)).rejects.toMatchObject({ code: 'plugin_event_overflow' });
    await f.publish(130);
    expect(await f.invoke(f.second.package_id, 'next', fast)).toMatchObject({ event: { data: { value: 130 } } });
    f.bus.clear();
  });

  it('bounds subscription counts and releases capacity on cancellation', async () => {
    const f = fixture(), subscriptions = await Promise.all(Array.from({ length: 64 }, () => f.open()));
    await expect(f.open()).rejects.toMatchObject({ code: 'plugin_event_limit' });
    await f.invoke(f.first.package_id, 'unsubscribe', subscriptions[0]);
    await f.open();
    f.bus.clear();
  });

  it('does not replay events published before subscription or during provider downtime', async () => {
    const f = fixture();
    await f.publish(1);
    const subscription = await f.open();
    const next = f.invoke(f.first.package_id, 'next', subscription);
    await f.publish(2);
    expect(await next).toMatchObject({ event: { data: { value: 2 } } });
    const stopped = f.invoke(f.first.package_id, 'next', subscription);
    f.bus.closePlugin(f.source.package_id);
    await expect(stopped).rejects.toMatchObject({ code: 'plugin_event_provider_stopped' });
    await f.publish(3);
    const fresh = await f.open();
    const delivered = f.invoke(f.first.package_id, 'next', fresh);
    await f.publish(4);
    expect(await delivered).toMatchObject({ event: { data: { value: 4 } } });
    f.bus.clear();
  });

  it('invalidates pending reads when grants, contracts or runtime generations change', async () => {
    const f = fixture();
    const changed = await f.open();
    const read = f.invoke(f.first.package_id, 'next', changed);
    f.catalog.publish(f.source, [{ ...definition, version: 2 }]);
    f.bus.reconcile();
    await expect(read).rejects.toMatchObject({ code: 'plugin_event_contract_changed' });
    const revoked = await f.open(f.second.package_id);
    f.setPlugins([f.source, f.first]);
    await expect(f.invoke(f.second.package_id, 'next', revoked)).rejects.toMatchObject({ code: 'plugin_event_unavailable' });
    let active = true;
    const old = await f.bus.invoke(f.first.package_id, { operation: 'subscribe', subscription: input }, () => {
      if (!active) throw Object.assign(new Error('Stopped generation'), { code: 'plugin_runtime_stopped' });
    }) as { id: string };
    active = false;
    await expect(f.invoke(f.first.package_id, 'next', old)).rejects.toMatchObject({ code: 'plugin_runtime_stopped' });
    f.bus.clear();
  });

  it('serializes SDK handlers, isolates handler errors and supports unsubscribe inside a handler', async () => {
    const f = fixture(), report = vi.fn(), values: number[] = [];
    const client = f.client(f.first.package_id, undefined, report);
    const sub = await client.subscribe<{ value: number }>(input, async ({ data }) => {
      values.push(data.value);
      if (data.value === 1) throw new Error('Only this listener failed');
      if (data.value === 2) await sub.unsubscribe();
    });
    await f.publish(1); await f.publish(2); await sub.closed;
    expect(values).toEqual([1, 2]);
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Only this listener failed' }));
    expect(sub.signal.aborted).toBe(true);
    await f.publish(3);
    expect(values).toEqual([1, 2]);
  });

  it('cancels pending SDK reads on unload and exposes provider loss through closed', async () => {
    const f = fixture(), owner = new AbortController(), listener = vi.fn();
    const sub = await f.client(f.first.package_id, owner.signal).subscribe(input, listener);
    owner.abort();
    await sub.closed;
    await f.publish();
    expect(listener).not.toHaveBeenCalled();
    await expect(f.client(f.first.package_id, owner.signal).subscribe(input, listener)).rejects.toThrow();
    const report = vi.fn();
    const next = await f.client(f.second.package_id, undefined, report).subscribe(input, listener);
    f.bus.closePlugin(f.source.package_id);
    await expect(next.closed).rejects.toMatchObject({ code: 'plugin_event_provider_stopped' });
    expect(report).toHaveBeenCalledOnce();
  });

  it('closes a subscription whose owner is unloaded while its registration is in flight', async () => {
    const f = fixture(), owner = new AbortController();
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    const transport = vi.fn(async (_service: string, args: Record<string, unknown>) => {
      const result = await f.bus.invoke(f.first.package_id, args);
      if (args.operation === 'subscribe') await ready;
      return result;
    });
    const client = createPluginEventClient(transport, owner.signal, vi.fn());
    const pending = client.subscribe(input, vi.fn());
    owner.abort(); release();
    await expect(pending).rejects.toThrow();
    expect(transport.mock.calls.map(([, args]) => args.operation)).toEqual(['subscribe', 'unsubscribe']);
    f.bus.clear();
  });

  it('settles normal unload even if the retired transport rejects cleanup', async () => {
    const owner = new AbortController(), report = vi.fn();
    let rejectRead!: (error: Error) => void;
    const client = createPluginEventClient(async (_service, args) => {
      if (args.operation === 'subscribe') return { id: crypto.randomUUID() };
      if (args.operation === 'next') return await new Promise((_resolve, reject) => { rejectRead = reject; });
      rejectRead(new Error('Transport stopped'));
      throw new Error('Retired transport');
    }, owner.signal, report);
    const subscription = await client.subscribe(input, vi.fn());
    owner.abort();
    await subscription.closed;
    expect(report).not.toHaveBeenCalled();
  });
});
