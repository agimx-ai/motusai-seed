/** A public event belongs to a code-registered capability, not a global topic namespace. */
export type CapabilityEvent = {
  name: string;
  version: number;
  dataSchema: Record<string, unknown>;
};

export type PluginEvent<T = unknown> = {
  id: string;
  provider_plugin_id: string;
  capability: string;
  capability_version: number;
  event: string;
  event_version: number;
  published_at: string;
  data: T;
};

export type AvailablePluginEvent = CapabilityEvent & {
  provider_plugin_id: string;
  capability: string;
  capability_version: number;
};

export type PluginEventPublication = {
  capability: string;
  event: string;
  version: number;
  data: unknown;
};

export type PluginEventSubscriptionOptions = {
  provider_plugin_id: string;
  capability: string;
  event: string;
  version: number;
  signal?: AbortSignal;
};

export type PluginEventSubscription = {
  readonly id: string;
  readonly signal: AbortSignal;
  /** Rejects on provider withdrawal, changed contracts, transport errors or queue overflow. */
  readonly closed: Promise<void>;
  /** Stops delivery without waiting for the current handler. Handlers should observe signal. */
  unsubscribe(): Promise<void>;
};

export type PluginEventService = {
  list(): Promise<AvailablePluginEvent[]>;
  /** Acknowledges validation and enqueueing, never completion of subscriber work. */
  publish(input: PluginEventPublication): Promise<PluginEvent>;
  subscribe<T = unknown>(
    options: PluginEventSubscriptionOptions,
    listener: (event: PluginEvent<T>, signal: AbortSignal) => void | Promise<void>,
  ): Promise<PluginEventSubscription>;
};

/** Native and sandbox services share the same generation-bound Broker transport. */
export function createPluginEventClient(
  broker: (service: string, args: Record<string, unknown>) => Promise<unknown>,
  owner: AbortSignal,
  report: (error: unknown) => void,
): PluginEventService {
  const invoke = (operation: string, args: Record<string, unknown>) =>
    broker('seed.plugin-events', { operation, ...args });
  return {
    async list() {
      owner.throwIfAborted();
      return (await invoke('list', {})) as AvailablePluginEvent[];
    },
    async publish(input) {
      owner.throwIfAborted();
      return (await invoke('publish', { publication: input })) as PluginEvent;
    },
    async subscribe<T>(
      options: PluginEventSubscriptionOptions,
      listener: (event: PluginEvent<T>, signal: AbortSignal) => void | Promise<void>,
    ) {
      const lifetime = new AbortController();
      const signal = AbortSignal.any([owner, lifetime.signal, ...(options.signal ? [options.signal] : [])]);
      signal.throwIfAborted();
      const { signal: _signal, ...input } = options;
      const { id } = (await invoke('subscribe', { subscription: input })) as { id: string };
      let closing: Promise<void> | undefined;
      const unsubscribe = () => {
        if (!closing) {
          // Assign before aborting: the abort listener may call unsubscribe recursively.
          closing = Promise.resolve()
            .then(async () => { await invoke('unsubscribe', { id }); })
            .catch((error) => { if (!owner.aborted) throw error; });
          lifetime.abort(new Error('Plugin event subscription stopped.'));
          signal.removeEventListener('abort', abort);
        }
        return closing;
      };
      const abort = () => { void unsubscribe().catch(report); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        await unsubscribe();
        signal.throwIfAborted();
      }
      const closed = (async () => {
        try {
          while (!signal.aborted) {
            // Waits for delivery over existing IPC; no timer or business polling.
            const next = (await invoke('next', { id })) as { done: boolean; event?: PluginEvent<T> };
            if (signal.aborted || next.done) break;
            if (!next.event) throw new Error('Invalid plugin event delivery.');
            try {
              await listener(next.event, signal);
            } catch (error) {
              if (!signal.aborted) report(error);
            }
          }
        } catch (error) {
          if (!signal.aborted) throw error;
        } finally {
          await unsubscribe();
        }
      })();
      // Terminal errors remain observable through closed, without an unhandled rejection.
      void closed.catch(report);
      return { id, signal, closed, unsubscribe };
    },
  };
}
