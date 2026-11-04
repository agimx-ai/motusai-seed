/** Authenticated, plugin-namespaced Cloud resources. Credentials stay in the Seed host. */
export type CloudResourceRequest = {
  resource: string;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
};
export type CloudResourceChange = { resource: string; reset: boolean };
export type CloudResourceSubscription = { close(): Promise<void>; readonly closed: Promise<void> };
export type CloudResourceService = {
  request<T = unknown>(input: CloudResourceRequest, signal?: AbortSignal): Promise<T>;
  /** Hints only: read authoritative resources after every change and reset. */
  watch(
    resource: string,
    listener: (change: CloudResourceChange) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<CloudResourceSubscription>;
};

export function createCloudResourceClient(
  broker: (service: string, args: Record<string, unknown>) => Promise<unknown>,
  owner: AbortSignal,
  report: (error: unknown) => void,
): CloudResourceService {
  const invoke = (operation: string, args: Record<string, unknown>) =>
    broker('seed.cloud.resources', { operation, ...args });
  return {
    async request<T>(input: CloudResourceRequest, signal?: AbortSignal): Promise<T> {
      const active = signal ? AbortSignal.any([owner, signal]) : owner;
      active.throwIfAborted();
      const id = crypto.randomUUID();
      const cancel = () => {
        void invoke('cancel', { id }).catch(report);
      };
      active.addEventListener('abort', cancel, { once: true });
      try {
        const value = await invoke('request', { id, request: input });
        active.throwIfAborted();
        return value as T;
      } finally {
        active.removeEventListener('abort', cancel);
      }
    },
    async watch(resource, listener, external) {
      const lifetime = new AbortController();
      const signal = AbortSignal.any([owner, lifetime.signal, ...(external ? [external] : [])]);
      signal.throwIfAborted();
      const { id } = (await invoke('watch', { resource })) as { id: string };
      let closing: Promise<void> | undefined;
      const close = () => {
        if (!closing) {
          closing = Promise.resolve().then(async () => {
            await invoke('unwatch', { id });
          });
          lifetime.abort();
        }
        return closing;
      };
      const abort = () => {
        void close().catch(report);
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        await close();
        signal.throwIfAborted();
      }
      const closed = (async () => {
        try {
          while (!signal.aborted) {
            const item = (await invoke('next', { id })) as { done: boolean; change?: CloudResourceChange };
            if (signal.aborted || item.done) break;
            if (!item.change || item.change.resource !== resource || typeof item.change.reset !== 'boolean')
              throw new Error('Invalid Cloud change notification.');
            await listener(item.change);
          }
        } finally {
          signal.removeEventListener('abort', abort);
          await close();
        }
      })();
      void closed.catch((error) => {
        if (!owner.aborted && !external?.aborted) report(error);
      });
      return { close, closed };
    },
  };
}
