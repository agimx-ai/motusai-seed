export { Component, type Disposer } from './component.js';
export { Events, type EventRef } from './events.js';
export {
  createPluginI18n,
  canonicalPluginLocale,
  pluginTranslationLocale,
  validatePluginTranslations,
  isTranslationReference,
  mapTranslationReferences,
  resolvePluginTranslationReferences,
  resolvePluginLocalizedMetadata,
  type TranslationReference,
  type TranslationMessages,
  type PluginTranslations,
} from './i18n.js';
export { PluginRpcPeer, type RpcMessage } from './rpc.js';
export type { CapabilityDefinition, CapabilityMethod, CapabilityRegistration } from './capability.js';
export { SeedPluginError, type SeedPluginErrorParameter } from './error.js';
export {
  Plugin,
  PluginService,
  type PluginServices,
  type ServiceApp,
  type App,
  type Command,
  type PluginManifest,
  type PluginDataStore,
  type PluginDataSnapshot,
} from './plugin.js';
export {
  BaseComponent,
  ValueComponent,
  TextComponent,
  TextAreaComponent,
  ToggleComponent,
  DropdownComponent,
  SliderComponent,
  ButtonComponent,
  Setting,
  PluginSettingTab,
  View,
  ItemView,
  Modal,
  Notice,
  Menu,
  MenuItem,
  type ViewHost,
} from './dom.js';
export { createSeedDeepLink, seedDeepLinkScheme, type SeedNavigationTarget } from './deep-link.js';
export {
  SeedLocalEventStream,
  type SeedLocalEventResponseOptions,
  type SeedLocalEventWaitOptions,
  type SeedLocalEventPublishOptions,
  type SeedLocalEventStreamOptions,
} from './local-event-stream.js';
export type {
  SeedLocalGatewayEvent,
  SeedLocalGatewaySnapshot,
  SeedLocalPluginRuntimeState,
} from './local-gateway-events.js';

export type SeedCapabilityRisk = 'read' | 'write' | 'control';

export type SeedInvocationPrincipal =
  | { kind: 'local_client'; auth_id: string; client_id: string }
  | { kind: 'plugin'; plugin_id: string }
  | { kind: 'seed'; surface: 'management' | 'system' };

/** Plugin-owned bilingual presentation text. Keep both languages across adapter boundaries. */
export type SeedLocalizedText = { en_US: string; zh_Hans: string };

export type SeedCapabilityMethod = {
  name: string;
  display_name?: SeedLocalizedText;
  risk: SeedCapabilityRisk;
  description?: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

export type SeedInvocation = {
  request_id: string;
  /** Cloud-priced invocation identity and quoted credits. No credits are held; Cloud bills only after a successful relay. */
  billing?: { call_id: string; amount: number; price_revision: number };
  /** Exact provider selected by the caller when more than one plugin implements the capability. */
  provider_plugin_id?: string;
  /** Owning capability id. The native host supplies this for package modules that expose more than one capability. */
  capability?: string;
  session_id?: string;
  arguments: Record<string, unknown>;
  approval?: unknown;
  context?: unknown;
  input?: unknown;
  /** Trusted caller identity supplied by Seed. Plugins cannot override this value. */
  principal?: SeedInvocationPrincipal;
  /** Aborts when the caller cancels or the owning plugin Component is disposed. */
  signal?: AbortSignal;
};

export type SeedPluginAuditRecord = {
  operation: string;
  outcome: 'allowed' | 'denied' | 'failed';
  /** Technical lifecycle events remain available to diagnostics without appearing in the user activity feed. */
  visibility?: 'activity' | 'technical';
  summary?: { en_US: string; zh_Hans: string };
  risk?: SeedCapabilityRisk;
  run_id?: string;
  request_id?: string;
  error_code?: string;
  metadata?: {
    client_id?: string;
    client_name?: string;
    workspace_id?: string;
    conversation_id?: string;
    model_profile_id?: string;
    thinking_level?: string;
    duration_ms?: number;
    input_length?: number;
    output_length?: number;
    attachment_count?: number;
    provider_plugin_id?: string;
    capability_id?: string;
    capability_method?: string;
  };
};

export type SeedPluginAuditService = {
  record(entry: SeedPluginAuditRecord): Promise<void>;
};

export type SeedAvailableCapabilityMethod = SeedCapabilityMethod & {
  provider_plugin_id: string;
};

export type SeedAvailableCapabilityProvider = {
  plugin_id: string;
  name: string;
  icon_data_url?: string;
  icon_dark_data_url?: string;
};

export type SeedAvailableCapability = {
  id: string;
  version: number;
  description?: string;
  provider_plugin_id: string;
  provider_plugin?: SeedAvailableCapabilityProvider;
  methods: SeedAvailableCapabilityMethod[];
};

export type SeedLocalClientCapabilityApproval = {
  kind: 'local_client_human_once';
  id: string;
  auth_id: string;
  provider_plugin_id: string;
  capability: string;
  capability_version: number;
  method: string;
  arguments_sha256: string;
  approved_at: string;
};

function canonicalJsonValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : canonicalJsonValue(item)));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) result[key] = canonicalJsonValue(item);
    }
    return result;
  }
  return null;
}

/** Canonical payload used when binding one-time approval to exact capability arguments. */
export function canonicalSeedCapabilityApprovalPayload(input: {
  provider_plugin_id: string;
  capability: string;
  capability_version: number;
  method: string;
  arguments: Record<string, unknown>;
}) {
  return JSON.stringify(canonicalJsonValue(input));
}

export type SeedPluginCapabilityInvocation = {
  /** Return a host-owned result envelope with confirmed charges, including nested calls. */
  include_billing?: boolean;
  /**
   * Background read calls remain available to diagnostics without appearing in the user activity feed
   * or contributing to Seed's global busy state. Write and control calls always remain foreground activity.
   */
  activity?: 'foreground' | 'background';
  /** Required when multiple installed providers expose the requested capability method. */
  provider_plugin_id?: string;
  capability: string;
  method: string;
  arguments: Record<string, unknown>;
  request_id?: string;
  approval?: SeedLocalClientCapabilityApproval;
  context?: unknown;
  signal?: AbortSignal;
};

/** Missing/incomplete settlement is not a confirmed zero. Amounts are credits, not USD. */
export type SeedBillingReceipt = {
  version: 1;
  complete: boolean;
  charges: Array<{ call_id: string; charged_amount: number }>;
};

export type SeedBilledCapabilityResult = {
  result: unknown;
  billing: SeedBillingReceipt;
};

export type SeedPluginCapabilityService = {
  list(): Promise<SeedAvailableCapability[]>;
  invoke(invocation: SeedPluginCapabilityInvocation): Promise<unknown>;
  /**
   * Iterate a declared read method annotated `seed.stream: true`.
   * The provider returns `{ events, next }` for `after` and `wait_ms` arguments;
   * Seed transports those events unchanged and the consumer decides how to use them.
   */
  stream?(invocation: SeedPluginCapabilityInvocation): AsyncIterable<unknown>;
};

export type SeedLocalApiRoute = {
  method: string;
  path: string;
  public?: boolean;
  /** Controls whether this request is shown as user activity and contributes to Seed's global busy state. */
  activity?: 'foreground' | 'background' | 'stream';
};

export type SeedLocalApiClient = {
  auth_id: string;
};

export type SeedLocalApiHandler = (request: Request, client: SeedLocalApiClient | null) => Response | Promise<Response>;

export type SeedLocalApiRegistration = {
  allowed_origins: readonly string[];
  allowed_client_ids: readonly string[];
  routes: readonly SeedLocalApiRoute[];
  handle: SeedLocalApiHandler;
};

export type SeedLocalApiService = {
  /** Registers routes below /v1/plugins/{package_id}. The Seed host owns the listener, CORS and authorization. */
  register(registration: SeedLocalApiRegistration): () => void;
};

export type SeedPluginPackage = {
  package_id: string;
  version: string;
  data_path: string;
};

export type SeedCapabilityHandler = {
  invoke(method: string, invocation: SeedInvocation): Promise<unknown>;
};

export type SeedBackgroundTask = {
  id: string;
  signal: AbortSignal;
  finish(): void;
  fail(error?: unknown): void;
};

export type SeedTaskService = {
  /** Keeps framework activity alive after a capability handler has returned. */
  start(input: { id?: string; label?: string; request_id?: string; run_id?: string }): SeedBackgroundTask;
  /** Runs and observes a cancellable task owned by the plugin Component. */
  run<T>(
    input: { id?: string; label?: string; request_id?: string; run_id?: string },
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
};

/** Generic outbound network scopes understood by Seed without knowing plugin business. */
export const seedNetworkPermissions = [
  'network.connect.internet',
  'network.connect.lan',
  'network.connect.loopback',
] as const;
export type SeedNetworkPermission = (typeof seedNetworkPermissions)[number];

export type SeedConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnecting'
  | 'disconnected'
  | 'failed';

export type SeedConnectionDescriptor = {
  /** Unique within the owning plugin Component. */
  id: string;
  /** Opaque transport name for diagnostics, such as websocket, http, tcp or mqtt. */
  transport: string;
  /** Exact network.connect.* permission used by this connection. */
  permission: SeedNetworkPermission;
  label?: { en_US: string; zh_Hans: string };
  /** Associates this connection with one plugin-owned settings profile for diagnostics. */
  profile?: { configuration_id: string; profile_id: string };
  /** Requests an immediate reconnect. The plugin remains responsible for transport-specific behavior. */
  reconnect?(): void | Promise<void>;
  /** Called exactly once when the registration is disposed or the plugin Component stops. */
  close(): void | Promise<void>;
};

export type SeedConnectionStatus = {
  state: SeedConnectionState;
  /** Safe diagnostic text only. Do not include credentials or message content. */
  error?: string;
};

export type SeedConnectionSnapshot = SeedConnectionStatus & {
  plugin_id: string;
  id: string;
  transport: string;
  permission: SeedNetworkPermission;
  label?: { en_US: string; zh_Hans: string };
  profile?: { configuration_id: string; profile_id: string };
  reconnectable?: boolean;
  changed_at: string;
};

export type SeedConnectionHandle = {
  /** Aborts before close() runs when the plugin is unloaded, reloaded or Seed exits. */
  signal: AbortSignal;
  update(status: SeedConnectionStatus): void;
  dispose(): Promise<void>;
};

export type SeedConnectionService = {
  /**
   * Registers lifecycle and diagnostics for a plugin-owned connection.
   * Seed does not create the socket, interpret its protocol, or implement reconnect/heartbeat.
   */
  register(descriptor: SeedConnectionDescriptor): SeedConnectionHandle;
};

export type SeedSecretService = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

/** Browser-based OAuth 2.0 Authorization Code + PKCE. OIDC uses the same flow;
 * the owning plugin validates ID tokens and exchanges the code with its provider. */
export type SeedBrowserAuthorizationRequest = {
  standard: 'oauth2.authorization_code.pkce' | 'openid_connect.authorization_code.pkce';
  authorization_endpoint: string;
  client_id: string;
  scope: string;
  parameters?: Record<string, string>;
};

export type SeedBrowserAuthorizationResult = {
  code: string;
  code_verifier: string;
  redirect_uri: string;
};

export type SeedAuthorizationService = {
  authorize(request: SeedBrowserAuthorizationRequest, signal?: AbortSignal): Promise<SeedBrowserAuthorizationResult>;
};

/** Plugin-supplied context is stored alongside host-owned spans in Seed's unified observation table. */
export type SeedDiagnosticService = {
  report(input: {
    level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    event: string;
    message: string;
    error_name?: string;
    error_stack?: string;
    error_code?: string;
    request_id?: string;
    operation?: string;
    details?: Record<string, string | number | boolean | null>;
  }): Promise<void>;
  error(
    event: string,
    error: unknown,
    context?: {
      request_id?: string;
      operation?: string;
      error_code?: string;
      details?: Record<string, string | number | boolean | null>;
    },
  ): Promise<void>;
};

export { PluginSettingsStore, type PluginSettingsSnapshot } from './settings.js';
export { capabilityService, createCapabilityClient } from './capability-client.js';
export { createPluginResources, type PluginResources, type PluginFilePicker } from './resources.js';
export { capabilityPackageMetadata } from './capability.js';
