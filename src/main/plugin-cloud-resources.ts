import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { z } from 'zod';
import type { CloudResourceChange } from '@motus-ai/seed-sdk';
import type { SeedPluginRuntimeDefinition } from '../shared/contracts';

const resourceName = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const requestSchema = z
  .object({
    resource: resourceName,
    path: z.string().max(4096),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
    body: z.json().optional(),
  })
  .strict();
const inputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('request'), id: z.uuid(), request: requestSchema }).strict(),
  z.object({ operation: z.literal('cancel'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('watch'), resource: resourceName }).strict(),
  z.object({ operation: z.literal('next'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('unwatch'), id: z.uuid() }).strict(),
]);
type Session = { userId: string; baseUrl: string; token: string };
type Options = {
  plugin(id: string): SeedPluginRuntimeDefinition | undefined;
  session(rejectedToken?: string): Promise<Session>;
  fetch?: typeof fetch;
  socket?: (url: string, token: string) => WebSocket;
};
type Delivery = { done: boolean; change?: CloudResourceChange };
type Watch = {
  plugin: SeedPluginRuntimeDefinition;
  resource: string;
  epoch: number;
  change?: CloudResourceChange;
  pending?: { resolve(value: Delivery): void; reject(error: Error): void };
};
const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

function resourceUrl(base: string, pluginId: string, resource: string, path: string) {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\x00-\x20\x7f#]/.test(path))
    throw failure('cloud_resource_path_invalid', 'Invalid Cloud resource path.');
  const route = new URL(path, 'https://resource.invalid');
  const decoded = decodeURIComponent(path.split('?')[0]!);
  if (
    route.origin !== 'https://resource.invalid' ||
    !/^\/(?:[a-zA-Z0-9._-]+\/?)*$/.test(decoded) ||
    decoded.split('/').some((part) => part === '.' || part === '..') ||
    /%2f|%5c/i.test(path.split('?')[0]!)
  )
    throw failure('cloud_resource_path_invalid', 'Invalid Cloud resource path.');
  return new URL(
    `/api/v1/plugin-resources/${resource}/${encodeURIComponent(pluginId)}${route.pathname}${route.search}`,
    base,
  ).toString();
}
async function boundedJson(response: Response) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > 2 * 1024 * 1024)
        throw failure('cloud_resource_response_large', 'Cloud resource response exceeds the size limit.');
      chunks.push(item.value);
    }
    if (!size) return null;
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** One account connection; plugins receive bounded invalidation hints and scoped HTTP responses, never credentials. */
export class PluginCloudResourceBroker {
  private readonly requests = new Map<string, { plugin: SeedPluginRuntimeDefinition; controller: AbortController }>();
  private readonly watches = new Map<string, Watch>();
  private accountEvents?: (type: string | null) => void;
  private epoch = 0;
  private connecting = false;
  private socket?: WebSocket;
  private connection = 0;
  private retry = 0;
  private rejectedToken?: string;
  private reconnect?: ReturnType<typeof setTimeout>;
  private handshake?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private stable?: ReturnType<typeof setTimeout>;
  constructor(private readonly options: Options) {}

  private owner(id: string) {
    const plugin = this.options.plugin(id);
    if (!plugin || plugin.api_version !== 2 || !plugin.has_service)
      throw failure('broker_permission_denied', 'Plugin Cloud resource permission is unavailable.');
    return plugin;
  }
  private requireResource(plugin: SeedPluginRuntimeDefinition, resource: string) {
    if (!plugin.permissions.includes(`cloud.resources.${resource}`))
      throw failure('broker_permission_denied', 'Plugin is not authorized for this Cloud resource.');
  }
  private current(plugin: SeedPluginRuntimeDefinition, resource: string, epoch: number, assertActive?: () => void) {
    assertActive?.();
    if (epoch !== this.epoch || this.owner(plugin.package_id) !== plugin)
      throw failure('cloud_resource_owner_changed', 'Cloud resource owner is no longer active.');
    this.requireResource(plugin, resource);
  }
  async invoke(packageId: string, raw: Record<string, unknown>, assertActive?: () => void): Promise<unknown> {
    const plugin = this.owner(packageId);
    const epoch = this.epoch;
    assertActive?.();
    const input = inputSchema.parse(Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'package_id')));
    if (input.operation === 'cancel') {
      this.requests.get(packageId + ':' + input.id)?.controller.abort();
      return null;
    }
    if (input.operation === 'request') {
      const { resource } = input.request;
      this.requireResource(plugin, resource);
      const key = packageId + ':' + input.id;
      if (this.requests.has(key))
        throw failure('cloud_resource_request_duplicate', 'Cloud resource request is already active.');
      if ([...this.requests.values()].filter((value) => value.plugin.package_id === packageId).length >= 32)
        throw failure('cloud_resource_busy', 'Too many active Cloud resource requests.');
      if (input.request.method === 'GET' && input.request.body !== undefined)
        throw failure('cloud_resource_body_invalid', 'GET requests cannot have a body.');
      const body = input.request.body === undefined ? undefined : JSON.stringify(input.request.body);
      if (body && Buffer.byteLength(body) > 1_048_576)
        throw failure('cloud_resource_request_large', 'Cloud resource request exceeds the size limit.');
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
      this.requests.set(key, { plugin, controller });
      try {
        let session = await this.options.session();
        for (let attempt = 0; attempt < 2; attempt++) {
          this.current(plugin, resource, epoch, assertActive);
          signal.throwIfAborted();
          const url = resourceUrl(session.baseUrl, packageId, resource, input.request.path);
          const response = await (this.options.fetch ?? fetch)(url, {
            method: input.request.method,
            redirect: 'manual',
            signal,
            headers: {
              Authorization: 'Bearer ' + session.token,
              Accept: 'application/json',
              ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(body !== undefined ? { body } : {}),
          });
          this.current(plugin, resource, epoch, assertActive);
          signal.throwIfAborted();
          if (response.status === 401 && attempt === 0) {
            await response.body?.cancel();
            const next = await this.options.session(session.token);
            if (next.userId !== session.userId) throw failure('cloud_resource_owner_changed', 'Cloud account changed.');
            session = next;
            continue;
          }
          const value = await boundedJson(response).catch((error) => {
            if (error instanceof SyntaxError)
              throw failure('cloud_resource_response_invalid', 'Cloud returned an invalid resource response.');
            throw error;
          });
          this.current(plugin, resource, epoch, assertActive);
          signal.throwIfAborted();
          if (!response.ok) {
            const detail = value as { code?: unknown; message?: unknown } | null;
            const code =
              typeof detail?.code === 'string' && /^[a-z][a-z0-9_]{0,127}$/.test(detail.code)
                ? detail.code
                : 'cloud_resource_failed';
            const message =
              typeof detail?.message === 'string' && detail.message.length <= 512
                ? detail.message
                : 'Cloud resource request failed.';
            throw Object.assign(failure(code, message), { status: response.status });
          }
          return value;
        }
        throw failure('cloud_resource_auth_failed', 'Cloud authentication failed.');
      } finally {
        if (this.requests.get(key)?.controller === controller) this.requests.delete(key);
      }
    }
    if (input.operation === 'watch') {
      this.requireResource(plugin, input.resource);
      if ([...this.watches.values()].filter((value) => value.plugin.package_id === packageId).length >= 8)
        throw failure('cloud_resource_busy', 'Too many Cloud resource subscriptions.');
      const id = randomUUID();
      const watch: Watch = { plugin, resource: input.resource, epoch };
      this.watches.set(id, watch);
      if (this.socket?.readyState === WebSocket.OPEN) watch.change = { resource: input.resource, reset: true };
      this.connect();
      return { id };
    }
    const watch = this.watches.get(input.id);
    if (watch && watch.plugin !== plugin)
      throw failure('cloud_resource_subscription_denied', 'Cloud subscription is unavailable.');
    if (input.operation === 'unwatch') {
      this.closeWatch(input.id);
      return null;
    }
    if (!watch) throw failure('cloud_resource_subscription_closed', 'Cloud subscription ended.');
    try {
      this.current(watch.plugin, watch.resource, watch.epoch, assertActive);
    } catch (error) {
      this.closeWatch(input.id);
      throw error;
    }
    if (watch.pending) throw failure('cloud_resource_subscription_busy', 'A Cloud change is already being awaited.');
    if (watch.change) {
      const change = watch.change;
      delete watch.change;
      return { done: false, change };
    }
    return await new Promise<Delivery>((resolve, reject) => {
      watch.pending = { resolve, reject };
    });
  }

  private closeWatch(id: string, error?: Error) {
    const watch = this.watches.get(id);
    if (!watch) return;
    this.watches.delete(id);
    if (error) watch.pending?.reject(error);
    else watch.pending?.resolve({ done: true });
    if (!this.watches.size && !this.accountEvents) this.disconnect();
  }
  private changed(resource?: string, reset = false) {
    for (const [id, watch] of this.watches) {
      try {
        this.current(watch.plugin, watch.resource, watch.epoch);
      } catch {
        this.closeWatch(id);
        continue;
      }
      if (resource && resource !== watch.resource) continue;
      const change = { resource: watch.resource, reset: reset || watch.change?.reset === true };
      if (watch.pending) {
        const pending = watch.pending;
        delete watch.pending;
        pending.resolve({ done: false, change });
      } else watch.change = change;
    }
  }
  private disconnect() {
    this.connection++;
    this.connecting = false;
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.handshake) clearTimeout(this.handshake);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.stable) clearTimeout(this.stable);
    this.reconnect = undefined;
    this.handshake = undefined;
    this.heartbeat = undefined;
    this.stable = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.removeAllListeners();
    socket?.on('error', () => {});
    if (socket?.readyState === WebSocket.CONNECTING) socket.terminate();
    else socket?.close();
  }
  watchAccountEvents(listener: (type: string | null) => void) {
    this.accountEvents = listener;
    if (this.socket?.readyState === WebSocket.OPEN) listener(null);
    this.connect();
  }

  private schedule() {
    if ((!this.watches.size && !this.accountEvents) || this.reconnect) return;
    this.reconnect = setTimeout(
      () => {
        this.reconnect = undefined;
        this.connect();
      },
      Math.min(30_000, 500 * 2 ** Math.min(this.retry++, 6)),
    );
    this.reconnect.unref();
  }
  private connect() {
    if ((!this.watches.size && !this.accountEvents) || this.socket || this.connecting || this.reconnect) return;
    this.connecting = true;
    const connection = ++this.connection;
    void this.options
      .session(this.rejectedToken)
      .then((session) => {
        if (connection !== this.connection) return;
        this.rejectedToken = undefined;
        const url = new URL('/api/v1/ws', session.baseUrl);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = (this.socket =
          this.options.socket?.(url.toString(), session.token) ??
          new WebSocket(url, { headers: { Authorization: 'Bearer ' + session.token }, maxPayload: 64 * 1024 }));
        this.connecting = false;
        this.handshake = setTimeout(() => {
          if (this.socket === socket) socket.terminate();
        }, 10_000);
        this.handshake.unref();
        socket.on('open', () => {
          if (this.socket !== socket) return;
          if (this.handshake) clearTimeout(this.handshake);
          this.handshake = undefined;
          let pong = Date.now();
          socket.on('pong', () => {
            pong = Date.now();
          });
          this.heartbeat = setInterval(() => {
            if (Date.now() - pong > 45_000) socket.terminate();
            else socket.ping();
          }, 15_000);
          this.heartbeat.unref();
          this.stable = setTimeout(() => {
            this.retry = 0;
          }, 10_000);
          this.stable.unref();
          this.changed(undefined, true);
          this.accountEvents?.(null);
        });
        socket.on('message', (raw) => {
          if (this.socket !== socket) return;
          try {
            const event = JSON.parse(raw.toString());
            if (event.ver !== 1 || typeof event.type !== 'string') return;
            const match = /^plugin-resource\.([a-z][a-z0-9-]{0,63})\.changed$/.exec(event.type);
            if (match) this.changed(match[1]);
            else this.accountEvents?.(event.type);
          } catch {
            /* Invalid hints never substitute for authoritative resource reads. */
          }
        });
        socket.on('unexpected-response', (_request, response) => {
          response.resume();
          if (response.statusCode === 401) this.rejectedToken = session.token;
          if (response.statusCode === 403)
            for (const id of [...this.watches.keys()])
              this.closeWatch(
                id,
                failure('cloud_resource_denied', 'Cloud resource access was denied.'),
              );
          socket.terminate();
        });
        socket.on('error', () => {});
        socket.on('close', () => {
          if (this.socket !== socket) return;
          this.disconnect();
          this.schedule();
        });
      })
      .catch(() => {
        if (connection !== this.connection) return;
        this.connecting = false;
        this.schedule();
      });
  }
  closePlugin(packageId: string) {
    for (const [key, request] of this.requests)
      if (request.plugin.package_id === packageId) {
        request.controller.abort();
        this.requests.delete(key);
      }
    for (const [id, watch] of this.watches) if (watch.plugin.package_id === packageId) this.closeWatch(id);
  }
  reconnectNow() {
    this.disconnect();
    this.connect();
  }
  reset() {
    this.epoch++;
    this.accountEvents = undefined;
    for (const request of this.requests.values()) request.controller.abort();
    this.requests.clear();
    for (const id of [...this.watches.keys()])
      this.closeWatch(id, failure('cloud_resource_owner_changed', 'Cloud account changed.'));
    this.disconnect();
    this.rejectedToken = undefined;
    this.retry = 0;
  }
}
