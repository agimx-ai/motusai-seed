import { describe, expect, it, vi } from 'vitest';
import { capabilityService, createCapabilityClient } from '@motus-ai/seed-sdk';

const offered = [
  {
    id: 'events',
    provider_plugin_id: 'com.example.provider',
    version: 1,
    methods: [
      {
        name: 'poll',
        provider_plugin_id: 'com.example.provider',
        risk: 'read' as const,
        annotations: { 'seed.stream': true },
      },
    ],
  },
];
describe('shared native and sandbox capability client', () => {
  it('uses a generation-bound call ID and propagates cancellation without changing provider errors', async () => {
    const owner = new AbortController(),
      caller = new AbortController();
    let fail!: (error: Error) => void;
    const invoke = vi.fn(async (service: string, args: Record<string, unknown>) => {
      if (service === 'seed.capabilities.list') return offered;
      if (service === 'seed.capabilities.cancel') {
        fail(Object.assign(new Error('Provider cancelled'), { code: 'provider_cancelled' }));
        return null;
      }
      expect((args.invocation as Record<string, unknown>).signal).toBeUndefined();
      expect(args.call_id).toMatch(/^[0-9a-f-]{36}$/);
      return await new Promise((_resolve, reject) => {
        fail = reject;
      });
    });
    const client = createCapabilityClient(invoke, owner.signal);
    expect(await client.list()).toEqual(offered);
    const pending = client.invoke({ capability: 'events', method: 'poll', arguments: {}, signal: caller.signal });
    caller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'provider_cancelled' });
    const calls = invoke.mock.calls.filter(([service]) => service === 'seed.capabilities.cancel');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].call_id).toBe(invoke.mock.calls[1][1].call_id);
    owner.abort();
    await expect(client.list()).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(3);
  });
  it('streams only advertised read methods and validates progress', async () => {
    const controller = new AbortController();
    const invoke = vi.fn(async () => ({ events: ['one'], next: 1 }));
    const client = capabilityService(async () => offered, invoke);
    for await (const event of client.stream!({
      capability: 'events',
      method: 'poll',
      arguments: {},
      signal: controller.signal,
    })) {
      expect(event).toBe('one');
      controller.abort();
    }
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ arguments: { after: 0, wait_ms: 10_000 } }),
    );
    const invalid = capabilityService(
      async () => offered,
      async () => ({ events: ['one'], next: 0 }),
    );
    await expect(
      invalid.stream!({ capability: 'events', method: 'poll', arguments: {} })[Symbol.asyncIterator]().next(),
    ).rejects.toThrow('cursor');
    await expect(
      client.stream!({ capability: 'events', method: 'other', arguments: {} })[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: 'capability_stream_unavailable' });
  });
});
