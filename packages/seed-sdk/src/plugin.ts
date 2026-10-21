import { Component } from './component.js';
import { Events } from './events.js';
import { PluginDataAccess, type PluginDataStore } from './data.js';
export type { PluginDataStore, PluginDataSnapshot } from './data.js';
import type {
  SeedAuthorizationService,
  SeedCapabilityHandler,
  SeedPluginCapabilityService,
  SeedConnectionService,
  SeedDiagnosticService,
  SeedLocalApiService,
  SeedPluginAuditService,
  SeedPluginPackage,
  SeedSecretService,
  SeedTaskService,
} from './index.js';
import type { CapabilityDefinition, CapabilityRegistration } from './capability.js';
import type { PluginSettingTab, View, ViewHost } from './dom.js';
import { createPluginI18n, type PluginTranslations } from './i18n.js';
import type { i18n } from 'i18next';
import { SeedPluginError } from './error.js';
import { PluginSettingsStore } from './settings.js';
import { createPluginEventClient, type PluginEventService } from './plugin-events.js';
import type { PluginResources, PluginFilePicker } from './resources.js';
import { createSystemNotificationClient, type SystemNotificationService } from './notifications.js';

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  description: string;
  author: string;
  translations?: PluginTranslations;
};

export type Command = {
  id: string;
  name: string;
  callback?: () => void | Promise<void>;
  checkCallback?: (checking: boolean) => boolean | void;
};

export type App = {
  /** Stable across package updates; changes after uninstall and reinstall. Undefined for local development sources. */
  installationId?: string;
  /** View registrations belong to this plugin's DOM container, not a global desktop workspace. */
  reloadService?: () => Promise<void>;
  resources?: PluginResources;
  files?: PluginFilePicker;
  /** Write-only clipboard access through the platform bridge; no clipboard reads. */
  clipboard?: { writeText(text: string): Promise<void> };
  events: Events;
  locale: string;
  theme: 'light' | 'dark';
  i18n: i18n;
  data: PluginDataStore;
  service: { call<T = unknown>(method: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<T> };
  addSettingTab(tab: PluginSettingTab): () => void;
  registerView(type: string, creator: (host: ViewHost) => View): () => void;
  addCommand(command: Command): () => void;
  addToolbarItem(icon: string, title: string, callback: () => void): { element: HTMLElement; dispose(): void };
  addStatusBarItem(): { element: HTMLElement; dispose(): void };
};

/** Privileged host services only. view contributions and host internals are not part of this API. */
export type PluginServices = {
  resources?: PluginResources;
  package: SeedPluginPackage;
  audit: SeedPluginAuditService;
  diagnostics: SeedDiagnosticService;
  capabilities: SeedPluginCapabilityService;
  localApi: SeedLocalApiService;
  /** Both service runtimes support capabilities and tasks. Raw outbound connections and local HTTP handlers require native-host. */
  tasks: SeedTaskService;
  connections: SeedConnectionService;
  secrets: SeedSecretService;
  authorization: SeedAuthorizationService;
  invokeHost(service: string, argumentsValue: Record<string, unknown>): Promise<unknown>;
  data: PluginDataStore;
  locale?: string;
  registerCapability?: CapabilityRegistration;
};

export type ServiceApp = PluginServices & {
  settings: PluginSettingsStore;
  events: PluginEventService;
  notifications: SystemNotificationService;
};

export class Plugin extends Component {
  settings?: unknown;
  private readonly commands = new Map<string, () => void>();
  private readonly dataAccess: PluginDataAccess;
  constructor(
    readonly app: App,
    readonly manifest: PluginManifest,
  ) {
    super();
    this.dataAccess = new PluginDataAccess(app.data);
  }

  async loadData<T = unknown>(): Promise<T | null> {
    return await this.dataAccess.load<T>();
  }

  async saveData(data: unknown): Promise<void> {
    await this.dataAccess.save(data);
  }

  addSettingTab(tab: PluginSettingTab): void {
    this.addChild(tab);
    this.register(this.app.addSettingTab(tab));
  }
  registerView(type: string, creator: (host: ViewHost) => View): void {
    this.register(this.app.registerView(type, creator));
  }
  addCommand(command: Command): Command {
    if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(command.id) || this.commands.has(command.id))
      throw new Error('Invalid or duplicate command: ' + command.id);
    const namespaced = { ...command, id: this.manifest.id + ':' + command.id };
    const stop = this.app.addCommand(namespaced);
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      this.commands.delete(command.id);
      return stop();
    };
    this.commands.set(command.id, dispose);
    this.register(dispose);
    return namespaced;
  }
  removeCommand(id: string): void {
    this.commands.get(id)?.();
  }
  addRibbonIcon(icon: string, title: string, callback: () => void): HTMLElement {
    const item = this.app.addToolbarItem(icon, title, callback);
    this.register(() => item.dispose());
    return item.element;
  }
  addStatusBarItem(): HTMLElement {
    const item = this.app.addStatusBarItem();
    this.register(() => item.dispose());
    return item.element;
  }
}

/** The privileged service has its own instance, lifecycle and dependency graph. Never construct it in a view sandbox. */
export class PluginService extends Component {
  readonly i18n: i18n;
  readonly app: ServiceApp;
  private readonly handlers = new Map<
    string,
    (args: Record<string, unknown>, signal: AbortSignal) => unknown | Promise<unknown>
  >();
  private readonly capabilities = new Map<
    string,
    { definition: CapabilityDefinition; handler: SeedCapabilityHandler }
  >();
  private readonly dataAccess: PluginDataAccess;
  constructor(
    app: PluginServices,
    readonly manifest: PluginManifest,
  ) {
    super();
    this.app = {
      ...app,
      capabilities: {
        list: () => app.capabilities.list(),
        invoke: (input) => app.capabilities.invoke(input),
        ...(app.capabilities?.stream
          ? { stream: (input: import('./index.js').SeedPluginCapabilityInvocation) => app.capabilities.stream!(input) }
          : {}),
      },
      settings: new PluginSettingsStore((service, args) => app.invokeHost(service, args), this.signal),
      notifications: createSystemNotificationClient(
        (service, args) => app.invokeHost(service, args),
        this.signal,
        (error) => {
          void app.diagnostics.error('plugin.notification.failed', error).catch(() => undefined);
        },
      ),
      events: createPluginEventClient(
        (service, args) => app.invokeHost(service, args),
        this.signal,
        (error) => {
          void app.diagnostics.error('plugin.event.subscription.failed', error).catch(() => undefined);
        },
      ),
    };
    this.dataAccess = new PluginDataAccess(app.data);
    this.i18n = createPluginI18n(manifest.translations, app.locale ?? manifest.translations?.defaultLocale);
  }
  async loadData<T = unknown>(): Promise<T | null> {
    return await this.dataAccess.load<T>();
  }
  async saveData(data: unknown): Promise<void> {
    await this.dataAccess.save(data);
  }
  resourceUrl(path: string): string {
    if (!this.app.resources) throw new Error('Plugin resource host is unavailable.');
    return this.app.resources.url(path);
  }
  async publish(name: string, data: unknown): Promise<void> {
    if (this.signal.aborted) throw new Error('Plugin service is not running.');
    await this.app.invokeHost('seed.plugin-event', { name, data });
  }

  /** Register the public contract and implementation together during onload. */
  addCapability(definition: CapabilityDefinition, handler?: SeedCapabilityHandler): void {
    if (this.signal.aborted) throw new Error('Cannot register a capability on a stopped plugin.');
    if (!this.app.registerCapability) throw new Error('The host does not support code-registered capabilities.');
    if (this.capabilities.has(definition.id)) throw new Error('Duplicate capability: ' + definition.id);
    if (definition.methods.length && !handler) throw new Error('Capability implementation is missing.');
    const wrapped: SeedCapabilityHandler = {
      invoke: async (method, invocation) => {
        try {
          const signal = invocation.signal ? AbortSignal.any([this.signal, invocation.signal]) : this.signal;
          if (this.signal.aborted) throw this.signal.reason;
          if (!handler) throw new Error('This capability only publishes events.');
          return await handler.invoke(method, { ...invocation, signal });
        } catch (error) {
          if (!(error instanceof SeedPluginError) || !/^[a-z][a-z0-9_.-]{0,127}$/.test(error.code)) throw error;
          const key = `capabilities.${definition.id}.errors.${error.code}`;
          if (!this.i18n.exists(key)) throw error;
          const translated = new SeedPluginError(error.code, this.i18n.t(key, error.params), error.params);
          translated.cause = error;
          throw translated;
        }
      },
    };
    const stop = this.app.registerCapability(definition, wrapped);
    this.capabilities.set(definition.id, { definition, handler: wrapped });
    this.register(() => {
      this.capabilities.delete(definition.id);
      return stop();
    });
  }

  registerLocalApi(registration: import('./index.js').SeedLocalApiRegistration): void {
    this.register(this.app.localApi.register(registration));
  }

  registerConnection(descriptor: import('./index.js').SeedConnectionDescriptor) {
    const connection = this.app.connections.register(descriptor);
    this.register(() => connection.dispose());
    return connection;
  }

  registerMethod(
    name: string,
    handler: (args: Record<string, unknown>, signal: AbortSignal) => unknown | Promise<unknown>,
  ): void {
    if (name === 'capability.invoke' || !/^[a-z][a-zA-Z0-9._-]{0,127}$/.test(name) || this.handlers.has(name))
      throw new Error('Invalid or duplicate service method: ' + name);
    this.handlers.set(name, handler);
    this.register(() => {
      this.handlers.delete(name);
    });
  }

  async call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (!this.loaded || this.signal.aborted) throw new Error('Plugin service is not running.');
    const combined = signal ? AbortSignal.any([this.signal, signal]) : this.signal;
    if (combined.aborted) throw combined.reason;
    if (name === 'capability.invoke') {
      const capability = this.capabilities.get(String(args.capability));
      const method = typeof args.method === 'string' ? args.method : '';
      if (!capability?.definition.methods.some((entry) => entry.name === method))
        throw new Error('Unknown owned capability method.');
      const input = args.arguments;
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error('Capability arguments must be an object.');
      return await capability.handler.invoke(method, {
        request_id: crypto.randomUUID(),
        arguments: input as Record<string, unknown>,
        signal: combined,
        principal: { kind: 'seed', surface: 'management' },
      });
    }
    const handler = this.handlers.get(name);
    if (!handler) throw new Error('Unknown plugin service method: ' + name);
    return await handler(args, combined);
  }
}
