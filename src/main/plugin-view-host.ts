import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { dialog, type BrowserWindow, type Session } from 'electron';
import { z } from 'zod';
import { PluginRpcPeer, type PluginDataSnapshot, type RpcMessage } from '@motus-ai/seed-sdk';
import { ipcChannels, type SeedPluginRuntimeDefinition } from '../shared/contracts';
import type { PluginViewConfiguration, PluginViewEvent } from '../shared/plugin-view';

export type PluginViewServices = {
  loadData(packageId: string): Promise<PluginDataSnapshot>;
  saveData(packageId: string, data: unknown, revision: number, assertActive: () => void): Promise<PluginDataSnapshot>;
  call(packageId: string, method: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  reloadService?(packageId: string): Promise<void>;
};

const resources = new WeakMap<Session, Map<string, SeedPluginViewHost>>();
const contentTypes: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

/** Install before creating the product renderer so Chromium knows the resource loader. */
export function registerPluginViewProtocol(session: Session) {
  let entries = resources.get(session);
  if (!entries) {
    entries = new Map();
    resources.set(session, entries);
    session.protocol.handle('seed-plugin', async (request) => {
      try {
        const url = new URL(request.url);
        const current = entries!.get(url.hostname);
        if (!current?.active || request.method !== 'GET') return new Response('Forbidden', { status: 403 });
        const reference = decodeURIComponent(url.pathname).slice(1);
        if (!(current.plugin.resources ?? ['main.js']).includes(reference))
          return new Response('Forbidden', { status: 403 });
        const root = await realpath(current.plugin.root_path);
        const candidate = await realpath(resolve(root, reference));
        const boundary = relative(root, candidate);
        if (!boundary || boundary === '..' || boundary.startsWith('..' + sep))
          return new Response('Forbidden', { status: 403 });
        const bytes = await readFile(candidate);
        if (!current.active) return new Response('Gone', { status: 410 });
        return new Response(bytes, {
          headers: {
            'Content-Type': contentTypes[extname(candidate)] ?? 'application/octet-stream',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
  }
  return entries;
}

function registerResources(session: Session, host: SeedPluginViewHost) {
  const entries = registerPluginViewProtocol(session);
  entries.set(host.generation, host);
  return () => entries.delete(host.generation);
}

/** A scoped service/resource broker for trusted DOM plugins, not a rendering surface. */
export class SeedPluginViewHost {
  readonly generation = randomUUID();
  private rpc?: PluginRpcPeer;
  private owner?: BrowserWindow;
  private token?: string;
  private mounted = false;
  private stopped = false;
  private selectingFiles = false;
  private releaseResources?: () => void;

  get active() {
    return !this.stopped;
  }

  constructor(
    readonly plugin: SeedPluginRuntimeDefinition,
    private readonly services: PluginViewServices,
    private appearance: Pick<PluginViewConfiguration, 'locale' | 'theme'>,
    private readonly report: (error: Error) => void,
  ) {
    if (plugin.api_version !== 2 || !plugin.sdk_manifest) throw new Error('Plugin view requires SDK v2.');
  }

  private assertActive() {
    if (this.stopped) throw Object.assign(new Error('Plugin view runtime stopped.'), { code: 'plugin_view_stopped' });
  }

  mount(owner: BrowserWindow, token: string): PluginViewConfiguration {
    this.assertActive();
    if (owner.isDestroyed()) throw new Error('Plugin view owner is unavailable.');
    if (this.owner !== owner || this.token !== token) {
      this.send({ type: 'stop' });
      this.rpc?.close();
      this.releaseResources?.();
      this.owner = owner;
      this.token = token;
      this.releaseResources = registerResources(owner.webContents.session, this);
      this.rpc = new PluginRpcPeer(
        this.generation,
        (message) => this.send({ type: 'message', message }),
        async (method, args, signal) => {
          const assertCurrent = () => {
            this.assertActive();
            if (this.owner !== owner || this.token !== token || owner.isDestroyed() || signal.aborted)
              throw new Error('Plugin view owner is no longer active.');
          };
          assertCurrent();
          const id = this.plugin.package_id;
          if (method === 'runtime.reload') {
            if (!this.services.reloadService) throw new Error('Plugin service reload is unavailable.');
            await this.services.reloadService(id);
            return null;
          }
          if (method === 'data.load') return await this.services.loadData(id);
          if (method === 'data.save') {
            if (!Number.isSafeInteger(args.revision) || Number(args.revision) < 0)
              throw new Error('Invalid data revision.');
            return await this.services.saveData(id, args.data, Number(args.revision), assertCurrent);
          }
          if (method === 'files.pick') {
            const options = z
              .object({
                extensions: z
                  .array(z.string().regex(/^[a-zA-Z0-9]{1,16}$/))
                  .min(1)
                  .max(16)
                  .optional(),
                multiple: z.boolean().optional(),
              })
              .strict()
              .parse(args);
            if (!this.mounted || this.selectingFiles)
              throw new Error('File selection requires a mounted plugin surface.');
            this.selectingFiles = true;
            try {
              const result = await dialog.showOpenDialog(owner, {
                properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
                ...(options.extensions
                  ? { filters: [{ name: options.extensions.join(', '), extensions: options.extensions }] }
                  : {}),
              });
              assertCurrent();
              if (!this.mounted) throw new Error('Plugin surface was hidden during file selection.');
              return result.canceled ? [] : result.filePaths;
            } finally {
              this.selectingFiles = false;
            }
          }
          if (method.startsWith('service.'))
            return await this.services.call(id, method.slice('service.'.length), args, signal);
          throw new Error('Unknown plugin view operation.');
        },
      );
    }
    this.mounted = true;
    const base = 'seed-plugin://' + this.generation + '/';
    return {
      generation: this.generation,
      installationId: this.plugin.installation_id,
      manifest: this.plugin.sdk_manifest!,
      entryUrl: base + 'main.js',
      resources: this.plugin.resources,
      ...(this.plugin.resources?.includes('styles.css') ? { styleUrl: base + 'styles.css' } : {}),
      ...this.appearance,
    };
  }

  async receive(owner: BrowserWindow, token: string, message: unknown) {
    this.assertActive();
    if (this.owner !== owner || this.token !== token || owner.isDestroyed())
      throw new Error('Invalid plugin view owner.');
    const encoded = JSON.stringify(message);
    if (!encoded || encoded.length > 2 * 1024 * 1024) throw new Error('Invalid plugin view message size.');
    await this.rpc!.receive(message as RpcMessage);
  }

  private send(
    event:
      | Omit<Extract<PluginViewEvent, { type: 'message' }>, 'token'>
      | Omit<Extract<PluginViewEvent, { type: 'appearance' }>, 'token'>
      | { type: 'stop' },
  ) {
    if (this.owner && this.token && !this.owner.isDestroyed())
      this.owner.webContents.send(ipcChannels.pluginViewEvent, { token: this.token, ...event });
  }

  unmount(): void {
    this.mounted = false;
  }

  owns(owner: BrowserWindow, token: string): boolean {
    return this.active && this.owner === owner && this.token === token;
  }

  sendEvent(name: string, data: unknown): void {
    if (!this.active || !this.rpc) return;
    void this.rpc.call('view.event', { name, data }).catch((error) => {
      if (this.active) this.report(error);
    });
  }

  setAppearance(appearance: Pick<PluginViewConfiguration, 'locale' | 'theme'>): void {
    this.appearance = appearance;
    if (this.active) this.send({ type: 'appearance', appearance });
  }

  async destroy(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.send({ type: 'stop' });
    this.mounted = false;
    this.rpc?.close();
    this.releaseResources?.();
    this.owner = undefined;
  }
}
