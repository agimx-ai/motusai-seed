import { describe, expect, it, vi } from 'vitest';
import {
  PluginService,
  type PluginManifest,
  type PluginServices,
  type SystemNotificationEvent,
} from '@motus-ai/seed-sdk';

const manifest: PluginManifest = {
  id: 'com.example.notifications',
  name: 'Notifications',
  version: '1.0.0',
  minAppVersion: '0.3.5',
  description: 'Notification fixture',
  author: 'Example',
};
const options = { title: 'Complete', body: 'Your task is complete.', silent: true };
function setup(result: unknown = 'sent') {
  const reads = new Map<string, (value: unknown) => void>();
  const queues = new Map<string, SystemNotificationEvent[]>();
  const error = vi.fn(async () => {});
  const invokeHost = vi.fn(async (_service: string, args: Record<string, unknown>): Promise<unknown> => {
    const id = String(args.id);
    if (args.operation === 'is-supported') return true;
    if (args.operation === 'close') {
      reads.get(id)?.({ done: true });
      reads.delete(id);
      return null;
    }
    if (args.operation === 'next') {
      const event = queues.get(id)?.shift();
      if (event) return { done: false, event };
      return await new Promise((resolve) => {
        reads.set(id, resolve);
      });
    }
    return result;
  });
  const service = new PluginService({ invokeHost, diagnostics: { error } } as unknown as PluginServices, manifest);
  const emit = (id: string, event: SystemNotificationEvent) => {
    const read = reads.get(id);
    if (read) {
      reads.delete(id);
      read({ done: false, event });
    } else {
      const queue = queues.get(id) ?? [];
      queue.push(event);
      queues.set(id, queue);
    }
  };
  return { service, invokeHost, emit, error, reads };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SDK portable system notifications', () => {
  it.each(['sent', 'disabled', 'unsupported', 'failed'])('returns %s through the convenience API', async (result) => {
    const { service, invokeHost } = setup(result);
    await service.load();
    const handle = await service.app.notifications.show(options);
    expect(handle.result).toBe(result);
    if (result !== 'sent') await handle.closed;
    expect(invokeHost.mock.calls[0]).toEqual([
      'seed.notifications',
      {
        version: 1,
        operation: 'show',
        id: expect.any(String),
        notification: options,
      },
    ]);
    await service.unload();
  });
  it('queries support without creating a notification', async () => {
    const { service, invokeHost } = setup();
    await service.load();
    expect(await service.app.notifications.isSupported()).toBe(true);
    expect(invokeHost).toHaveBeenCalledExactlyOnceWith('seed.notifications', { version: 1, operation: 'is-supported' });
    await service.unload();
  });
  it('delivers show, click and close callbacks with a controllable handle and no timers for event delivery', async () => {
    const { service, emit, invokeHost } = setup();
    await service.load();
    const handle = service.app.notifications.create(options);
    const show = vi.fn(),
      click = vi.fn(),
      close = vi.fn();
    handle.on('show', show);
    const stopClick = handle.on('click', click);
    handle.on('close', close);
    expect(invokeHost).not.toHaveBeenCalled();
    await handle.show();
    emit(handle.id, 'show');
    emit(handle.id, 'click');
    emit(handle.id, 'close');
    await flush();
    expect(show).toHaveBeenCalledExactlyOnceWith(handle);
    expect(click).toHaveBeenCalledExactlyOnceWith(handle);
    expect(close).toHaveBeenCalledExactlyOnceWith(handle);
    stopClick();
    emit(handle.id, 'click');
    await flush();
    expect(click).toHaveBeenCalledOnce();
    const updated = {
      title: 'Updated',
      body: 'Ready',
      icon: 'images/icon.png',
      clickTarget: { destination: 'plugins' as const, pluginId: 'com.example.target', query: 'details' },
    };
    await handle.show(updated);
    expect(invokeHost).toHaveBeenCalledWith('seed.notifications', {
      version: 1,
      operation: 'show',
      id: handle.id,
      notification: updated,
    });
    await handle.close();
    await handle.closed;
    expect(invokeHost).toHaveBeenCalledWith('seed.notifications', { version: 1, operation: 'close', id: handle.id });
    await expect(handle.show()).rejects.toThrow('closed');
    expect(() => handle.on('click', click)).toThrow('closed');
    await service.unload();
  });
  it('attaches convenience callbacks before the send completes', async () => {
    const { service, emit, invokeHost } = setup();
    const click = vi.fn();
    await service.load();
    const sending = service.app.notifications.show(options, { click });
    const id = String(invokeHost.mock.calls[0][1].id);
    emit(id, 'click');
    expect((await sending).result).toBe('sent');
    await flush();
    expect(click).toHaveBeenCalledOnce();
    await service.unload();
  });
  it('allows a click callback to close its own notification without waiting on itself', async () => {
    const { service, emit, invokeHost } = setup();
    await service.load();
    const notification = await service.app.notifications.show(options, {
      click: async (handle) => {
        await handle.close();
      },
    });
    emit(notification.id, 'click');
    await notification.closed;
    expect(invokeHost.mock.calls.filter(([, args]) => args.operation === 'close')).toHaveLength(1);
    await service.unload();
  });
  it('preserves permission errors and rejects malformed host replies', async () => {
    const { service, invokeHost } = setup();
    await service.load();
    const denied = Object.assign(new Error('Denied'), { code: 'broker_permission_denied' });
    invokeHost.mockRejectedValueOnce(denied);
    await expect(service.app.notifications.show(options)).rejects.toBe(denied);
    for (const result of [null, true, {}, 'ok']) {
      invokeHost.mockResolvedValueOnce(result);
      await expect(service.app.notifications.show(options)).rejects.toThrow('Invalid system notification result');
    }
    invokeHost.mockResolvedValueOnce('true');
    await expect(service.app.notifications.isSupported()).rejects.toThrow('Invalid system notification support result');
    await service.unload();
  });
  it('isolates callback errors and exposes event transport failure through closed', async () => {
    const { service, emit, reads, error } = setup();
    await service.load();
    const handle = service.app.notifications.create(options);
    handle.on('click', async () => {
      throw new Error('Callback failed');
    });
    await handle.show();
    emit(handle.id, 'click');
    await flush();
    expect(error).toHaveBeenCalledWith(
      'plugin.notification.failed',
      expect.objectContaining({ message: 'Callback failed' }),
    );
    reads.get(handle.id)?.({ done: false, event: 'invalid' });
    await expect(handle.closed).rejects.toThrow('Invalid system notification event');
    await service.unload();
  });
  it('releases handles and pending event reads on unload without delivering late callbacks', async () => {
    const { service, emit, invokeHost, reads } = setup();
    await service.load();
    const handle = service.app.notifications.create(options),
      click = vi.fn();
    handle.on('click', click);
    await handle.show();
    await service.unload();
    await handle.closed;
    emit(handle.id, 'click');
    await flush();
    expect(click).not.toHaveBeenCalled();
    expect(reads.size).toBe(0);
    expect(() => service.app.notifications.create(options)).toThrow('unloaded');
    await expect(service.app.notifications.isSupported()).rejects.toThrow('unloaded');
    expect(invokeHost.mock.calls.filter(([, args]) => args.operation === 'close')).toHaveLength(1);
  });
  it.each(['close', 'unload'])('does not accept late send results after %s', async (action) => {
    const { service, invokeHost } = setup();
    await service.load();
    let resolve!: (result: unknown) => void;
    invokeHost.mockImplementationOnce(
      async () =>
        await new Promise((done) => {
          resolve = done;
        }),
    );
    const handle = service.app.notifications.create(options),
      pending = handle.show();
    if (action === 'close') await handle.close();
    else await service.unload();
    resolve('sent');
    await expect(pending).rejects.toThrow(action === 'close' ? 'closed' : 'unloaded');
    expect(invokeHost.mock.calls.filter(([, args]) => args.operation === 'next')).toHaveLength(0);
    await service.unload();
  });
});
