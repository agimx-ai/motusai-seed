import { afterEach, describe, expect, it, vi } from 'vitest';
import { Notification, nativeImage } from 'electron';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SeedPluginRuntimeDefinition } from '../shared/contracts';
import { SystemNotifications } from './system-notifications';

const native = vi.hoisted(() => ({
  supported: true,
  error: undefined as Error | undefined,
  notifications: [] as any[],
  size: { width: 32, height: 32 },
  empty: false,
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const image = () => ({ getSize: () => native.size, isEmpty: () => native.empty });
  return {
    nativeImage: { createFromDataURL: vi.fn(image), createFromBuffer: vi.fn(image) },
    Notification: class extends EventEmitter {
      static isSupported = vi.fn(() => native.supported);
      show = vi.fn();
      close = vi.fn();
      constructor(readonly options: unknown) {
        super();
        if (native.error) throw native.error;
        native.notifications.push(this);
      }
    },
  };
});
const services: SystemNotifications[] = [],
  directories: string[] = [];
afterEach(async () => {
  services.splice(0).forEach((service) => service.clear());
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  native.notifications = [];
  native.supported = true;
  native.error = undefined;
  native.size = { width: 32, height: 32 };
  native.empty = false;
  vi.clearAllMocks();
  vi.useRealTimers();
});
const options = { title: 'Complete', body: 'Message', silent: true };
function setup() {
  const failed = vi.fn(),
    activate = vi.fn();
  const service = new SystemNotifications(failed);
  services.push(service);
  const plugin = {
    package_id: 'com.example.one',
    root_path: '/plugin',
    resources: [],
  } as unknown as SeedPluginRuntimeDefinition;
  const context = { plugin, activate, enabled: vi.fn(() => true), assertActive: vi.fn() };
  const call = (operation: string, args: Record<string, unknown> = {}, owner = plugin.package_id) =>
    service.invoke(owner, { version: 1, operation, ...args }, context);
  const id = crypto.randomUUID();
  const show = (notification = options) => call('show', { id, notification });
  return { service, failed, activate, context, call, id, show };
}
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

describe('portable system notification broker', () => {
  it('queries platform support without sending or requesting notification permission', async () => {
    const { call } = setup();
    expect(Notification.isSupported).not.toHaveBeenCalled();
    expect(await call('is-supported')).toBe(true);
    expect(native.notifications).toHaveLength(0);
  });
  it('does not construct notifications when disabled or unsupported', async () => {
    const { show, context } = setup();
    context.enabled.mockReturnValue(false);
    expect(await show()).toBe('disabled');
    context.enabled.mockReturnValue(true);
    native.supported = false;
    expect(await show()).toBe('unsupported');
    expect(native.notifications).toHaveLength(0);
  });
  it('relays show, click and close in order without an implicit click action', async () => {
    const { call, id, show, activate } = setup();
    const result = show(),
      notification = native.notifications[0];
    expect(notification.options).toEqual(options);
    notification.emit('show');
    expect(await result).toBe('sent');
    expect(await call('next', { id })).toEqual({ done: false, event: 'show' });
    const waiting = call('next', { id });
    notification.emit('close');
    expect(await waiting).toEqual({ done: false, event: 'close' });
    notification.emit('click');
    expect(await call('next', { id })).toEqual({ done: false, event: 'click' });
    expect(activate).not.toHaveBeenCalled();
    const pending = call('next', { id });
    await call('close', { id });
    expect(await pending).toEqual({ done: true });
    expect(notification.close).toHaveBeenCalledOnce();
    expect(await call('next', { id })).toEqual({ done: true });
  });
  it('allows explicit portable click navigation and keeps options changeable on re-show', async () => {
    const { call, id, context, activate } = setup();
    const target = { destination: 'plugins', pluginId: 'com.example.target', query: 'details' };
    let pending = call('show', { id, notification: { ...options, clickTarget: target } });
    native.notifications[0].emit('show');
    await pending;
    native.notifications[0].emit('click');
    expect(activate).toHaveBeenCalledExactlyOnceWith(target);
    pending = call('show', { id, notification: { body: 'Updated' } });
    native.notifications[1].emit('show');
    await pending;
    expect(native.notifications[0].close).toHaveBeenCalledOnce();
    expect(native.notifications[1].options).toEqual({ body: 'Updated' });
    context.assertActive.mockImplementation(() => {
      throw new Error('Plugin stopped');
    });
    native.notifications[1].emit('click');
    expect(activate).toHaveBeenCalledOnce();
    expect(native.notifications[1].close).toHaveBeenCalledOnce();
  });
  it('rejects platform-specific options, invalid protocol and cross-plugin access', async () => {
    const { call, id, show } = setup();
    for (const field of ['subtitle', 'hasReply', 'actions', 'sound', 'timeoutType', 'urgency', 'groupId', 'toastXml'])
      await expect(call('show', { id, notification: { ...options, [field]: true } })).rejects.toThrow();
    await expect(call('show', { id, notification: options, version: 2 })).rejects.toThrow();
    await expect(call('show', { id, notification: options, extra: true })).rejects.toThrow();
    const sent = show();
    native.notifications[0].emit('show');
    await sent;
    for (const operation of ['next', 'close', 'show'])
      await expect(
        call(operation, { id, ...(operation === 'show' ? { notification: options } : {}) }, 'com.example.two'),
      ).rejects.toMatchObject({ code: 'broker_permission_denied' });
    await call('next', { id });
    const next = call('next', { id });
    await expect(call('next', { id })).rejects.toThrow('Only one');
    await call('close', { id });
    await next;
  });
  it('clears only the stopped plugin and wakes blocked event readers', async () => {
    const { call, service, id, show } = setup();
    const other = crypto.randomUUID();
    const one = show(),
      two = call('show', { id: other, notification: options }, 'com.example.two');
    native.notifications.forEach((item) => item.emit('show'));
    await Promise.all([one, two]);
    await call('next', { id });
    const pending = call('next', { id });
    service.clear('com.example.one');
    expect(await pending).toEqual({ done: true });
    expect(native.notifications[0].close).toHaveBeenCalledOnce();
    expect(native.notifications[1].close).not.toHaveBeenCalled();
  });
  it('reports construction, send, early-close and timeout failures without leaving handles', async () => {
    vi.useFakeTimers();
    const { call, show, id, failed } = setup();
    native.error = new Error('Construction failed');
    expect(await show()).toBe('failed');
    native.error = undefined;
    const first = show();
    native.notifications[0].emit('failed', {}, 'Not allowed');
    expect(await first).toBe('failed');
    const second = show();
    native.notifications[1].emit('close');
    expect(await second).toBe('failed');
    const third = show();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await third).toBe('failed');
    expect(await call('next', { id })).toEqual({ done: true });
    expect(vi.getTimerCount()).toBe(0);
    expect(failed.mock.calls.map(([, message]) => message)).toEqual([
      'Construction failed',
      'Not allowed',
      'System notification did not report a send result.',
    ]);
  });
  it('rejects concurrent sends and bounds retained handles and unread event queues', async () => {
    const { call, show, id } = setup();
    const pending = show();
    await expect(show()).rejects.toThrow('already being shown');
    native.notifications[0].emit('show');
    await pending;
    for (let index = 1; index < 64; index++) {
      const next = call('show', { id: crypto.randomUUID(), notification: options });
      native.notifications[index].emit('show');
      await next;
    }
    await expect(call('show', { id: crypto.randomUUID(), notification: options })).rejects.toThrow('limit');
    for (let index = 0; index < 65; index++) native.notifications[0].emit('click');
    expect(native.notifications[0].close).toHaveBeenCalledOnce();
    expect(await call('next', { id })).toEqual({ done: true });
  });
  it('accepts portable PNG/JPEG data images and declared resource images, rejecting external paths and oversized images', async () => {
    const { call, id, context } = setup();
    const root = await mkdtemp(join(tmpdir(), 'seed-notification-images-'));
    directories.push(root);
    await mkdir(join(root, 'plugin'));
    await writeFile(join(root, 'plugin', 'icon.png'), png);
    await writeFile(join(root, 'outside.png'), png);
    await symlink(join(root, 'outside.png'), join(root, 'plugin', 'escape.png'));
    context.plugin.root_path = join(root, 'plugin');
    context.plugin.resources = ['icon.png', 'escape.png'];
    for (const icon of ['icon.png', 'data:image/png;base64,' + png.toString('base64'), 'data:image/jpeg;base64,/9j/']) {
      const pending = call('show', { id, notification: { ...options, icon } });
      await vi.waitFor(() => expect(native.notifications.length).toBeGreaterThan(0));
      const until = Date.now() + 1000;
      while (!native.notifications.at(-1)?.show.mock.calls.length && Date.now() < until)
        await new Promise((done) => setTimeout(done, 1));
      native.notifications.at(-1).emit('show');
      await pending;
      await call('close', { id });
      native.notifications = [];
    }
    expect(nativeImage.createFromBuffer).toHaveBeenCalledOnce();
    for (const icon of [
      '/etc/passwd',
      '../outside.png',
      'escape.png',
      'https://example.com/icon.png',
      'data:image/svg+xml;base64,PHN2Zz4=',
    ])
      await expect(call('show', { id, notification: { ...options, icon } })).rejects.toThrow();
    native.size = { width: 2049, height: 1 };
    await expect(
      call('show', { id, notification: { ...options, icon: 'data:image/png;base64,' + png.toString('base64') } }),
    ).rejects.toThrow('dimensions');
  });
  it('does not send after a close or plugin reload during resource image loading', async () => {
    const { call, id, context } = setup();
    const root = await mkdtemp(join(tmpdir(), 'seed-notification-race-'));
    directories.push(root);
    await writeFile(join(root, 'icon.png'), png);
    context.plugin.root_path = root;
    context.plugin.resources = ['icon.png'];
    const sending = call('show', { id, notification: { icon: 'icon.png' } });
    await call('close', { id });
    await expect(sending).rejects.toThrow('changed');
    expect(native.notifications).toHaveLength(0);
    const stopped = call('show', { id, notification: { icon: 'icon.png' } });
    context.assertActive.mockImplementation(() => {
      throw new Error('Plugin stopped');
    });
    await expect(stopped).rejects.toThrow('stopped');
    expect(native.notifications).toHaveLength(0);
  });
});
