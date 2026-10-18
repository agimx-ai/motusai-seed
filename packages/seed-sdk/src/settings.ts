/** Opaque, backend-only JSON. The plugin owns its type, validation and defaults. */
export type PluginSettingsSnapshot<T = unknown> = { revision: string; value: T | null };

export class PluginSettingsStore {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly invoke: (service: string, args: Record<string, unknown>) => Promise<unknown>,
    private readonly signal: AbortSignal,
  ) {}

  private active() {
    if (this.signal.aborted) throw new Error('Plugin settings owner is no longer running.');
  }

  async snapshot<T = unknown>(id: string): Promise<PluginSettingsSnapshot<T>> {
    this.active();
    const result = (await this.invoke('seed.plugin-settings', { operation: 'load', ids: [id] })) as Record<
      string,
      PluginSettingsSnapshot<T>
    >;
    this.active();
    return result[id];
  }

  async get<T = unknown>(id: string): Promise<T | null> {
    return (await this.snapshot<T>(id)).value;
  }

  async save<T>(id: string, value: T, revision: string): Promise<PluginSettingsSnapshot<T>> {
    this.active();
    const result = (await this.invoke('seed.plugin-settings', {
      operation: 'save',
      updates: [{ id, value, revision }],
    })) as Record<string, PluginSettingsSnapshot<T>>;
    this.active();
    return result[id];
  }

  async saveMany<T = unknown>(
    updates: Array<{ id: string; value: T; revision: string }>,
  ): Promise<Record<string, PluginSettingsSnapshot<T>>> {
    this.active();
    const result = (await this.invoke('seed.plugin-settings', { operation: 'save', updates })) as Record<
      string,
      PluginSettingsSnapshot<T>
    >;
    this.active();
    return result;
  }

  /** Compare-and-swap all records together; no silent retry or stale aggregate overwrite. */
  transaction<T = unknown>(
    ids: string[],
    mutate: (values: Record<string, T | null>) => Record<string, T> | Promise<Record<string, T>>,
  ) {
    const work = this.writes
      .catch(() => undefined)
      .then(async () => {
        this.active();
        const snapshots = (await this.invoke('seed.plugin-settings', { operation: 'load', ids })) as Record<
          string,
          PluginSettingsSnapshot<T>
        >;
        const values = Object.fromEntries(ids.map((id) => [id, structuredClone(snapshots[id].value)]));
        const changes = await mutate(values);
        this.active();
        const updates = Object.entries(changes).map(([id, value]) => {
          if (!snapshots[id]) throw new Error('Settings transaction changed an unrequested record.');
          return { id, value, revision: snapshots[id].revision };
        });
        if (!updates.length) return snapshots;
        const result = (await this.invoke('seed.plugin-settings', { operation: 'save', updates })) as Record<
          string,
          PluginSettingsSnapshot<T>
        >;
        this.active();
        return result;
      });
    this.writes = work;
    return work;
  }

  async update<T = unknown>(id: string, mutate: (value: T | null) => T | Promise<T>) {
    return (await this.transaction<T>([id], async (values) => ({ [id]: await mutate(values[id]) })))[id];
  }
}
