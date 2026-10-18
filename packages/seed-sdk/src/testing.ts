import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { PluginService, type PluginServices, type PluginManifest, type ServiceApp } from './plugin.js';
import { createPluginI18n, type PluginTranslations } from './i18n.js';
import type { CapabilityDefinition } from './capability.js';
import type {
  SeedCapabilityHandler,
  SeedPluginCapabilityService,
  SeedPluginAuditRecord,
  SeedDiagnosticService,
  SeedBrowserAuthorizationRequest,
  SeedBrowserAuthorizationResult,
} from './index.js';

export type PluginTestEntry =
  | (new (app: PluginServices, manifest: PluginManifest) => PluginService)
  | ((app: ServiceApp, owner: PluginService) => void | Promise<void>);

export type PluginTestOptions = {
  project: URL;
  packageId?: string;
  dataPath?: string;
  version?: string;
  locale?: string;
  /** Raw stored records also allow corruption/upgrade fixtures. */
  settings?: Record<string, unknown>;
  beforeSettingsSave?: (updates: Array<{ id: string; value: unknown }>) => Promise<void>;
  secrets?: PluginServices['secrets'];
  invokeHost?: PluginServices['invokeHost'];
  invokeCapability?: SeedPluginCapabilityService['invoke'];
  listCapabilities?: SeedPluginCapabilityService['list'];
  audit?: (entry: SeedPluginAuditRecord) => Promise<void>;
  diagnostics?: SeedDiagnosticService;
  authorize?: (
    request: SeedBrowserAuthorizationRequest,
    signal?: AbortSignal,
  ) => Promise<SeedBrowserAuthorizationResult>;
  registerLocalApi?: PluginServices['localApi']['register'];
  event?: (name: string, data: unknown) => Promise<void>;
};

export async function projectTranslations(project: URL): Promise<PluginTranslations> {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', project), 'utf8'));
  const declaration = manifest.i18n;
  const resources = Object.fromEntries(
    await Promise.all(
      Object.entries(declaration?.resources ?? {}).map(async ([locale, path]) => [
        locale,
        JSON.parse(await readFile(new URL(String(path), project), 'utf8')),
      ]),
    ),
  );
  return declaration
    ? { defaultLocale: declaration.defaultLocale, resources }
    : { defaultLocale: 'en-US', resources: { 'en-US': {} } };
}

export { capabilityPackageMetadata as describeTestCapabilities } from './capability.js';

/** Independent service fixture; production host validation and OS integration have separate tests. */
export async function mountPluginService(entry: PluginTestEntry, options: PluginTestOptions) {
  const metadata = JSON.parse(await readFile(new URL('manifest.json', options.project), 'utf8'));
  if (options.packageId && options.packageId !== metadata.id) throw new Error('Test plugin identity mismatch.');
  const translations = await projectTranslations(options.project),
    i18n = createPluginI18n(translations, options.locale);
  const definitions = new Map<string, CapabilityDefinition>(),
    handlers = new Map<string, SeedCapabilityHandler>();
  const settings = options.settings ?? {},
    secrets = new Map<string, string>(),
    tasks = new Set<AbortController>();
  const connections = new Map<string, { reconnect?: () => void | Promise<void>; dispose: () => Promise<void> }>();
  const disposers: Array<() => void | Promise<void>> = [];
  const revision = (value: unknown) =>
    createHash('sha256')
      .update(JSON.stringify(value === undefined ? { exists: false } : { exists: true, value }))
      .digest('hex');
  let data: { revision: number; data: unknown } = { revision: 0, data: null };
  const app: PluginServices = {
    resources: { url: (path) => new URL(path, options.project).href },
    package: {
      package_id: metadata.id,
      version: options.version ?? metadata.version,
      data_path: options.dataPath ?? '/tmp/seed-plugin-test',
    },
    locale: options.locale ?? 'en-US',
    registerCapability: (definition, handler) => {
      if (handlers.has(definition.id)) throw new Error('Duplicate test capability.');
      definitions.set(definition.id, definition);
      handlers.set(definition.id, handler);
      return () => {
        definitions.delete(definition.id);
        handlers.delete(definition.id);
      };
    },
    capabilities: {
      list: options.listCapabilities ?? (async () => []),
      invoke:
        options.invokeCapability ??
        (async () => {
          throw new Error('No test capability provider.');
        }),
    },
    data: {
      load: async () => structuredClone(data),
      save: async (value, expected) => {
        if (expected !== data.revision) throw new Error('plugin_data_conflict');
        return (data = { revision: data.revision + 1, data: structuredClone(value) });
      },
    },
    invokeHost: async (service, args) => {
      if (service === 'seed.plugin-event') return await options.event?.(String(args.name), args.data);
      if (service !== 'seed.plugin-settings') return await options.invokeHost?.(service, args);
      const ids =
        args.operation === 'load'
          ? (args.ids as string[])
          : (args.updates as Array<{ id: string }>).map((update) => update.id);
      if (args.operation === 'save') {
        const updates = args.updates as Array<{ id: string; value: unknown; revision: string }>;
        if (updates.some((update) => update.revision !== revision(settings[update.id])))
          throw new Error('plugin_settings_conflict');
        await options.beforeSettingsSave?.(updates);
        for (const update of updates) settings[update.id] = structuredClone(update.value);
      }
      return Object.fromEntries(
        ids.map((id) => [id, { revision: revision(settings[id]), value: structuredClone(settings[id] ?? null) }]),
      );
    },
    audit: { record: options.audit ?? (async () => undefined) },
    diagnostics: options.diagnostics ?? { report: async () => undefined, error: async () => undefined },
    secrets: options.secrets ?? {
      get: async (key) => secrets.get(key),
      set: async (key, value) => {
        secrets.set(key, value);
      },
      delete: async (key) => {
        secrets.delete(key);
      },
    },
    localApi: { register: options.registerLocalApi ?? (() => () => undefined) },
    connections: {
      register: (descriptor) => {
        if (connections.has(descriptor.id)) throw new Error('Duplicate test connection.');
        const controller = new AbortController();
        let disposed = false;
        const dispose = async () => {
          if (disposed) return;
          disposed = true;
          controller.abort();
          connections.delete(descriptor.id);
          await descriptor.close();
        };
        connections.set(descriptor.id, { reconnect: descriptor.reconnect, dispose });
        disposers.push(dispose);
        return { signal: controller.signal, update: () => undefined, dispose };
      },
    },
    authorization: {
      authorize:
        options.authorize ??
        (async () => {
          throw new Error('No test authorization provider.');
        }),
    },
    tasks: {
      start: (input) => {
        const controller = new AbortController();
        tasks.add(controller);
        const settle = () => {
          tasks.delete(controller);
        };
        return { id: input.id ?? randomUUID(), signal: controller.signal, finish: settle, fail: settle };
      },
      run: async (_input, work) => {
        const controller = new AbortController();
        tasks.add(controller);
        try {
          return await work(controller.signal);
        } finally {
          tasks.delete(controller);
        }
      },
    },
  };
  const resolveText = (value: string | { $t: string }) => (typeof value === 'string' ? value : i18n.t(value.$t));
  const Service =
    entry.prototype instanceof PluginService
      ? (entry as new (app: PluginServices, manifest: PluginManifest) => PluginService)
      : class extends PluginService {
          async onload() {
            await (entry as (app: ServiceApp, owner: PluginService) => void | Promise<void>)(this.app, this);
          }
        };
  const service = new Service(app, {
    ...metadata,
    name: resolveText(metadata.name),
    description: resolveText(metadata.description),
    translations,
  });
  await service.load();
  return {
    definitions,
    service,
    invoke: async (id: string, method: string, request: Parameters<SeedCapabilityHandler['invoke']>[1]) => {
      const handler = handlers.get(id);
      if (!handler) throw new Error('Capability is not running: ' + id);
      return await handler.invoke(method, request);
    },
    dispose: async () => {
      await service.unload();
      for (const controller of tasks) controller.abort();
      tasks.clear();
      for (const dispose of disposers.splice(0).reverse()) await dispose();
    },
    reconnectConnection: async (id: string) => {
      const connection = connections.get(id);
      if (!connection?.reconnect) throw new Error('Connection is not reconnectable.');
      await connection.reconnect();
    },
    activeTaskCount: () => tasks.size,
  };
}
