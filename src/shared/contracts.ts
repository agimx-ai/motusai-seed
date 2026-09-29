import type { SeedConnectionState, SeedNavigationTarget } from '@motus-ai/seed-sdk'
import type { SeedConsumedCapability, SeedPluginLabel } from './plugin-manifest'
import type { SeedLocalizedText } from './plugin-manifest'

export type AuthStatus = 'signed_out' | 'authorizing' | 'signed_in' | 'error'
export type MascotState = 'idle' | 'running' | 'working' | 'waiting' | 'review' | 'failed'

export type SeedDistribution = {
  ver: 3
  dist_id: string
  auth: {
    issuer: string
    client_id: string
    redirect_uri: string
    authorization_endpoint: string
    token_endpoint: string
    userinfo_endpoint: string
    revocation_endpoint: string
  }
  market_url: string | null
  update_url: string | null
  events_url: string
  exp: number
}

export type SeedDistributionEvent =
  | { ver: 1; type: 'plugin.catalog.changed'; dist_id: string; revision: string; occurred_at: string }
  | {
    ver: 1
    type: 'client.release.changed'
    dist_id: string
    revision: string
    occurred_at: string
    channel: 'stable' | 'beta'
    platform: 'win-x64' | 'win-arm64' | 'mac-x64' | 'mac-arm64' | 'mac-universal' | 'linux-x64' | 'linux-arm64'
    version: string
  }

export type FilesystemPermission = 'read' | 'write'
export type SeedLocale = 'zh-CN' | 'en-US'
export type SeedLanguagePreference = 'system' | SeedLocale
export type SeedThemePreference = 'light' | 'dark' | 'system'
export type PluginConfigurationState = {
  persisted: boolean
  values: Record<string, string>
  configuredSecrets: string[]
}
export type UpdatePluginConfigurationInput = {
  pluginId: string
  configurationId: string
  values: Record<string, string>
}
export type PluginConfigurationOptionBadge = {
  prefix?: string
  label: string
  suffix?: string
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  strikethrough?: boolean
}
export type PluginConfigurationOption = {
  value: string
  label: string
  badges?: PluginConfigurationOptionBadge[]
  iconDataUrl?: string
  iconDarkDataUrl?: string
}
export type QueryPluginConfigurationOptionsInput = {
  pluginId: string
  configurationId: string
  fieldKey: string
  values: Record<string, string>
}
export type PluginConfigurationProfileStatus = {
  profileId: string
  state: SeedConnectionState
  reconnectable: boolean
  error?: string
}
export type QueryPluginConfigurationProfileStatusesInput = {
  pluginId: string
  configurationId: string
}
export type ReconnectPluginConfigurationProfileInput = QueryPluginConfigurationProfileStatusesInput & {
  profileId: string
}
export type QueryPluginManagementViewInput = {
  pluginId: string
  viewId: string
  sourceId?: string
  arguments?: Record<string, unknown>
}
export type InvokePluginManagementActionInput = { pluginId: string; viewId: string; actionId: string; arguments: Record<string, unknown> }
export type StoredPluginConfiguration = {
  schema_version: 1
  profiles: Array<Record<string, string>>
  default_profile_id: string
  values: Record<string, string>
}
export function pluginConfigurationKey(pluginId: string, configurationId: string) {
  return `${pluginId}:${configurationId}`
}
export type AppUpdateStatus = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'
export type AppUpdateState = {
  status: AppUpdateStatus
  currentVersion: string
  availableVersion?: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  error?: string
}

export type TerminalLogUploadResult = {
  uploadId: string
  status: 'completed'
}

export type TerminalLogUploadRange = {
  days: 1 | 3 | 7
}

export type TerminalLogUploadProgress = {
  phase: 'preparing' | 'uploading' | 'completing' | 'completed'
  percent: number
  transferred: number
  total: number
}

export type TerminalUserProfile = {
  id: string
  displayName: string
  username?: string
  email?: string
  avatarDataUrl?: string
}

export type UpdateProfileInput = { displayName: string; username: string; avatarDataUrl?: string }

export type AuditOutcome = 'allowed' | 'denied' | 'failed' | 'running' | 'interrupted'
export type AuditCategory = 'all' | 'capabilities' | 'permissions' | 'plugins' | 'system'
export type AuditStatusFilter = 'all' | 'attention'
export type AuditRisk = 'read' | 'write' | 'control'
export type AuditRiskFilter = 'all' | AuditRisk
export type AuditMetadata = Partial<Record<
  | 'plugin_version'
  | 'plugin_id'
  | 'plugin_name_en_us'
  | 'plugin_name_zh_hans'
  | 'action_label_en_us'
  | 'action_label_zh_hans'
  | 'client_id'
  | 'client_name'
  | 'workspace_id'
  | 'conversation_id'
  | 'model_profile_id'
  | 'thinking_level'
  | 'duration_ms'
  | 'input_length'
  | 'output_length'
  | 'attachment_count'
  | 'provider_plugin_id'
  | 'capability_id'
  | 'capability_method',
  string | number | boolean
>>

export type AuditEntry = {
  id: string
  timestamp: string
  source: 'user' | 'agent' | 'plugin' | 'system'
  operation: string
  capability?: string
  method?: string
  risk?: AuditRisk
  taskId?: string
  runId?: string
  requestId?: string
  approvalId?: string
  errorCode?: string
  grantId?: string
  relativePath?: string
  outcome: AuditOutcome
  summary: string
  metadata?: AuditMetadata
  recordKind?: 'activity' | 'span' | 'event'
  traceId?: string
  spanId?: string
  parentSpanId?: string
  visibility?: 'activity' | 'technical'
  endedAt?: string
  durationMs?: number
  level?: 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  component?: string
  pluginId?: string
  pluginVersion?: string
  errorName?: string
  errorStack?: string
  errorMessage?: string
  eventName?: string
  evidenceOrigin?: 'host' | 'plugin'
  diagnosticDetails?: Record<string, string | number | boolean | null>
}

export type UsageDay = {
  date: string
  creditsCharged: number
  paidCallCount: number
}

export type UsagePlugin = {
  pluginId: string
  nameEnUs?: string
  nameZhHans?: string
  callCount: number
  creditsCharged: number
}

export type UsageSummary = {
  retentionDays: number
  days: UsageDay[]
  plugins: UsagePlugin[]
}

export type AuditQueryInput = {
  query?: string
  category?: AuditCategory
  status?: AuditStatusFilter
  risk?: AuditRiskFilter
  cursor?: string
  limit?: number
}

export type AuditPage = {
  items: AuditEntry[]
  total: number
  nextCursor?: string
}

export type SeedSnapshot = {
  appName: string
  appVersion: string
  platform: NodeJS.Platform
  architecture: NodeJS.Architecture
  startup: {
    status: 'initializing' | 'ready'
  }
  auth: {
    status: AuthStatus
    error?: string
  }
  user?: TerminalUserProfile
  plugins: SeedInstalledPlugin[]
  catalogPlugins: SeedCatalogPlugin[]
  catalogNextCursor?: string
  localClients: LocalClientAuthorization[]
  navigationRequest?: SeedNavigationTarget & { id: string }
  audit: AuditEntry[]
  launchAtLogin: boolean
  preventSystemSleep: boolean
  languagePreference: SeedLanguagePreference
  locale: SeedLocale
  themePreference: SeedThemePreference
  pluginConfigurations: Record<string, PluginConfigurationState>
  update: AppUpdateState
  audio: {
    sessionId?: string
    state: 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'failed'
    durationMs: number
    error?: string
  }
  mascot: {
    state: MascotState
    changedAt: string
    activeTaskCount: number
  }
}

export type LocalClientAuthorization = {
  id: string
  pluginIds: string[]
  clientId: string
  installationId: string
  displayName: string
  deviceName?: string
  createdAt: string
  updatedAt: string
}

export type SeedInstalledPlugin = {
  id: string
  visibility: 'public' | 'organization'
  name: SeedLocalizedText
  description: SeedLocalizedText
  labels: SeedPluginLabel[]
  version: string
  publisher: string
  runtimeKind?: 'sandboxed-web' | 'native-host'
  manifestDigest: string
  iconDataUrl?: string
  iconDarkDataUrl?: string
  detailPresentation?: import('./plugin-manifest').SeedPluginDetailPresentation
  capabilities: CapsPluginDescriptor[]
  configurations: import('./plugin-manifest').SeedPluginConfiguration[]
  managementViews: import('./plugin-manifest').SeedPluginManagementView[]
  permissions: string[]
  source: 'installed'
  publisherType: 'official' | 'community'
  status: 'ready' | 'incompatible'
  incompatibilityReason?: string
  enabled: boolean
  installedAt?: string
}

export type SeedCatalogPlugin = {
  id: string
  visibility: 'public' | 'organization'
  organization: { id: string; name: string } | null
  name: SeedLocalizedText
  description: SeedLocalizedText
  readme?: SeedLocalizedText
  labels: SeedPluginLabel[]
  publisher: string
  publisherType: 'official' | 'community'
  latestVersion: string
  packageSha256: string
  packageSize: number
  apiVersion: '1'
  minSeedVersion: string | null
  runtimeKind: 'sandboxed-web' | 'native-host'
  permissions: string[]
  capabilities: CapsPluginDescriptor[]
  compatible: boolean
  publishedAt: string
  iconUrl?: string
  iconDarkUrl?: string
  versions: SeedCatalogPluginVersion[]
}

export type SeedCatalogPluginVersion = {
  version: string
  platform: NodeJS.Platform
  architecture: NodeJS.Architecture
  packageSha256: string
  packageSize: number
  apiVersion: '1'
  minSeedVersion: string | null
  runtimeKind: 'sandboxed-web' | 'native-host'
  permissions: string[]
  capabilities: CapsPluginDescriptor[]
  publishedAt: string
  downloadUrl: string
  releaseNotes?: string
}

export type SeedCatalogPage = {
  items: SeedCatalogPlugin[]
  nextCursor?: string
}

export type PersonalCreditGrant = {
  id: string
  amount: number
  reason: string
  createdAt: string
}

export type PersonalCreditGrantPage = {
  items: PersonalCreditGrant[]
  nextCursor?: string
}

export type SeedEvent =
  | { type: 'snapshot.changed'; snapshot: SeedSnapshot }
  | { type: 'logs.upload.progress'; progress: TerminalLogUploadProgress | null }
  | { type: 'plugin.management.text'; pluginId: string; viewId: string; valuePath: string; streamId: string; operation: 'append' | 'replace'; text: string; offset?: number }

export type SeedApi = {
  snapshot(): Promise<SeedSnapshot>
  personalCreditWallet(): Promise<{ available: number }>
  personalCreditGrants(cursor?: string): Promise<PersonalCreditGrantPage>
  signIn(): Promise<void>
  cancelSignIn(): Promise<void>
  logout(): Promise<void>
  openWebsite(): Promise<void>
  openPersonalWallet(): Promise<void>
  readProfile(): Promise<TerminalUserProfile>
  updateProfile(input: UpdateProfileInput): Promise<TerminalUserProfile>
  setLaunchAtLogin(enabled: boolean): Promise<boolean>
  setPreventSystemSleep(enabled: boolean): Promise<boolean>
  setLanguagePreference(preference: SeedLanguagePreference): Promise<void>
  setThemePreference(preference: SeedThemePreference): Promise<void>
  updatePluginConfiguration(input: UpdatePluginConfigurationInput): Promise<void>
  queryPluginConfigurationOptions(input: QueryPluginConfigurationOptionsInput): Promise<PluginConfigurationOption[]>
  queryPluginConfigurationProfileStatuses(input: QueryPluginConfigurationProfileStatusesInput): Promise<PluginConfigurationProfileStatus[]>
  reconnectPluginConfigurationProfile(input: ReconnectPluginConfigurationProfileInput): Promise<void>
  queryPluginManagementView(input: QueryPluginManagementViewInput): Promise<unknown>
  invokePluginManagementAction(input: InvokePluginManagementActionInput): Promise<unknown>
  checkForUpdates(): Promise<boolean>
  downloadUpdate(): Promise<boolean>
  installUpdate(): Promise<boolean>
  clearAudit(): Promise<void>
  queryAudit(input: AuditQueryInput): Promise<AuditPage>
  queryUsage(): Promise<UsageSummary>
  uploadLogs(input: TerminalLogUploadRange): Promise<TerminalLogUploadResult | false>
  cancelLogUpload(): Promise<boolean>
  refreshPluginCatalog(): Promise<SeedCatalogPlugin[]>
  loadMorePluginCatalog(): Promise<SeedCatalogPlugin[]>
  searchPluginCatalog(query: string, cursor?: string): Promise<SeedCatalogPage>
  installPlugin(pluginId: string, version: string): Promise<boolean>
  uninstallPlugin(pluginId: string): Promise<boolean>
  subscribe(listener: (event: SeedEvent) => void): () => void
}

export type SeedWindowApi = {
  platform: NodeJS.Platform
  getPathForFile(file: File): string
  copyText(text: string): Promise<void>
  reportDiagnostic(input: { event: string; message: string; error_stack?: string; error_name?: string }): void
  minimize(): Promise<void>
  toggleMaximize(): Promise<boolean>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  subscribeMaximized(listener: (maximized: boolean) => void): () => void
}

export const ipcChannels = {
  snapshot: 'seed:snapshot',
  personalCreditWallet: 'seed:credits:personal-wallet',
  personalCreditGrants: 'seed:credits:personal-grants',
  signIn: 'seed:account:sign-in',
  cancelSignIn: 'seed:account:cancel-sign-in',
  logout: 'seed:account:logout',
  openWebsite: 'seed:distribution:open-website',
  openPersonalWallet: 'seed:credits:open-personal-wallet',
  readProfile: 'seed:account:read-profile',
  updateProfile: 'seed:account:update-profile',
  launchAtLogin: 'seed:settings:launch-at-login',
  preventSystemSleep: 'seed:settings:prevent-system-sleep',
  languagePreference: 'seed:settings:language-preference',
  themePreference: 'seed:settings:theme-preference',
  pluginConfiguration: 'seed:plugins:update-configuration',
  pluginConfigurationOptions: 'seed:plugins:query-configuration-options',
  pluginConfigurationProfileStatuses: 'seed:plugins:query-configuration-profile-statuses',
  pluginConfigurationProfileReconnect: 'seed:plugins:reconnect-configuration-profile',
  pluginManagementView: 'seed:plugins:query-management-view',
  pluginManagementAction: 'seed:plugins:invoke-management-action',
  checkForUpdates: 'seed:updates:check',
  downloadUpdate: 'seed:updates:download',
  installUpdate: 'seed:updates:install',
  clearAudit: 'seed:audit:clear',
  queryAudit: 'seed:audit:query',
  queryUsage: 'seed:usage:query',
  uploadLogs: 'seed:logs:upload',
  cancelLogUpload: 'seed:logs:cancel-upload',
  refreshPluginCatalog: 'seed:plugins:refresh-catalog',
  loadMorePluginCatalog: 'seed:plugins:load-more-catalog',
  searchPluginCatalog: 'seed:plugins:search-catalog',
  installPlugin: 'seed:plugins:install',
  uninstallPlugin: 'seed:plugins:uninstall',
  windowMinimize: 'seed:window:minimize',
  windowCopyText: 'seed:window:copy-text',
  windowToggleMaximize: 'seed:window:toggle-maximize',
  windowClose: 'seed:window:close',
  windowIsMaximized: 'seed:window:is-maximized',
  windowMaximizedChanged: 'seed:window:maximized-changed',
  event: 'seed:event',
} as const

export type LocalFileMethod = 'list' | 'stat' | 'search' | 'read' | 'mkdir' | 'write' | 'edit' | 'move' | 'delete'
export type LocalFileWriteMethod = 'mkdir' | 'write' | 'edit' | 'move' | 'delete'

export type CapsMethodRisk = 'read' | 'write' | 'control'

export type CapsMethodDescriptor = {
  name: string
  platforms?: Array<'darwin' | 'linux' | 'win32'>
  risk: CapsMethodRisk
  description?: SeedLocalizedText
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
}

export type CapsPluginDescriptor = {
  provider_plugin_id?: string
  id: string
  version: number
  exposure?: 'terminal' | 'plugin' | 'local'
  description?: SeedLocalizedText
  annotations?: Record<string, unknown>
  errors?: Record<string, SeedLocalizedText>
  methods: CapsMethodDescriptor[]
  roots?: Array<{
    id: string
    label: string
    display_path: string
    permissions: FilesystemPermission[]
  }>
}

export type FilesystemRoot = {
  id: string
  label: string
  displayPath: string
  permissions: FilesystemPermission[]
  createdAt: string
  updatedAt: string
  rootPath: string
}

export type SeedPluginRuntimeDefinition = {
  package_id: string
  version: string
  name?: SeedLocalizedText
  icon_data_url?: string
  icon_dark_data_url?: string
  publisher_type: 'official' | 'community'
  runtime_kind: 'sandboxed-web' | 'native-host'
  root_path: string
  entry_path: string
  sidecars: Array<{ id: string; path: string }>
  permissions: string[]
  configuration_revision?: string
  consumes: SeedConsumedCapability[]
  capabilities: CapsPluginDescriptor[]
}

export type WorkerCommand =
  | {
    type: 'configure'
    appVersion: string
    locale: string
    backupRoot: string
    pluginDataRoot: string
    plugins: SeedPluginRuntimeDefinition[]
  }
  | { type: 'unconfigure' }
  | { type: 'host.result'; requestId: string; ok: boolean; result?: unknown; error?: string; errorCode?: string }
  | { type: 'native.runtime.updated'; packageId: string; snapshot: NativePluginRuntimeSnapshot | null }
  | { type: 'native.capability.list'; requestId: string; packageId: string }
  | { type: 'native.capability.invoke'; requestId: string; packageId: string; invocation: import('@motus-ai/seed-sdk').SeedPluginCapabilityInvocation; chain: string[] }
  | { type: 'plugin.management.query'; requestId: string; pluginId: string; viewId: string; sourceId?: string; arguments?: Record<string, unknown> }
  | { type: 'plugin.configuration.options.query'; requestId: string; pluginId: string; configurationId: string; fieldKey: string; values: Record<string, string> }
  | { type: 'plugin.configuration.profile-statuses.query'; requestId: string; pluginId: string; configurationId: string }
  | { type: 'plugin.configuration.profile.reconnect'; requestId: string; pluginId: string; configurationId: string; profileId: string }
  | { type: 'plugin.management.invoke'; requestId: string; pluginId: string; viewId: string; actionId: string; arguments: Record<string, unknown> }
  | { type: 'local-gateway.event'; event: import('@motus-ai/seed-sdk').SeedLocalGatewayEvent }
  | { type: 'shutdown' }

export type WorkerEvent =
  | { type: 'diagnostic'; level: 'info' | 'warn' | 'error' | 'fatal'; event: string; message: string; error_name?: string; error_stack?: string; plugin_id?: string; plugin_version?: string; request_id?: string; operation?: string; trace_id?: string; span_id?: string; parent_span_id?: string; phase?: 'started' | 'completed' | 'failed'; duration_ms?: number; error_code?: string; details?: Record<string, string | number | boolean | null> }
  | { type: 'plugin.runtime.failed'; packageId: string; message: string }
  | { type: 'plugin.contributions.changed'; packageId: string; configurations: import('./plugin-manifest').SeedPluginConfiguration[]; managementViews: import('./plugin-manifest').SeedPluginManagementView[] }
  | { type: 'host.invoke'; requestId: string; service: string; arguments: Record<string, unknown>; trace?: import('./diagnostic-trace').DiagnosticTraceContext }
  | { type: 'native.capability.result'; requestId: string; ok: boolean; result?: unknown; error?: string; errorCode?: string }
  | { type: 'plugin.management.result'; requestId: string; ok: boolean; result?: unknown; error?: string }
  | { type: 'plugin.configuration.options.result'; requestId: string; ok: boolean; options?: PluginConfigurationOption[]; error?: string }
  | { type: 'plugin.configuration.profile-statuses.result'; requestId: string; ok: boolean; statuses?: PluginConfigurationProfileStatus[]; error?: string }
  | { type: 'plugin.configuration.profile.reconnect.result'; requestId: string; ok: boolean; error?: string }
  | { type: 'task.changed'; requestId: string; taskId: string; phase: 'started' | 'completed' | 'failed'; operation: string }
  | { type: 'audit'; entry: Omit<AuditEntry, 'id' | 'timestamp'> }

export type NativePluginRuntimeSnapshot = {
  capabilities: string[]
  configurations: import('./plugin-manifest').SeedPluginConfiguration[]
  managementViews: import('./plugin-manifest').SeedPluginManagementView[]
  localApi?: Omit<import('@motus-ai/seed-sdk').SeedLocalApiRegistration, 'handle'>
  connections: import('@motus-ai/seed-sdk').SeedConnectionSnapshot[]
}
