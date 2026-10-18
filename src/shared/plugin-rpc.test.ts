import { describe, expect, it, vi } from 'vitest';
import { PluginRpcPeer, type RpcMessage } from '../../packages/seed-sdk/src/rpc';

describe('generation-scoped plugin RPC', () => {
  it('delivers values and safe error codes without forwarding arbitrary error fields', async () => {
    let client!: PluginRpcPeer, server!: PluginRpcPeer;
    client = new PluginRpcPeer('current', (message) => {
      void server.receive(structuredClone(message));
    });
    server = new PluginRpcPeer(
      'current',
      (message) => {
        void client.receive(structuredClone(message));
      },
      async (method, args) => {
        if (method === 'fail')
          throw Object.assign(new Error('Denied'), {
            code: 'denied',
            credential: 'must-not-leak',
            params: { target: 12, object: { unsafe: true } },
          });
        return args.value;
      },
    );
    expect(await client.call('echo', { value: 42 })).toBe(42);
    await expect(client.call('fail')).rejects.toMatchObject({
      message: 'Denied',
      code: 'denied',
      params: { target: 12 },
    });
    client.close();
    server.close();
  });

  it('ignores replies from an earlier generation and closes all pending work', async () => {
    const messages: RpcMessage[] = [];
    const client = new PluginRpcPeer('new', (message) => messages.push(message));
    const result = client.call('echo');
    await client.receive({ generation: 'old', type: 'result', id: '1', ok: true, value: 'wrong' });
    client.close();
    await expect(result).rejects.toThrow('closed');
    expect(messages).toContainEqual({ generation: 'new', type: 'cancel', id: '1' });
  });

  it('propagates cancellation to actual remote work and drops its late reply', async () => {
    let client!: PluginRpcPeer, server!: PluginRpcPeer, remoteSignal: AbortSignal | undefined;
    const replies: RpcMessage[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    client = new PluginRpcPeer('run', (message) => {
      void server.receive(message);
    });
    server = new PluginRpcPeer(
      'run',
      (message) => {
        replies.push(message);
        void client.receive(message);
      },
      async (_method, _args, signal) => {
        remoteSignal = signal;
        await gate;
        return 'late';
      },
    );
    const controller = new AbortController(),
      result = client.call('wait', {}, controller.signal);
    controller.abort(new Error('User cancelled'));
    await expect(result).rejects.toThrow('User cancelled');
    expect(remoteSignal?.aborted).toBe(true);
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(replies).toEqual([]);
    client.close();
    server.close();
  });

  it('times out once and releases its timer and cancellation listener', async () => {
    vi.useFakeTimers();
    const send = vi.fn(),
      client = new PluginRpcPeer('run', send);
    const result = client.call('wait', {}, undefined, 20);
    const rejected = expect(result).rejects.toMatchObject({ code: 'plugin_rpc_timeout' });
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    expect(send).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    client.close();
    vi.useRealTimers();
  });
});
