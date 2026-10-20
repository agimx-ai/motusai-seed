import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PluginUpdateResult, SeedCatalogPlugin, SeedInstalledPlugin, SeedSnapshot } from '../shared/contracts';
import { getAvailablePluginUpdates } from '../shared/plugin-updates';
import { compareSeedVersions, seedVersionPattern } from '../shared/seed-version';

const checkpointSchema = z.object({
  appVersion: z.string().regex(seedVersionPattern),
  pending: z.array(z.string()),
}).strict();
export type PluginUpdateCheckpoint = z.infer<typeof checkpointSchema>;

type Options = {
  appVersion: string;
  account: () => string | undefined;
  automaticEnabled: () => boolean;
  installed: () => SeedInstalledPlugin[];
  canUpdate: (plugin: SeedInstalledPlugin) => boolean;
  refreshCatalog: () => Promise<SeedCatalogPlugin[]>;
  read: (account: string) => Promise<unknown>;
  write: (account: string, checkpoint: PluginUpdateCheckpoint) => Promise<void>;
  install: (id: string, version: string, signal: AbortSignal) => Promise<boolean>;
  changed: () => void;
};

export class PluginUpdates {
  private state: NonNullable<SeedSnapshot['pluginUpdates']> = { running: false };
  private work?: Promise<void>;
  private account?: string;
  private controller?: AbortController;
  private automaticWork = false;

  constructor(private readonly options: Options) {}

  snapshot() {
    return this.state;
  }

  automatic(catalog: SeedCatalogPlugin[]) {
    return this.run(catalog);
  }

  updateAll() {
    return this.run();
  }

  stopAutomatic() {
    if (this.automaticWork) this.controller?.abort();
  }

  async stop() {
    this.controller?.abort();
    await this.work;
    this.state = { running: false };
    this.options.changed();
  }

  private run(catalog?: SeedCatalogPlugin[]): Promise<void> {
    if (catalog !== undefined && !this.options.automaticEnabled()) return Promise.resolve();
    const account = this.options.account();
    if (!account) return Promise.resolve();
    if (this.work) {
      if (this.account === account && !this.controller?.signal.aborted) return this.work;
      return this.work.then(() => this.run(catalog));
    }
    this.account = account;
    const controller = new AbortController();
    this.controller = controller;
    this.automaticWork = catalog !== undefined;
    this.work = this.perform(account, controller.signal, catalog).finally(() => {
      this.work = undefined;
      this.controller = undefined;
      this.automaticWork = false;
    });
    return this.work;
  }

  private async perform(account: string, signal: AbortSignal, catalog?: SeedCatalogPlugin[]) {
    const automatic = catalog !== undefined;
    const result: PluginUpdateResult = { id: randomUUID(), updated: 0, cancelled: 0, failed: [] };
    let started = false;
    const active = () => !signal.aborted && this.options.account() === account &&
      (!automatic || this.options.automaticEnabled());
    try {
      const saved = await this.options.read(account);
      const previous = saved === undefined ? undefined : checkpointSchema.parse(saved);
      const versionOrder = previous ? compareSeedVersions(this.options.appVersion, previous.appVersion) : 1;
      if (automatic && (versionOrder < 0 || (versionOrder === 0 && !previous!.pending.length))) return;
      if (!active()) return;
      this.state = { running: true };
      started = true;
      this.options.changed();
      catalog ??= await this.options.refreshCatalog();
      if (!active()) return;
      const installed = this.options.installed().filter(this.options.canUpdate);
      const formal = installed.filter((plugin) => plugin.source !== 'development');
      const formalUpdates = getAvailablePluginUpdates(formal, catalog);
      const updates = automatic ? formalUpdates : getAvailablePluginUpdates(installed, catalog);
      const checkpoint: PluginUpdateCheckpoint = versionOrder === 0
        ? { appVersion: this.options.appVersion, pending: [...previous!.pending] }
        : {
            appVersion: this.options.appVersion,
            pending: [...new Set([
              ...formalUpdates.map((plugin) => plugin.id),
              ...formal.filter((plugin) => plugin.status === 'incompatible').map((plugin) => plugin.id),
            ])],
          };
      const persist = () => versionOrder < 0 ? Promise.resolve() : this.options.write(account, checkpoint);
      if (versionOrder !== 0) await persist();
      const ids = automatic ? checkpoint.pending.slice() : [...new Set([...updates.map((plugin) => plugin.id), ...checkpoint.pending])];
      for (const id of ids) {
        if (!active()) break;
        const current = this.options.installed().find((plugin) => plugin.id === id);
        const offered = catalog.find((plugin) => plugin.id === id);
        const update = current && getAvailablePluginUpdates([current], offered ? [offered] : [])[0];
        const settle = async () => {
          if (!checkpoint.pending.includes(id)) return;
          checkpoint.pending = checkpoint.pending.filter((pending) => pending !== id);
          await persist();
        };
        if (!current || (automatic && current.source === 'development')) {
          await settle();
          continue;
        }
        if (!this.options.canUpdate(current)) {
          result.failed.push({ pluginId: id, name: current.name, reason: '暂时无法确认插件使用权限，请稍后重试。' });
          continue;
        }
        if (!update) {
          if (current.status !== 'incompatible' && offered && compareSeedVersions(current.version, offered.latestVersion) >= 0) {
            await settle();
            continue;
          }
          result.failed.push({ pluginId: id, name: offered?.name ?? current.name, reason: '暂时没有可安装的兼容更新，请稍后重试。' });
          continue;
        }
        try {
          const installed = await this.options.install(id, update.latestVersion, signal);
          if (installed) result.updated++;
          else if (active()) result.cancelled++;
          if (installed || active()) await settle();
        } catch (error) {
          if (!active()) break;
          result.failed.push({ pluginId: id, name: update.name, reason: error instanceof Error ? error.message : String(error) });
        }
      }
    } catch (error) {
      if (active()) result.error = error instanceof z.ZodError
        ? '无法读取本机插件更新记录。'
        : error instanceof Error ? error.message : String(error);
    } finally {
      if (started || result.error) {
        const report = active() && (!automatic || result.updated || result.cancelled || result.failed.length || result.error);
        this.state = { running: false, ...(report ? { result } : {}) };
        this.options.changed();
      }
    }
  }
}
