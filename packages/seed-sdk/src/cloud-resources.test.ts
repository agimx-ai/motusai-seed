import { describe, expect, it, vi } from 'vitest';
import { createCloudResourceClient } from './cloud-resources.js';

describe('SDK Cloud resource lifecycle', () => {
  it('cancels the actual host request and rejects a result arriving after the caller aborts', async () => {
    const owner = new AbortController(),
      signal = new AbortController();
    let finish!: (value: unknown) => void;
    const broker = vi.fn(async (_service: string, input: Record<string, unknown>) => {
      if (input.operation === 'request')
        return await new Promise((resolve) => {
          finish = resolve;
        });
      return null;
    });
    const client = createCloudResourceClient(broker, owner.signal, vi.fn());
    const result = client
      .request({ resource: 'collaboration', path: '/actors' }, signal.signal)
      .catch((error) => error);
    const id = broker.mock.calls[0]![1].id;
    signal.abort();
    expect(broker).toHaveBeenCalledWith('seed.cloud.resources', { operation: 'cancel', id });
    finish({ actor: 'late' });
    expect((await result).name).toBe('AbortError');
  });
  it('stops a pending change wait when its owning plugin is unloaded', async () => {
    const owner = new AbortController();
    let next!: (value: unknown) => void;
    const broker = vi.fn(async (_service: string, input: Record<string, unknown>) => {
      if (input.operation === 'watch') return { id: 'owned-subscription' };
      if (input.operation === 'next')
        return await new Promise((resolve) => {
          next = resolve;
        });
      if (input.operation === 'unwatch') {
        next({ done: true });
        return null;
      }
      throw new Error('Unexpected operation');
    });
    const listener = vi.fn(),
      report = vi.fn();
    const client = createCloudResourceClient(broker, owner.signal, report);
    const subscription = await client.watch('collaboration', listener);
    owner.abort();
    await subscription.closed;
    expect(broker).toHaveBeenCalledWith('seed.cloud.resources', { operation: 'unwatch', id: 'owned-subscription' });
    expect(listener).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
});
