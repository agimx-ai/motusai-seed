import { randomUUID } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { chmod, lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SeedInstalledPlugin, SeedPluginRuntimeDefinition } from '../shared/contracts';
import { compareSeedVersions } from '../shared/seed-version';
import { directoryRuntimePlugin, inspectPluginDirectory } from './plugin-directory';

type Entry = { installed: SeedInstalledPlugin; runtime: SeedPluginRuntimeDefinition };
const pluginId = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;

/** Development source only. Uses the same manifest reader and runtime as downloaded packages. */
export class DevelopmentPluginSource {
  private readonly entries = new Map<string, Entry>();
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private refreshing: Promise<Entry[]> = Promise.resolve([]);

  constructor(
    readonly root: string,
    private readonly appVersion: string,
    private readonly onChange: () => void,
    private readonly report: (id: string, error: unknown) => void,
  ) {}

  async start() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await lstat(this.root)).isSymbolicLink()) throw new Error('Development root cannot be a symbolic link.');
    this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
      if (filename?.toString().split(/[\\/]/)[0]?.startsWith('.')) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (!this.stopped) this.onChange();
      }, 160);
    });
    this.watcher.on('error', (error) => this.report('', error));
  }

  has(id: string) {
    return this.entries.has(id);
  }

  refresh(): Promise<Entry[]> {
    const work = this.refreshing.catch(() => []).then(() => this.scan());
    this.refreshing = work;
    return work;
  }

  private async scan(): Promise<Entry[]> {
    if (this.stopped) return [];
    const present = new Set<string>();
    for (const child of await readdir(this.root, { withFileTypes: true })) {
      if (!pluginId.test(child.name)) continue;
      present.add(child.name);
      try {
        if (!child.isDirectory() || child.isSymbolicLink())
          throw new Error('Development plugins must be regular directories.');
        const inspected = await inspectPluginDirectory(join(this.root, child.name));
        const { manifest, manifestDigest } = inspected;
        if (manifest.id !== child.name) throw new Error('Plugin directory name must match manifest.id.');
        if (compareSeedVersions(this.appVersion, manifest.minSeedVersion) < 0)
          throw new Error('Plugin requires a newer Seed client.');
        if (this.entries.get(child.name)?.installed.manifestDigest === manifestDigest) continue;
        // Run an immutable snapshot, not files being rewritten by a compiler. Failed builds keep the last good bundle.
        const snapshot = join(this.root, '.runtime', child.name, manifestDigest.slice(7));
        for (const directory of [join(this.root, '.runtime'), join(this.root, '.runtime', child.name)]) {
          await mkdir(directory, { recursive: true, mode: 0o700 });
          if ((await lstat(directory)).isSymbolicLink())
            throw new Error('Runtime snapshot paths cannot be symbolic links.');
        }
        const existing = await lstat(snapshot).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return undefined;
        });
        if (!existing) {
          const staging = join(this.root, '.runtime', child.name, '.building-' + randomUUID());
          await mkdir(staging, { mode: 0o700 });
          try {
            for (const [path, body] of inspected.files) {
              const target = join(staging, path);
              await mkdir(dirname(target), { recursive: true, mode: 0o700 });
              await writeFile(target, body, { flag: 'wx', mode: 0o600 });
            }
            for (const sidecar of manifest.sidecars) await chmod(join(staging, sidecar.path), 0o700);
            await rename(staging, snapshot);
          } finally {
            await rm(staging, { recursive: true, force: true });
          }
        }
        const sealed = await inspectPluginDirectory(snapshot, manifestDigest.slice(7));
        if (this.stopped) return [];
        this.entries.set(child.name, {
          installed: {
            id: manifest.id,
            name: manifest.name,
            description: manifest.description,
            labels: [],
            version: manifest.version,
            publisher: manifest.publisher,
            runtimeKind: manifest.runtime.kind,
            visibility: 'public',
            manifestDigest,
            iconDataUrl: inspected.iconDataUrl,
            iconDarkDataUrl: inspected.iconDarkDataUrl,
            capabilities: [],
            permissions: manifest.permissions,
            source: 'development',
            publisherType: 'official',
            status: 'ready',
            enabled: true,
          },
          runtime: {
            ...directoryRuntimePlugin(sealed, 'official'),
            configuration_revision: manifestDigest,
            source: 'development',
          },
        });
      } catch (error) {
        // Incomplete/manual edits must not unload an otherwise healthy previous generation.
        this.report(child.name, error);
      }
    }
    for (const id of this.entries.keys()) if (!present.has(id)) this.entries.delete(id);
    return [...this.entries.values()];
  }

  /** Called after old view/service generations have stopped. Never touches source, installed packages or user data. */
  async pruneSnapshots() {
    const root = join(this.root, '.runtime');
    if (
      await lstat(root).then(
        (metadata) => metadata.isSymbolicLink(),
        () => false,
      )
    )
      throw new Error('Runtime snapshot root cannot be a symbolic link.');
    const ids = await readdir(root).catch(() => [] as string[]);
    for (const id of ids) {
      if (!pluginId.test(id) || (await lstat(join(root, id))).isSymbolicLink()) continue;
      const retained = this.entries.get(id)?.installed.manifestDigest.slice(7);
      for (const digest of await readdir(join(root, id)))
        if (/^[0-9a-f]{64}$/.test(digest) && digest !== retained)
          await rm(join(root, id, digest), { recursive: true, force: true });
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.watcher?.close();
    await this.refreshing.catch(() => undefined);
  }
}
