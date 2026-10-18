import type { SeedPluginCapabilityService } from './index.js';

/** Cursor streams use exactly the same permission-checked invoke path as ordinary calls. */
export function capabilityService(
  list: SeedPluginCapabilityService['list'],
  invoke: SeedPluginCapabilityService['invoke'],
): SeedPluginCapabilityService {
  return {
    list,
    invoke,
    async *stream(invocation) {
      const offered = (await list()).filter(
        (entry) =>
          entry.id === invocation.capability &&
          (!invocation.provider_plugin_id || entry.provider_plugin_id === invocation.provider_plugin_id),
      );
      if (
        offered.length !== 1 ||
        !offered[0].methods.some(
          (method) =>
            method.name === invocation.method && method.risk === 'read' && method.annotations?.['seed.stream'] === true,
        )
      )
        throw Object.assign(new Error('Capability does not offer a read-only cursor stream.'), {
          code: 'capability_stream_unavailable',
        });
      let after = 0;
      while (!invocation.signal?.aborted) {
        const response = await invoke({
          ...invocation,
          arguments: { ...invocation.arguments, after, wait_ms: 10_000 },
        });
        if (invocation.signal?.aborted) return;
        const page = response && typeof response === 'object' ? (response as { events?: unknown; next?: unknown }) : {};
        if (
          !Array.isArray(page.events) ||
          typeof page.next !== 'number' ||
          !Number.isSafeInteger(page.next) ||
          page.next < after ||
          (page.events.length > 0 && page.next === after)
        )
          throw new Error('Streaming capabilities must return { events, next } cursor results.');
        for (const event of page.events) yield event;
        after = page.next;
      }
    },
  };
}

/** Generation-bound transport shared by native and sandbox services. Never serialize AbortSignal. */
export function createCapabilityClient(
  broker: (service: string, args: Record<string, unknown>) => Promise<unknown>,
  owner: AbortSignal,
): SeedPluginCapabilityService {
  return capabilityService(
    async () => {
      owner.throwIfAborted();
      return (await broker('seed.capabilities.list', {})) as Awaited<ReturnType<SeedPluginCapabilityService['list']>>;
    },
    async (invocation) => {
      const signal = invocation.signal ? AbortSignal.any([owner, invocation.signal]) : owner;
      signal.throwIfAborted();
      const callId = crypto.randomUUID();
      const cancel = () => {
        void broker('seed.capabilities.cancel', { call_id: callId }).catch(() => undefined);
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        return await broker('seed.capabilities.invoke', {
          call_id: callId,
          invocation: { ...invocation, signal: undefined },
        });
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
  );
}
