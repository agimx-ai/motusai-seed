import { Notification, nativeImage, type NativeImage } from 'electron';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { SeedNavigationTarget, SystemNotificationEvent, SystemNotificationResult } from '@motus-ai/seed-sdk';
import type { SeedPluginRuntimeDefinition } from '../shared/contracts';

const optionsSchema = z
  .object({
    title: z.string().max(16_384).optional(),
    body: z.string().max(65_536).optional(),
    silent: z.boolean().optional(),
    icon: z.string().max(2_800_000).optional(),
    clickTarget: z
      .object({
        destination: z.literal('plugins'),
        pluginId: z.string().min(1).max(256).optional(),
        query: z.string().max(4096).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const requestSchema = z.discriminatedUnion('operation', [
  z.object({ version: z.literal(1), operation: z.literal('is-supported') }).strict(),
  z
    .object({ version: z.literal(1), operation: z.literal('show'), id: z.string().uuid(), notification: optionsSchema })
    .strict(),
  z.object({ version: z.literal(1), operation: z.literal('next'), id: z.string().uuid() }).strict(),
  z.object({ version: z.literal(1), operation: z.literal('close'), id: z.string().uuid() }).strict(),
]);
type Delivery = { done: boolean; event?: SystemNotificationEvent };
type Context = {
  plugin: SeedPluginRuntimeDefinition;
  enabled(): boolean;
  assertActive(): void;
  activate(target: SeedNavigationTarget): void;
};
type Entry = {
  owner: string;
  queue: SystemNotificationEvent[];
  native?: Notification;
  pending?: (value: Delivery) => void;
  settle?: (result: SystemNotificationResult) => void;
  loading?: boolean;
};
const imageLimit = 2_097_152;

async function iconImage(icon: string, plugin: SeedPluginRuntimeDefinition): Promise<NativeImage> {
  let image: NativeImage;
  if (icon.startsWith('data:')) {
    const match = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(icon);
    if (!match || Buffer.byteLength(match[1], 'base64') > imageLimit) throw new Error('Invalid notification image.');
    image = nativeImage.createFromDataURL(icon);
  } else {
    if (isAbsolute(icon) || !plugin.resources?.includes(icon))
      throw Object.assign(new Error('Notification image must be a declared plugin resource.'), {
        code: 'broker_path_denied',
      });
    const root = await realpath(plugin.root_path);
    const file = await realpath(resolve(root, icon));
    const boundary = relative(root, file);
    if (!boundary || boundary === '..' || boundary.startsWith(`..${sep}`) || isAbsolute(boundary))
      throw Object.assign(new Error('Notification image is outside the plugin.'), { code: 'broker_path_denied' });
    if ((await stat(file)).size > imageLimit) throw new Error('Notification image exceeds the size limit.');
    const bytes = await readFile(file);
    if (
      bytes.length > imageLimit ||
      !(
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        (bytes[0] === 255 && bytes[1] === 216)
      )
    )
      throw new Error('Notification image must be PNG or JPEG.');
    image = nativeImage.createFromBuffer(bytes);
  }
  const size = image.getSize();
  if (image.isEmpty() || size.width > 2048 || size.height > 2048)
    throw new Error('Invalid notification image dimensions.');
  return image;
}

export class SystemNotifications {
  private readonly active = new Map<string, Entry>();

  constructor(private readonly failed: (owner: string, reason: string) => void) {}

  private release(id: string, entry: Entry) {
    entry.settle?.('failed');
    if (this.active.get(id) === entry) this.active.delete(id);
    entry.native?.removeAllListeners();
    entry.native?.close();
    entry.pending?.({ done: true });
    entry.pending = undefined;
  }

  async invoke(owner: string, args: Record<string, unknown>, context: Context): Promise<unknown> {
    context.assertActive();
    const input = requestSchema.parse(args);
    if (input.operation === 'is-supported') return Notification.isSupported();
    const entry = this.active.get(input.id);
    if (entry && entry.owner !== owner)
      throw Object.assign(new Error('System notification belongs to another plugin.'), {
        code: 'broker_permission_denied',
      });
    if (input.operation === 'close') {
      if (entry) this.release(input.id, entry);
      return null;
    }
    if (input.operation === 'next') {
      if (!entry) return { done: true };
      if (entry.pending) throw new Error('Only one notification event read may be pending.');
      const event = entry.queue.shift();
      if (event) return { done: false, event };
      return await new Promise<Delivery>((resolve) => {
        entry.pending = resolve;
      });
    }
    if (!context.enabled()) return 'disabled';
    if (!Notification.isSupported()) return 'unsupported';
    if (entry?.settle || entry?.loading) throw new Error('System notification is already being shown.');
    if (
      !entry &&
      (this.active.size >= 256 || [...this.active.values()].filter((item) => item.owner === owner).length >= 64)
    )
      throw new Error('System notification limit reached. Close unused notifications.');
    const current: Entry = entry ?? { owner, queue: [] };
    current.loading = true;
    this.active.set(input.id, current);
    const { icon, clickTarget, ...options } = input.notification;
    let image: NativeImage | undefined;
    try {
      image = icon ? await iconImage(icon, context.plugin) : undefined;
      context.assertActive();
      if (this.active.get(input.id) !== current) throw new Error('System notification changed before showing.');
      if (!context.enabled()) {
        this.release(input.id, current);
        return 'disabled';
      }
    } catch (error) {
      if (!current.native && this.active.get(input.id) === current) this.release(input.id, current);
      throw error;
    } finally {
      current.loading = false;
    }
    let notification: Notification;
    try {
      notification = new Notification({ ...options, ...(image ? { icon: image } : {}) });
    } catch (error) {
      this.failed(owner, error instanceof Error ? error.message : String(error));
      this.release(input.id, current);
      return 'failed';
    }
    current.native?.removeAllListeners();
    current.native?.close();
    current.native = notification;
    const emit = (event: SystemNotificationEvent) => {
      try {
        context.assertActive();
      } catch {
        this.release(input.id, current);
        return;
      }
      if (this.active.get(input.id) !== current) return;
      if (current.pending) {
        const resolve = current.pending;
        current.pending = undefined;
        resolve({ done: false, event });
      } else if (current.queue.length < 64) current.queue.push(event);
      else {
        this.failed(owner, 'System notification event queue overflow.');
        this.release(input.id, current);
      }
    };
    return await new Promise<SystemNotificationResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.failed(owner, 'System notification did not report a send result.');
        this.release(input.id, current);
      }, 30_000);
      current.settle = (result) => {
        clearTimeout(timeout);
        current.settle = undefined;
        resolve(result);
      };
      notification.on('show', () => {
        emit('show');
        if (this.active.get(input.id) === current) current.settle?.('sent');
      });
      notification.on('click', () => {
        emit('click');
        if (this.active.get(input.id) === current && clickTarget && context.enabled()) context.activate(clickTarget);
      });
      notification.on('close', () => {
        emit('close');
        if (current.settle) this.release(input.id, current);
      });
      notification.on('failed', (_event, reason) => {
        this.failed(owner, String(reason));
        this.release(input.id, current);
      });
      try {
        notification.show();
      } catch (error) {
        this.failed(owner, error instanceof Error ? error.message : String(error));
        this.release(input.id, current);
      }
    });
  }

  clear(owner?: string) {
    for (const [id, entry] of this.active) if (!owner || entry.owner === owner) this.release(id, entry);
  }
}
