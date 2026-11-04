import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SeedPluginRuntimeDefinition } from '../shared/contracts';
import { PluginCloudResourceBroker } from './plugin-cloud-resources';

class Socket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  close = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  });
  terminate = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  });
  ping = vi.fn();
  open() {
    this.readyState = WebSocket.OPEN;
    this.emit('open');
  }
}
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
});
function fixture() {
  const plugins = new Map(
    ['a', 'b'].map((id) => [
      id,
      {
        package_id: 'com.example.' + id,
        api_version: 2,
        has_service: true,
        permissions: id === 'a' ? ['cloud.resources.inventory'] : ['cloud.resources.monitor'],
      } as SeedPluginRuntimeDefinition,
    ]),
  );
  const session = vi.fn(async (_rejected?: string) => ({
    userId: 'user',
    baseUrl: 'https://cloud.example.test',
    token: 'offline-token',
  }));
  const upstream = vi.fn<typeof fetch>(async () => Response.json({ items: [{ quantity: 6885, active: false }] }));
  const sockets: Socket[] = [];
  const socket = vi.fn(() => {
    const next = new Socket();
    sockets.push(next);
    return next as unknown as WebSocket;
  });
  const broker = new PluginCloudResourceBroker({
    plugin: (id) => [...plugins.values()].find((plugin) => plugin.package_id === id),
    session,
    fetch: upstream,
    socket,
  });
  cleanup.push(() => broker.reset());
  const call = (id: string, input: Record<string, unknown>) => broker.invoke('com.example.' + id, input);
  const request = (id = crypto.randomUUID(), path = '/items', resource = 'inventory') => ({
    operation: 'request',
    id,
    request: { resource, path },
  });
  return { broker, plugins, session, upstream, socket, sockets, call, request };
}
describe('authenticated plugin-scoped Cloud resources', () => {
  it('uses the actual caller namespace and keeps credentials outside response DTOs', async () => {
    const { call, request, upstream } = fixture();
    const result = await call('a', { ...request(), package_id: 'com.example.b' });
    expect(upstream.mock.calls[0]![0]).toBe('https://cloud.example.test/api/v1/plugin-resources/inventory/com.example.a/items');
    expect(new Headers(upstream.mock.calls[0]![1]!.headers).get('Authorization')).toBe('Bearer offline-token');
    expect(upstream.mock.calls[0]![1]!.redirect).toBe('manual');
    expect(result).toEqual({ items: [{ quantity: 6885, active: false }] });
    expect(JSON.stringify(result)).not.toContain('offline-token');
  });
  it('requires active permission and rejects namespace escapes and oversized request bodies before fetch', async () => {
    const { call, request, upstream, plugins } = fixture();
    plugins.get('a')!.permissions = [];
    await expect(call('a', request())).rejects.toMatchObject({ code: 'broker_permission_denied' });
    plugins.get('a')!.permissions = ['cloud.resources.inventory'];
    for (const path of [
      '//evil.example/x',
      '/../../oauth2/userinfo',
      '/%2e%2e/userinfo',
      '/rooms%2f..',
      '/rooms\\x',
      '/rooms#secret',
    ])
      await expect(call('a', request(crypto.randomUUID(), path))).rejects.toThrow();
    const huge = request();
    Object.assign(huge.request, { method: 'POST', body: { text: 'a'.repeat(1_048_576) } });
    await expect(call('a', huge)).rejects.toMatchObject({ code: 'cloud_resource_request_large' });
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects resources outside the caller’s exact grants before any Cloud I/O', async () => {
    const { call, request, plugins, session, upstream, socket } = fixture();
    const watch = { operation: 'watch', resource: 'inventory' };
    const denied = { code: 'broker_permission_denied' };
    await expect(call('b', request())).rejects.toMatchObject(denied);
    await expect(call('b', watch)).rejects.toMatchObject(denied);
    plugins.get('a')!.permissions = ['cloud.resources', 'cloud.resources.inventory-preview'];
    await expect(call('a', request())).rejects.toMatchObject(denied);
    await expect(call('a', watch)).rejects.toMatchObject(denied);
    expect(session).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
  });
  it('rechecks the grant before returning an in-flight response', async () => {
    const { call, request, plugins, upstream } = fixture();
    let reply!: (response: Response) => void;
    upstream.mockImplementationOnce(() => new Promise((resolve) => { reply = resolve; }));
    const result = expect(call('a', request())).rejects.toMatchObject({ code: 'broker_permission_denied' });
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledOnce());
    plugins.get('a')!.permissions = [];
    reply(Response.json({ items: ['private'] }));
    await result;
  });
  it('refreshes a rejected token once and preserves a readable API error without raw JSON', async () => {
    const { call, request, session, upstream } = fixture();
    upstream.mockResolvedValueOnce(Response.json({ code: 'invalid_token' }, { status: 401 }));
    await call('a', request());
    expect(session).toHaveBeenLastCalledWith('offline-token');
    expect(upstream).toHaveBeenCalledTimes(2);
    upstream.mockResolvedValueOnce(
      Response.json({ code: 'insufficient_scope', message: 'Please sign in again' }, { status: 403 }),
    );
    await expect(call('a', request())).rejects.toMatchObject({
      code: 'insufficient_scope',
      message: 'Please sign in again',
      status: 403,
    });
  });
  it('bounds response bytes and does not follow authenticated redirects to another origin', async () => {
    const { call, request, upstream } = fixture();
    upstream.mockResolvedValueOnce(new Response('a'.repeat(2 * 1024 * 1024 + 1)));
    await expect(call('a', request())).rejects.toMatchObject({ code: 'cloud_resource_response_large' });
    upstream.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: 'https://other.example.test' } }),
    );
    await expect(call('a', request())).rejects.toMatchObject({ status: 302 });
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(upstream.mock.calls.every((call) => String(call[0]).startsWith('https://cloud.example.test/api/v1/'))).toBe(
      true,
    );
  });
  it('cancels only the originating plugin request and releases active I/O on plugin withdrawal', async () => {
    const { call, request, upstream, broker } = fixture();
    const signals: AbortSignal[] = [];
    upstream.mockImplementation(
      async (_url, init) =>
        await new Promise((_resolve, reject) => {
          const signal = init!.signal!;
          signals.push(signal);
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const id = crypto.randomUUID();
    const one = call('a', request(id)).catch((error) => error);
    const two = call('b', request(id, '/items', 'monitor')).catch((error) => error);
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    await call('b', { operation: 'cancel', id });
    expect(signals[0]!.aborted).toBe(false);
    expect(signals[1]!.aborted).toBe(true);
    broker.closePlugin('com.example.a');
    expect(signals[0]!.aborted).toBe(true);
    expect((await one).name).toBe('AbortError');
    expect((await two).name).toBe('AbortError');
  });
  it('fences a late old generation without deleting a replacement request with the same id', async () => {
    const { call, request, session, upstream, plugins, broker } = fixture();
    let release!: (value: Awaited<ReturnType<typeof session>>) => void;
    session.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const id = crypto.randomUUID();
    const old = call('a', request(id)).catch((error) => error);
    broker.closePlugin('com.example.a');
    plugins.set('a', { ...plugins.get('a')! });
    let signal!: AbortSignal;
    upstream.mockImplementationOnce(
      async (_url, init) =>
        await new Promise((_resolve, reject) => {
          signal = init!.signal!;
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    const next = call('a', request(id)).catch((error) => error);
    await vi.waitFor(() => expect(signal).toBeDefined());
    release({ userId: 'user', baseUrl: 'https://cloud.example.test', token: 'old' });
    expect((await old).code).toBe('cloud_resource_owner_changed');
    await call('a', { operation: 'cancel', id });
    expect(signal.aborted).toBe(true);
    await next;
  });
  it('shares one authenticated connection, coalesces hints, and never forwards server payloads', async () => {
    const { call, sockets, socket } = fixture();
    const one = (await call('a', { operation: 'watch', resource: 'inventory' })) as { id: string };
    const two = (await call('b', { operation: 'watch', resource: 'monitor' })) as { id: string };
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.open();
    expect(socket).toHaveBeenCalledWith('wss://cloud.example.test/api/v1/ws', 'offline-token');
    expect(await call('a', { operation: 'next', id: one.id })).toEqual({
      done: false,
      change: { resource: 'inventory', reset: true },
    });
    await call('b', { operation: 'next', id: two.id });
    for (let index = 0; index < 20; index++)
      sockets[0]!.emit(
        'message',
        Buffer.from(JSON.stringify({ ver: 1, type: 'plugin-resource.inventory.changed', payload: 'private server data' })),
      );
    expect(await call('a', { operation: 'next', id: one.id })).toEqual({
      done: false,
      change: { resource: 'inventory', reset: false },
    });
    await expect(call('b', { operation: 'next', id: one.id })).rejects.toMatchObject({
      code: 'cloud_resource_subscription_denied',
    });
    const waiting = call('b', { operation: 'next', id: two.id });
    await call('b', { operation: 'unwatch', id: two.id });
    expect(await waiting).toEqual({ done: true });
    await call('a', { operation: 'unwatch', id: one.id });
    expect(sockets[0]!.close).toHaveBeenCalled();
  });
  it('ignores account events and closes subscriptions when their resource grant is withdrawn', async () => {
    const { call, sockets, plugins } = fixture();
    const { id } = (await call('a', { operation: 'watch', resource: 'inventory' })) as { id: string };
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0]!;
    socket.open();
    await call('a', { operation: 'next', id });
    socket.emit('message', JSON.stringify({ ver: 1, type: 'inventory.changed' }));
    const waiting = call('a', { operation: 'next', id });
    plugins.get('a')!.permissions = [];
    socket.emit('message', JSON.stringify({ ver: 1, type: 'plugin-resource.inventory.changed' }));
    expect(await waiting).toEqual({ done: true });
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it('invalidates pending waits and late session initialization when the account changes', async () => {
    const { call, broker, sockets, session } = fixture();
    let release!: (value: Awaited<ReturnType<typeof session>>) => void;
    session.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const watch = (await call('a', { operation: 'watch', resource: 'inventory' })) as { id: string };
    const waiting = call('a', { operation: 'next', id: watch.id }).catch((error) => error);
    broker.reset();
    expect((await waiting).code).toBe('cloud_resource_owner_changed');
    release({ userId: 'user', baseUrl: 'https://cloud.example.test', token: 'late' });
    await Promise.resolve();
    expect(sockets).toHaveLength(0);
  });
  it('terminates a stalled handshake and reconnects once for all remaining subscribers', async () => {
    vi.useFakeTimers();
    const { call, sockets, broker } = fixture();
    await call('a', { operation: 'watch', resource: 'inventory' });
    await Promise.resolve();
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets[0]!.terminate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500);
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    broker.reset();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(2);
  });
});
