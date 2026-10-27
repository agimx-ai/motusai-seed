import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pluginDevelopmentStatusFile, type PluginDevelopmentStatus } from '@motus-ai/seed-sdk';

/** Publishes host feedback outside plugin bundles. Hidden status files never trigger plugin reloads. */
export class PluginDevelopmentStatusWriter {
  private readonly sessionId = randomUUID();
  private timer?: ReturnType<typeof setInterval>;
  private writes: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly root: string,
    private readonly appVersion: string,
    private readonly snapshot: () => Pick<PluginDevelopmentStatus, 'enabled' | 'plugins'>,
    private readonly report: (error: unknown) => void,
  ) {}

  async start() {
    await this.publish().catch(this.report);
    this.timer = setInterval(() => {
      void this.publish().catch(this.report);
    }, 2_000);
    this.timer.unref();
  }

  publish(): Promise<void> {
    const work = this.writes
      .catch(() => undefined)
      .then(async () => {
        if (this.stopped) return;
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        const directory = await lstat(this.root);
        if (!directory.isDirectory() || directory.isSymbolicLink())
          throw new Error('Invalid development status directory.');
        const status: PluginDevelopmentStatus = {
          schemaVersion: 1,
          sessionId: this.sessionId,
          pid: process.pid,
          appVersion: this.appVersion,
          updatedAt: Date.now(),
          ...this.snapshot(),
        };
        const temporary = join(this.root, '.seed-status-' + randomUUID());
        try {
          await writeFile(temporary, JSON.stringify(status) + '\n', { flag: 'wx', mode: 0o600 });
          await rename(temporary, join(this.root, pluginDevelopmentStatusFile));
        } finally {
          await rm(temporary, { force: true });
        }
      });
    this.writes = work;
    return work;
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.writes.catch(() => undefined);
    const target = join(this.root, pluginDevelopmentStatusFile);
    const status = await readFile(target, 'utf8')
      .then((body) => JSON.parse(body) as PluginDevelopmentStatus)
      .catch(() => undefined);
    if (status?.sessionId === this.sessionId) await rm(target, { force: true });
  }
}
