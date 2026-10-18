export type RpcMessage =
  | { generation: string; type: 'call'; id: string; method: string; args: Record<string, unknown> }
  | { generation: string; type: 'result'; id: string; ok: true; value: unknown }
  | {
      generation: string;
      type: 'result';
      id: string;
      ok: false;
      error: string;
      code?: string;
      params?: Record<string, string | number | boolean>;
    }
  | { generation: string; type: 'cancel'; id: string };

type Pending = { resolve(value: unknown): void; reject(error: unknown): void; cleanup(): void };

/** A generation-scoped transport, not an authority boundary. The host binds its actual sender/owner. */
export class PluginRpcPeer {
  private readonly pending = new Map<string, Pending>();
  private readonly active = new Map<string, AbortController>();
  private closed = false;
  private sequence = 0;
  constructor(
    readonly generation: string,
    private readonly send: (message: RpcMessage) => void,
    private readonly handle?: (method: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>,
  ) {}

  call<T = unknown>(
    method: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
    timeoutMs = 30_000,
  ): Promise<T> {
    if (this.closed || signal?.aborted) return Promise.reject(signal?.reason ?? new Error('Plugin runtime is closed.'));
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000)
      return Promise.reject(new Error('Invalid RPC timeout.'));
    const id = String(++this.sequence);
    return new Promise<T>((resolve, reject) => {
      const finish = (error: unknown) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.cleanup();
        pending.reject(error);
        if (!this.closed) this.send({ generation: this.generation, type: 'cancel', id });
      };
      const abort = () => finish(signal?.reason ?? new Error('RPC cancelled.'));
      const timer = setTimeout(
        () => finish(Object.assign(new Error('Plugin RPC timed out.'), { code: 'plugin_rpc_timeout' })),
        timeoutMs,
      );
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
        },
      });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this.send({ generation: this.generation, type: 'call', id, method, args });
      } catch (error) {
        finish(error);
      }
    });
  }

  async receive(message: RpcMessage): Promise<void> {
    if (this.closed || !message || message.generation !== this.generation || typeof message.id !== 'string') return;
    if (message.type === 'result') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      pending.cleanup();
      if (message.ok) pending.resolve(message.value);
      else pending.reject(Object.assign(new Error(message.error), { code: message.code, params: message.params }));
      return;
    }
    if (message.type === 'cancel') {
      this.active.get(message.id)?.abort(new Error('RPC cancelled.'));
      return;
    }
    if (message.type !== 'call' || !this.handle) return;
    if (
      typeof message.method !== 'string' ||
      !message.args ||
      typeof message.args !== 'object' ||
      Array.isArray(message.args)
    )
      return;
    if (this.active.has(message.id)) return;
    const controller = new AbortController();
    this.active.set(message.id, controller);
    try {
      const value = await this.handle(message.method, message.args, controller.signal);
      if (!this.closed && !controller.signal.aborted)
        this.send({ generation: this.generation, type: 'result', id: message.id, ok: true, value });
    } catch (error) {
      const raw =
        error && typeof error === 'object' && 'params' in error && error.params && typeof error.params === 'object'
          ? error.params
          : {};
      const params = Object.fromEntries(
        Object.entries(raw)
          .slice(0, 32)
          .filter(
            ([, value]) =>
              typeof value === 'string' ||
              typeof value === 'boolean' ||
              (typeof value === 'number' && Number.isFinite(value)),
          ),
      ) as Record<string, string | number | boolean>;
      if (!this.closed && !controller.signal.aborted)
        this.send({
          generation: this.generation,
          type: 'result',
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          ...(Object.keys(params).length ? { params } : {}),
          ...(error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            ? { code: error.code }
            : {}),
        });
    } finally {
      this.active.delete(message.id);
    }
  }

  close(): void {
    if (this.closed) return;
    for (const id of this.pending.keys()) {
      try {
        this.send({ generation: this.generation, type: 'cancel', id });
      } catch {
        /* The transport may already be gone. */
      }
    }
    this.closed = true;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(new Error('Plugin runtime is closed.'));
    }
    this.pending.clear();
    for (const controller of this.active.values()) controller.abort(new Error('Plugin runtime is closed.'));
    this.active.clear();
  }
}
