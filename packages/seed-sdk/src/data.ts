export type PluginDataSnapshot = { revision: number; data: unknown | null };
export type PluginDataStore = {
  load(): Promise<PluginDataSnapshot>;
  save(data: unknown, expectedRevision: number): Promise<PluginDataSnapshot>;
};

/** UI and service share the authoritative store, but each reader keeps its own CAS revision. */
export class PluginDataAccess {
  private revision = 0;
  constructor(private readonly store: PluginDataStore) {}
  async load<T = unknown>(): Promise<T | null> {
    const snapshot = await this.store.load();
    this.revision = snapshot.revision;
    return snapshot.data as T | null;
  }
  async save(data: unknown): Promise<void> {
    const snapshot = await this.store.save(data, this.revision);
    this.revision = snapshot.revision;
  }
}
