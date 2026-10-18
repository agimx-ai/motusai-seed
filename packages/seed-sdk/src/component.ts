import type { EventRef } from './events.js';

export type Disposer = () => void | Promise<void>;

/** A single lifecycle owns all its children and registrations, including failed initialization. */
export class Component {
  private state: 'idle' | 'loading' | 'loaded' | 'unloading' | 'unloaded' = 'idle';
  private readonly cleanups: Disposer[] = [];
  private readonly children = new Set<Component>();
  private loading?: Promise<void>;
  private unloading?: Promise<void>;
  private controller = new AbortController();

  get signal(): AbortSignal {
    return this.controller.signal;
  }
  get loaded(): boolean {
    return this.state === 'loaded';
  }

  onload(): void | Promise<void> {}
  onunload(): void {}

  load(): Promise<void> {
    if (this.state === 'loaded') return Promise.resolve();
    if (this.state === 'loading') return this.loading!;
    if (this.state !== 'idle')
      return Promise.reject(new Error('An unloaded component cannot be reused. Create a new instance.'));
    this.state = 'loading';
    this.loading = (async () => {
      try {
        await this.onload();
        if (this.signal.aborted) throw this.signal.reason;
        for (const child of this.children) await child.load();
        this.state = 'loaded';
      } catch (error) {
        this.state = 'unloading';
        this.controller.abort(error);
        await this.dispose().catch(() => undefined);
        throw error;
      }
    })();
    return this.loading;
  }

  unload(): Promise<void> {
    if (this.unloading) return this.unloading;
    if (this.state === 'unloaded') return Promise.resolve();
    this.controller.abort(new Error('Component unloaded.'));
    this.unloading = (async () => {
      // Wait for initialization to settle so late registrations cannot escape teardown.
      await this.loading?.catch(() => undefined);
      if (this.state === 'unloaded') return;
      this.state = 'unloading';
      await this.dispose();
    })();
    return this.unloading;
  }

  private async dispose(): Promise<void> {
    const failures: unknown[] = [];
    try {
      this.onunload();
    } catch (error) {
      failures.push(error);
    }
    for (const child of [...this.children].reverse()) {
      try {
        await child.unload();
      } catch (error) {
        failures.push(error);
      }
    }
    this.children.clear();
    while (this.cleanups.length) {
      try {
        await this.cleanups.pop()!();
      } catch (error) {
        failures.push(error);
      }
    }
    this.state = 'unloaded';
    if (failures.length) throw new AggregateError(failures, 'Component cleanup failed.');
  }

  register(disposer: Disposer): void {
    if (this.state === 'unloaded' || this.state === 'unloading' || this.signal.aborted) {
      // During loading, unload waits for onload. Preserve async cleanup in that drain.
      if (this.state !== 'unloaded') {
        this.cleanups.push(disposer);
        return;
      }
      throw new Error('Cannot register resources on an unloaded component.');
    }
    this.cleanups.push(disposer);
  }

  registerEvent(ref: EventRef): void {
    this.register(() => ref.owner.offref(ref));
  }

  registerDomEvent<K extends keyof WindowEventMap>(
    element: Window,
    type: K,
    callback: (event: WindowEventMap[K]) => unknown,
    options?: AddEventListenerOptions | boolean,
  ): void;
  registerDomEvent<K extends keyof DocumentEventMap>(
    element: Document,
    type: K,
    callback: (event: DocumentEventMap[K]) => unknown,
    options?: AddEventListenerOptions | boolean,
  ): void;
  registerDomEvent<K extends keyof HTMLElementEventMap>(
    element: HTMLElement,
    type: K,
    callback: (event: HTMLElementEventMap[K]) => unknown,
    options?: AddEventListenerOptions | boolean,
  ): void;
  registerDomEvent(
    element: EventTarget,
    type: string,
    callback: EventListener,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (this.state === 'unloaded') throw new Error('Cannot register resources on an unloaded component.');
    element.addEventListener(type, callback, options);
    this.register(() => element.removeEventListener(type, callback, options));
  }

  registerInterval<T extends number | ReturnType<typeof setInterval>>(id: T): T {
    if (this.state === 'unloaded') {
      clearInterval(id);
      throw new Error('Cannot register resources on an unloaded component.');
    }
    this.register(() => clearInterval(id));
    return id;
  }

  addChild<T extends Component>(child: T): T {
    if (this.signal.aborted) throw new Error('Cannot add a child to a stopped component.');
    this.children.add(child);
    if (this.loaded)
      void child.load().catch((error) => {
        queueMicrotask(() => {
          throw error;
        });
      });
    return child;
  }

  async removeChild<T extends Component>(child: T): Promise<T> {
    this.children.delete(child);
    await child.unload();
    return child;
  }
}
