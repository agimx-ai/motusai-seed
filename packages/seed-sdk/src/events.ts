export type EventRef = {
  readonly owner: Events;
  readonly name: string;
  readonly listener: (...args: any[]) => unknown;
  readonly context?: unknown;
};

/** In-memory events. Persistent work and replay belong to the task/transport services. */
export class Events {
  private readonly listeners = new Map<string, Set<EventRef>>();

  on(name: string, listener: (...args: any[]) => unknown, context?: unknown): EventRef {
    const ref = Object.freeze({ owner: this, name, listener, context });
    const entries = this.listeners.get(name) ?? new Set<EventRef>();
    entries.add(ref);
    this.listeners.set(name, entries);
    return ref;
  }

  off(name: string, listener: (...args: any[]) => unknown): void {
    for (const ref of this.listeners.get(name) ?? []) if (ref.listener === listener) this.offref(ref);
  }

  offref(ref: EventRef): void {
    if (ref.owner !== this) return;
    const entries = this.listeners.get(ref.name);
    entries?.delete(ref);
    if (!entries?.size) this.listeners.delete(ref.name);
  }

  trigger(name: string, ...args: unknown[]): void {
    for (const ref of [...(this.listeners.get(name) ?? [])]) this.tryTrigger(ref, args);
  }

  tryTrigger(ref: EventRef, args: unknown[]): void {
    try {
      const result = ref.listener.apply(ref.context, args);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function')
        void Promise.resolve(result).catch((error) => this.onError(error));
    } catch (error) {
      this.onError(error);
    }
  }

  protected onError(error: unknown): void {
    queueMicrotask(() => {
      throw error;
    });
  }
}
