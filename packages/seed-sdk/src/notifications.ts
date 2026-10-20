import type { SeedNavigationTarget } from './deep-link.js';

export type SystemNotificationOptions = {
  title?: string;
  body?: string;
  silent?: boolean;
  /** Declared plugin resource path, or a PNG/JPEG data URL. */
  icon?: string;
  /** Optional application navigation when clicked; omitted means no automatic navigation. */
  clickTarget?: SeedNavigationTarget;
};
export type SystemNotificationResult = 'sent' | 'disabled' | 'unsupported' | 'failed';
export type SystemNotificationEvent = 'show' | 'click' | 'close';
export type SystemNotificationListener = (notification: SystemNotification) => void | Promise<void>;
export type SystemNotificationHandlers = Partial<Record<SystemNotificationEvent, SystemNotificationListener>>;
export type SystemNotification = {
  readonly id: string;
  readonly result: SystemNotificationResult | undefined;
  /** Settles when the handle is released; OS banner dismissal alone does not release it. */
  readonly closed: Promise<void>;
  on(event: SystemNotificationEvent, listener: SystemNotificationListener): () => void;
  show(options?: SystemNotificationOptions): Promise<SystemNotificationResult>;
  close(): Promise<void>;
};
export type SystemNotificationService = {
  isSupported(): Promise<boolean>;
  create(options: SystemNotificationOptions): SystemNotification;
  show(options: SystemNotificationOptions, handlers?: SystemNotificationHandlers): Promise<SystemNotification>;
};

export function createSystemNotificationClient(
  invokeHost: (service: string, args: Record<string, unknown>) => Promise<unknown>,
  owner: AbortSignal,
  report: (error: unknown) => void,
): SystemNotificationService {
  const handles = new Set<SystemNotification>();
  const invoke = (operation: string, args: Record<string, unknown> = {}) =>
    invokeHost('seed.notifications', { version: 1, operation, ...args });
  owner.addEventListener(
    'abort',
    () => {
      for (const handle of handles) void handle.close().catch(() => undefined);
    },
    { once: true },
  );
  const create = (initial: SystemNotificationOptions): SystemNotification => {
    owner.throwIfAborted();
    const id = crypto.randomUUID();
    let options = structuredClone(initial),
      stopped = false,
      started = false,
      reading = false,
      showing = false;
    let closing: Promise<void> | undefined;
    let lastResult: SystemNotificationResult | undefined;
    let resolveClosed!: () => void, rejectClosed!: (error: unknown) => void;
    const closed = new Promise<void>((resolve, reject) => {
      resolveClosed = resolve;
      rejectClosed = reject;
    });
    void closed.catch(report);
    const listeners = new Map<SystemNotificationEvent, Set<SystemNotificationListener>>();
    const finish = (error?: unknown) => {
      if (stopped) return;
      stopped = true;
      handles.delete(handle);
      listeners.clear();
      if (error) rejectClosed(error);
      else resolveClosed();
    };
    const pump = async () => {
      try {
        while (!stopped && !owner.aborted) {
          const next = (await invoke('next', { id })) as { done: boolean; event?: SystemNotificationEvent };
          if (stopped || owner.aborted) break;
          if (!next || typeof next.done !== 'boolean') throw new Error('Invalid system notification delivery.');
          if (next.done) {
            finish();
            break;
          }
          if (!next.event || !['show', 'click', 'close'].includes(next.event))
            throw new Error('Invalid system notification event.');
          for (const listener of [...(listeners.get(next.event) ?? [])]) {
            if (stopped || owner.aborted) break;
            try {
              const result = listener(handle);
              if (result) void Promise.resolve(result).catch(report);
            } catch (error) {
              report(error);
            }
          }
        }
      } catch (error) {
        if (!stopped && !owner.aborted) {
          finish(error);
          await invoke('close', { id }).catch(report);
        }
      }
    };
    const handle: SystemNotification = {
      id,
      closed,
      get result() {
        return lastResult;
      },
      on(event, listener) {
        owner.throwIfAborted();
        if (stopped) throw new Error('System notification is closed.');
        if (!['show', 'click', 'close'].includes(event)) throw new Error('Unknown system notification event.');
        const entries = listeners.get(event) ?? new Set();
        entries.add(listener);
        listeners.set(event, entries);
        return () => {
          entries.delete(listener);
        };
      },
      async show(nextOptions) {
        owner.throwIfAborted();
        if (stopped) throw new Error('System notification is closed.');
        if (showing) throw new Error('System notification is already being shown.');
        if (nextOptions) options = structuredClone(nextOptions);
        showing = true;
        started = true;
        try {
          const result = await invoke('show', { id, notification: options });
          owner.throwIfAborted();
          if (stopped) throw new Error('System notification is closed.');
          if (typeof result !== 'string' || !['sent', 'disabled', 'unsupported', 'failed'].includes(result))
            throw new Error('Invalid system notification result.');
          lastResult = result as SystemNotificationResult;
          if (result === 'sent') {
            if (!reading) {
              reading = true;
              void pump();
            }
          } else await handle.close();
          return result as SystemNotificationResult;
        } catch (error) {
          await handle.close().catch(report);
          throw error;
        } finally {
          showing = false;
        }
      },
      close() {
        if (!closing) {
          finish();
          closing = started ? invoke('close', { id }).then(() => undefined) : Promise.resolve();
        }
        return closing;
      },
    };
    handles.add(handle);
    return handle;
  };
  return {
    async isSupported() {
      owner.throwIfAborted();
      const result = await invoke('is-supported');
      owner.throwIfAborted();
      if (typeof result !== 'boolean') throw new Error('Invalid system notification support result.');
      return result;
    },
    create,
    async show(options, handlers = {}) {
      const handle = create(options);
      for (const [event, listener] of Object.entries(handlers))
        if (listener) handle.on(event as SystemNotificationEvent, listener);
      await handle.show();
      return handle;
    },
  };
}
