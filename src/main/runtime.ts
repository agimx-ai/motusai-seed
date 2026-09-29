import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { app, BrowserWindow, powerSaveBlocker, shell } from 'electron'
import { z } from 'zod'
import { buildConfig } from '../shared/build-config.generated'
import { isCreditAmount } from '../shared/credit-amount'
import type { AppUpdateState, AuditQueryInput, LocalClientAuthorization, MascotState, SeedCatalogPage, SeedCatalogPlugin, SeedDistribution, SeedDistributionEvent, SeedEvent, SeedInstalledPlugin, SeedLanguagePreference, SeedPluginRuntimeDefinition, SeedSnapshot, SeedThemePreference, TerminalLogUploadProgress, TerminalLogUploadRange, TerminalUserProfile, UpdatePluginConfigurationInput, UpdateProfileInput, WorkerEvent } from '../shared/contracts'
import { resolveSeedLocale } from './i18n/locale'
import { pluginConfigurationKey } from '../shared/contracts'
import { pluginAuditRecordSchema, seedCatalogResponseSchema, serverUrlSchema } from '../shared/validation'
import { resolveSeedLocalizedText } from '../shared/plugin-manifest'
import { invalidManagementInput } from '../shared/plugin-management-form'
import { ConnectorManager } from './connector-manager'
import {
  createCloudAuthorization,
  cloudSessionWasRejected,
  exchangeCloudAuthorizationCode,
  openCloudAuthorization,
  parseCloudAuthorizationCallback,
  readCloudUser,
  refreshCloudCredential,
  revokeCloudCredential,
  stateMatches,
  updateCloudUser,
} from './cloud-auth'
import { FileBroker } from './brokers/files'
import { AudioService } from './audio-service'
import { brokerPluginConfigurationDeclaration, initialPluginConfiguration, normalizePluginConfiguration, pluginConfigurationState, reconcilePluginConfigurationDefaultGroup } from './plugin-configuration'
import { SeedPluginSandboxSupervisor } from './plugin-sandbox-host'
import { NativePluginManager } from './native-plugin-manager'
import { SeedStore } from './store'
import { SeedPluginInstaller } from './seed-plugin-installer'
import { mascotTiming, remainingMascotRunningMs } from './mascot-timing'
import { SeedUpdater } from './updater'
import { CloudDiagnosticUploader } from './cloud-diagnostic-uploader'
import { CreditBillingClient, relayBillingModelId } from './credit-billing'
import { ObservationStore, errorDetails } from './observation-store'
import { validateLocalClientCapabilityApproval } from './local-client-capability-approval'
import { SidecarProcessService } from './sidecar-process-service'
import { PythonEnvironmentService } from './python-environment-service'
import { discoverDistribution } from './distribution-discovery'
import { SeedDistributionEvents } from './distribution-events'
import { authorizationEndpointPermission, PluginBrowserAuthorization } from './plugin-browser-authorization'
import { entitlementRefreshChangesRuntime } from './entitlement-refresh'

const entitlementResponseSchema = z.object({
  items: z.array(z.object({
    plugin_id: z.string(),
    visibility: z.enum(['public', 'organization']),
    authorized: z.boolean(),
  }).strict()),
}).strict()

const officialWebsiteUrl = 'https://motusseed.com'

export class SeedRuntime {
  readonly store: SeedStore
  readonly connector: ConnectorManager
  private readonly seedCloudUrl = serverUrlSchema.parse(buildConfig.seedCloudUrl)
  private distribution: SeedDistribution | undefined
  private user: TerminalUserProfile | undefined
  private startupStatus: SeedSnapshot['startup']['status'] = 'initializing'
  private authStatus: SeedSnapshot['auth'] = { status: 'signed_out' }
  private pendingCloudAuthorization: {
    state: string
    verifier: string
    resolve: (code: string) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
  } | null = null
  private mascotState: MascotState = 'idle'
  private mascotChangedAt = new Date().toISOString()
  private readonly activeTasks = new Set<string>()
  private readonly activeTaskIds = new Map<string, string>()
  private readonly taskStartedAt = new Map<string, number>()
  private taskBatchHadFailure = false
  private mascotResetTimer: ReturnType<typeof setTimeout> | null = null
  private mascotWorkTimer: ReturnType<typeof setTimeout> | null = null
  private powerSaveBlockerId: number | null = null
  private remotePluginCatalog: SeedCatalogPlugin[] = []
  private remotePluginCatalogNextCursor: string | null = null
  private readonly verifiedCatalogPlugins = new Map<string, SeedCatalogPlugin>()
  private remotePluginCatalogRevision = ''
  private pluginCatalogRefreshQueue = Promise.resolve()
  private installedPlugins: SeedInstalledPlugin[] = []
  private runtimePlugins: SeedPluginRuntimeDefinition[] = []
  private readonly authorizedInstalledPluginIds = new Set<string>()
  private entitlementExpiresAt = 0
  private entitlementTimer: ReturnType<typeof setInterval> | null = null
  private cloudRefreshPromise: Promise<string> | null = null
  private readonly pluginContributions = new Map<string, Pick<SeedInstalledPlugin, 'configurations' | 'managementViews'>>()
  private localClients: LocalClientAuthorization[] = []
  private navigationRequest: SeedSnapshot['navigationRequest']
  private readonly consumedLocalClientApprovalIds = new Map<string, number>()
  private readonly pluginInstaller: SeedPluginInstaller
  private readonly fileBroker: FileBroker
  private readonly audioService: AudioService
  private readonly sidecarProcessService: SidecarProcessService
  private readonly pythonEnvironmentService: PythonEnvironmentService
  private readonly sandboxHost: SeedPluginSandboxSupervisor
  private readonly nativeHost: NativePluginManager
  private readonly updater: SeedUpdater
  private readonly distributionEvents: SeedDistributionEvents
  private readonly logUploader = new CloudDiagnosticUploader()
  private readonly creditBilling = new CreditBillingClient(this.seedCloudUrl,
    (rejectedToken) => this.cloudAccessToken(rejectedToken))
  private readonly billedRelayStreams = new Map<string, { callId: string; pluginId: string }>()
  private readonly pluginBrowserAuthorization = new PluginBrowserAuthorization(buildConfig.appId, async (url) => {
    await shell.openExternal(url)
  })
  private logUploadAbortController: AbortController | null = null
  private logUploadPhase: TerminalLogUploadProgress['phase'] | null = null
  private readonly hostServices: Map<string, (argumentsValue: Record<string, unknown>) => Promise<unknown>> = new Map([
    ['seed.billing.prepare', async (argumentsValue) => {
      const input = z.object({
        invocation_id: z.string().uuid(), plugin_id: z.string().min(1), plugin_version: z.string().min(1),
        capability_id: z.string().min(1), method: z.string().min(1),
        model_id: z.string().min(1).max(200).optional(),
        arguments_sha256: z.string().regex(/^[0-9a-f]{64}$/),
        source_plugin_ids: z.array(z.string().min(1)).max(16).optional(),
      }).parse(argumentsValue)
      if (!this.runtimePlugins.some((plugin) => plugin.package_id === input.plugin_id && plugin.version === input.plugin_version)) {
        throw new Error('计费请求的插件未在当前客户端运行。')
      }
      if (input.source_plugin_ids?.some((id) => !this.runtimePlugins.some((plugin) => plugin.package_id === id))) {
        throw new Error('计费请求的调用来源插件未在当前客户端运行。')
      }
      return this.creditBilling.prepare(input)
    }],
    ['seed.billing.status', async (argumentsValue) => {
      const callId = z.string().uuid().parse(argumentsValue.call_id)
      return this.creditBilling.status(callId)
    }],
    ['seed.billing.cancel', async (argumentsValue) => {
      const callId = z.string().uuid().parse(argumentsValue.call_id)
      return this.creditBilling.cancel(callId)
    }],
    ['seed.cloud.relay', async (argumentsValue) => await this.invokePluginBroker(
      String(argumentsValue.package_id || ''), 'seed.cloud.relay', argumentsValue,
    )],
    ...(['seed.cloud.relay.stream.start', 'seed.cloud.relay.stream.next', 'seed.cloud.relay.stream.close'] as const)
      .map((service) => [service, async (argumentsValue: Record<string, unknown>) => await this.invokePluginBroker(
        String(argumentsValue.package_id || ''), service, argumentsValue,
      )] as const),
    ['seed.cloud.models', async (argumentsValue) => await this.invokePluginBroker(
      String(argumentsValue.package_id || ''), 'seed.cloud.models', argumentsValue,
    )],
    ['seed.plugin.diagnostic', async (argumentsValue) => {
      const packageId = String(argumentsValue.package_id || '')
      const pluginVersion = String(argumentsValue.plugin_version || '')
      if (!this.runtimePlugins.some((candidate) => candidate.package_id === packageId && candidate.version === pluginVersion)) {
        throw new Error('插件诊断事件来源无效。')
      }
      const entry = argumentsValue.entry && typeof argumentsValue.entry === 'object' ? argumentsValue.entry as Record<string, unknown> : {}
      const level = String(entry.level || '')
      if (!['debug', 'info', 'warn', 'error', 'fatal'].includes(level)) throw new Error('插件诊断等级无效。')
      const event = String(entry.event || '')
      if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(event)) throw new Error('插件诊断事件名无效。')
      const details = entry.details && typeof entry.details === 'object' && !Array.isArray(entry.details)
        ? Object.fromEntries(Object.entries(entry.details).filter(([key, value]) =>
          key.length <= 128 && (value === null || ['string', 'number', 'boolean'].includes(typeof value))).slice(0, 32))
        : undefined
      this.diagnostics.record({
        level: level as import('./observation-store').DiagnosticLevel, source: 'plugin-host', event,
        evidence_origin: 'plugin',
        message: String(entry.message || ''), plugin_id: packageId, plugin_version: pluginVersion,
        ...(argumentsValue.trace && typeof argumentsValue.trace === 'object'
          ? { trace_id: String((argumentsValue.trace as Record<string, unknown>).trace_id || ''),
            parent_span_id: String((argumentsValue.trace as Record<string, unknown>).span_id || '') } : {}),
        ...(typeof entry.error_name === 'string' ? { error_name: entry.error_name } : {}),
        ...(typeof entry.error_stack === 'string' ? { error_stack: entry.error_stack } : {}),
        ...(typeof entry.error_code === 'string' ? { error_code: entry.error_code } : {}),
        ...(typeof entry.request_id === 'string' ? { request_id: entry.request_id } : {}),
        ...(typeof entry.operation === 'string' ? { operation: entry.operation } : {}),
        ...(details ? { details } : {}),
      })
    }],
    ['seed.plugin.invoke', async (argumentsValue) => {
      const invocation = argumentsValue.invocation && typeof argumentsValue.invocation === 'object'
        ? argumentsValue.invocation as import('@motusai/seed-sdk').SeedInvocation
        : null
      if (!invocation) throw new Error('插件调用缺少 invocation。')
      return await this.sandboxHost.invoke(
        String(argumentsValue.package_id || ''),
        String(argumentsValue.capability || ''),
        String(argumentsValue.method || ''),
        invocation,
      )
    }],
    ['seed.broker.files.invoke', async (argumentsValue) => await this.invokePluginBroker(
      String(argumentsValue.package_id || ''),
      'seed.broker.files.invoke',
      argumentsValue,
    )],
    ['seed.shell.open-path', async (argumentsValue) => await this.invokePluginBroker(String(argumentsValue.package_id || ''), 'seed.shell.open-path', argumentsValue)],
    ['seed.audio', async (argumentsValue) => await this.invokePluginBroker(String(argumentsValue.package_id || ''), 'seed.audio', argumentsValue)],
    ['seed.configuration', async (argumentsValue) => await this.invokePluginBroker(String(argumentsValue.package_id || ''), 'seed.configuration', argumentsValue)],
    ['seed.management.text', async (argumentsValue) => await this.invokePluginBroker(String(argumentsValue.package_id || ''), 'seed.management.text', argumentsValue)],
    ['seed.local-client.authorize', async (argumentsValue) => {
      const pluginId = String(argumentsValue.package_id || '')
      const clientId = String(argumentsValue.client_id || '')
      const installationId = String(argumentsValue.installation_id || '')
      const displayName = String(argumentsValue.display_name || '').trim()
      const deviceName = typeof argumentsValue.device_name === 'string'
        ? argumentsValue.device_name.trim()
        : ''
      const presentedToken = String(argumentsValue.token || '')
      if (
        !pluginId
        || !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(clientId)
        || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$/.test(installationId)
        || !displayName
        || displayName.length > 100
        || deviceName.length > 100
      ) {
        throw new Error('本地客户端身份无效。')
      }
      const existing = await this.store.localClientByIdentity(clientId, installationId)
      const tokenMatches = Boolean(existing && await this.store.matchesLocalClientToken(existing.id, presentedToken))
      if (existing?.pluginIds.includes(pluginId) && tokenMatches) {
        const metadataChanged = existing.displayName !== displayName
          || (Boolean(deviceName) && existing.deviceName !== deviceName)
        if (metadataChanged) {
          await this.store.updateLocalClientMetadata(existing.id, {
            displayName,
            ...(deviceName ? { deviceName } : {}),
          })
          this.localClients = await this.store.localClients()
          await this.publishSnapshot()
        }
        return { id: existing.id, token: presentedToken }
      }
      const token = tokenMatches ? presentedToken : randomBytes(32).toString('base64url')
      const authorizationBeforeSave = await this.store.localClientByIdentity(clientId, installationId)
      const id = await this.store.authorizeLocalClient({
        pluginId,
        clientId,
        installationId,
        displayName,
        ...(deviceName ? { deviceName } : {}),
        token,
      })
      this.localClients = await this.store.localClients()
      const authorized = this.localClients.find((client) => client.id === id)
      if (authorized) this.connector.send({
        type: 'local-gateway.event',
        event: {
          type: 'client.authorization.changed',
          client_id: authorized.clientId,
          installation_id: authorized.installationId,
          plugin_ids: authorized.pluginIds,
          state: 'authorized',
        },
      })
      const authorizedPlugin = this.installedPlugins.find((candidate) => candidate.id === pluginId)
      await this.store.auditSystem(authorizationBeforeSave ? 'local_client.scope.grant' : 'local_client.authorize', 'allowed', `已允许 ${displayName} 连接 ${authorizedPlugin?.name.zh_Hans || '插件'}。`, 'control', {
        client_name: displayName,
        plugin_id: pluginId,
        ...(authorizedPlugin ? { plugin_name_en_us: authorizedPlugin.name.en_US, plugin_name_zh_hans: authorizedPlugin.name.zh_Hans } : {}),
      })
      await this.publishSnapshot()
      return { id, token }
    }],
    ['seed.local-client.verify', async (argumentsValue) => {
      const authorizationId = await this.store.localClientAuthorizationId(
        String(argumentsValue.package_id || ''),
        String(argumentsValue.token || ''),
      )
      return {
        authorized: Boolean(authorizationId),
        ...(authorizationId ? { auth_id: authorizationId } : {}),
      }
    }],
    ['seed.plugin.audit', async (argumentsValue) => {
      const packageId = String(argumentsValue.package_id || '')
      const pluginVersion = String(argumentsValue.plugin_version || '')
      const plugin = this.runtimePlugins.find((candidate) => candidate.package_id === packageId && candidate.version === pluginVersion)
      if (!plugin) throw new Error('插件审计事件来源无效。')
      const entry = pluginAuditRecordSchema.parse(argumentsValue.entry)
      const locale = resolveSeedLocale(this.store.languagePreference())
      const trace = argumentsValue.trace && typeof argumentsValue.trace === 'object'
        ? argumentsValue.trace as Record<string, unknown> : null
      const visibility = entry.visibility ?? (entry.operation.startsWith('capability.') ? 'technical' : 'activity')
      await this.store.addAudit({
        source: 'plugin',
        operation: `plugin.${packageId}.${entry.operation}`,
        capability: packageId,
        method: entry.operation,
        outcome: entry.outcome,
        risk: entry.risk ?? 'read',
        summary: resolveSeedLocalizedText(entry.summary, locale, `${packageId}: ${entry.operation}`),
        ...(entry.run_id ? { runId: entry.run_id } : {}),
        ...(entry.request_id ? { requestId: entry.request_id } : {}),
        ...(entry.error_code ? { errorCode: entry.error_code } : {}),
        visibility,
        ...(typeof trace?.trace_id === 'string' && typeof trace.span_id === 'string'
          ? { traceId: trace.trace_id, parentSpanId: trace.span_id,
            recordKind: 'event' } as const : {}),
        metadata: { plugin_version: pluginVersion, ...entry.metadata },
      })
      await this.publishSnapshot()
      return { recorded: true }
    }],
    ['seed.plugin-secret', async (argumentsValue) => {
      const packageId = String(argumentsValue.package_id || '')
      const key = String(argumentsValue.key || '')
      const operation = String(argumentsValue.operation || '')
      if (!this.runtimePlugins.some((plugin) => plugin.package_id === packageId)
        || !/^[a-z][a-z0-9_.-]{0,127}$/.test(key)) throw new Error('插件私密凭据请求无效。')
      if (operation === 'get') return { value: this.store.pluginSecret(packageId, key) }
      if (operation === 'set') {
        const value = typeof argumentsValue.value === 'string' ? argumentsValue.value : ''
        if (!value || Buffer.byteLength(value, 'utf8') > 64 * 1024) throw new Error('插件私密凭据为空或超过 64 KiB。')
        await this.store.setPluginSecret(packageId, key, value)
        return { stored: true }
      }
      if (operation === 'delete') {
        await this.store.removePluginSecret(packageId, key)
        return { deleted: true }
      }
      throw new Error('插件私密凭据操作无效。')
    }],
    ['seed.plugin-authorization', async (argumentsValue) => {
      const packageId = String(argumentsValue.package_id || '')
      const plugin = this.runtimePlugins.find((candidate) => candidate.package_id === packageId)
      const installedPlugin = this.installedPlugins.find((candidate) => candidate.id === packageId)
      const pluginName = installedPlugin?.name.zh_Hans || '插件'
      const auditMetadata = installedPlugin ? {
        plugin_id: packageId,
        plugin_name_en_us: installedPlugin.name.en_US,
        plugin_name_zh_hans: installedPlugin.name.zh_Hans,
      } : { plugin_id: packageId }
      const requestId = String(argumentsValue.request_id || '')
      if (argumentsValue.operation === 'cancel') {
        if (!plugin) throw Object.assign(new Error('插件授权来源无效。'), { code: 'broker_permission_denied' })
        this.pluginBrowserAuthorization.cancel(packageId, requestId)
        return { cancelled: true }
      }
      if (argumentsValue.operation !== 'start') throw new Error('插件授权操作无效。')
      const request = argumentsValue.request as import('@motusai/seed-sdk').SeedBrowserAuthorizationRequest
      if (!request || typeof request !== 'object') throw new Error('插件授权请求无效。')
      const standardPermission = request.standard === 'oauth2.authorization_code.pkce'
        ? 'authorization.oauth2.pkce'
        : request.standard === 'openid_connect.authorization_code.pkce'
          ? 'authorization.oidc.pkce'
          : ''
      if (!standardPermission || !plugin?.permissions.includes(standardPermission)) {
        await this.store.auditSystem('plugin.authorization', 'denied', `${pluginName} 未获浏览器授权权限。`, 'control', auditMetadata).catch(() => undefined)
        throw Object.assign(new Error('插件未声明对应标准的浏览器授权权限。'), { code: 'broker_permission_denied' })
      }
      const permission = authorizationEndpointPermission(request.authorization_endpoint)
      if (!plugin.permissions.includes(permission)) {
        await this.store.auditSystem('plugin.authorization', 'denied', `${pluginName} 未获浏览器授权权限。`, 'control', auditMetadata).catch(() => undefined)
        throw Object.assign(new Error(`插件未声明 ${permission} 权限。`), { code: 'broker_permission_denied' })
      }
      try {
        const result = await this.pluginBrowserAuthorization.start(packageId, requestId, request)
        await this.store.auditSystem('plugin.authorization', 'allowed', `${pluginName} 已完成浏览器授权。`, 'control', auditMetadata).catch(() => undefined)
        return result
      } catch (error) {
        await this.store.auditSystem('plugin.authorization', 'failed', `${pluginName} 的浏览器授权未完成。`, 'control', auditMetadata).catch(() => undefined)
        throw error
      }
    }],
    ['seed.plugin-capability.verify-approval', async (argumentsValue) => {
      const consumerPluginId = String(argumentsValue.consumer_plugin_id || '')
      const capabilityVersion = Number(argumentsValue.capability_version)
      if (!consumerPluginId || !argumentsValue.provider_plugin_id || !argumentsValue.capability || !argumentsValue.method
        || !Number.isInteger(capabilityVersion) || capabilityVersion <= 0) {
        throw new Error('本地客户端的逐次审批凭据请求无效。')
      }
      const consumer = this.runtimePlugins.find((plugin) => plugin.package_id === consumerPluginId)
      if (!consumer?.permissions.includes('local.client-capability-approval')) return { allowed: false }
      return { allowed: await this.verifyLocalClientCapabilityApproval(argumentsValue, consumer) }
    }],
  ])

  constructor(
    private window: () => BrowserWindow | null,
    private languagePreferenceChanged: (preference: SeedLanguagePreference) => void,
    prepareToInstallUpdate: () => void,
    audioStateChanged: () => void = () => undefined,
    readonly diagnostics = new ObservationStore(app.getPath('userData'), buildConfig.appName),
  ) {
    this.store = new SeedStore(app.getPath('userData'), buildConfig.appName, diagnostics)
    this.pluginInstaller = new SeedPluginInstaller(app.getPath('userData'), () => this.distribution?.market_url || '', {
      read: () => this.store.installedPluginState(),
      write: (state) => this.store.setInstalledPluginState(state),
    }, app.getVersion(), () => this.cloudAccessToken())
    this.fileBroker = new FileBroker(() => ({
      backup_root: join(app.getPath('userData'), 'backups'),
    }), (path) => shell.trashItem(path))
    this.sidecarProcessService = new SidecarProcessService(() => this.runtimePlugins, this.fileBroker,
      (packageId, event, message, details) => this.diagnostics.record({
        level: event === 'sidecar.stderr' ? 'warn' : 'error', source: 'sidecar', event, message, plugin_id: packageId, details,
      }))
    this.pythonEnvironmentService = new PythonEnvironmentService(
      () => this.runtimePlugins,
      join(app.getPath('userData'), 'python-environments'),
      app.isPackaged ? join(process.resourcesPath, 'python') : resolve(__dirname, '../../../resources/python'),
    )
    this.hostServices.set('seed.process', async (argumentsValue) => await this.invokePluginBroker(
      String(argumentsValue.package_id || ''),
      'seed.process',
      argumentsValue,
    ))
    this.hostServices.set('seed.python', async (argumentsValue) => await this.invokePluginBroker(
      String(argumentsValue.package_id || ''),
      'seed.python',
      argumentsValue,
    ))
    this.audioService = new AudioService(() => {
      audioStateChanged()
      void this.publishSnapshot()
    }, join(app.getPath('userData'), 'plugin-data'))
    this.sandboxHost = new SeedPluginSandboxSupervisor((packageId, service, argumentsValue) => (
      this.invokePluginBroker(packageId, service, argumentsValue)
    ), (packageId, event, message, details) => this.diagnostics.record({
      level: event.endsWith('.failed') || event.endsWith('.gone') ? 'error' : 'info',
      source: 'plugin-host', event, message, plugin_id: packageId, details,
    }))
    this.updater = new SeedUpdater(
      (_state: AppUpdateState) => void this.publishSnapshot(),
      prepareToInstallUpdate,
    )
    this.distributionEvents = new SeedDistributionEvents(
      (event) => void this.handleDistributionEvent(event).catch(() => undefined),
      () => void this.reconcileDistributionState().catch(() => undefined),
    )
    this.connector = new ConnectorManager(
      buildConfig.appName,
      (event) => void this.handleWorkerEvent(event),
      (code) => {
        this.diagnostics.record({ level: 'fatal', source: 'connector', event: 'process.gone', message: `Connector exited with code ${code}.`, details: { exit_code: code } })
        this.diagnostics.interruptOpenSpans(undefined, 'connector_process_gone', `Connector exited with code ${code}.`)
      },
      (stream, chunk) => this.diagnostics.record({ level: stream === 'stderr' ? 'warn' : 'info', source: 'connector', event: `process.${stream}`, message: chunk }),
    )
    this.nativeHost = new NativePluginManager(buildConfig.appName,
      (packageId, service, args) => this.invokePluginBroker(packageId, service, args),
      (packageId, snapshot) => this.connector.send({ type: 'native.runtime.updated', packageId, snapshot }),
      (packageId, event, error) => {
        this.diagnostics.record({ level: 'error', source: 'plugin-host', event, plugin_id: packageId, ...errorDetails(error) })
        if (event === 'native.process.gone') this.diagnostics.interruptOpenSpans(packageId, 'native_process_gone', error.message)
        if (event === 'native.process.gone') void this.handleWorkerEvent({ type: 'plugin.runtime.failed', packageId, message: error.message })
      },
      (event) => void this.handleWorkerEvent(event),
      (packageId, stream, chunk) => this.diagnostics.record({ level: stream === 'stderr' ? 'warn' : 'info',
        source: 'plugin-host', event: `native.process.${stream}`, message: chunk, plugin_id: packageId }),
      (entry) => this.diagnostics.record({ ...entry, level: entry.phase === 'failed' ? 'error' : 'info', source: 'plugin-host' }),
    )
    this.hostServices.set('seed.native.start', async (args) => {
      const plugin = args.plugin as SeedPluginRuntimeDefinition | undefined
      const configured = this.runtimePlugins.find((candidate) => candidate.package_id === plugin?.package_id)
      if (!plugin || !configured || JSON.stringify(plugin) !== JSON.stringify(configured)) throw new Error('原生插件运行定义无效。')
      const configuration = args.configuration as Extract<import('../shared/contracts').WorkerCommand, { type: 'configure' }> | undefined
      if (!configuration || configuration.pluginDataRoot !== join(app.getPath('userData'), 'plugin-data')) throw new Error('原生插件运行配置无效。')
      return await this.nativeHost.start(plugin, configuration)
    })
    this.hostServices.set('seed.native.stop', async (args) => { await this.nativeHost.stop(String(args.package_id || '')); return null })
    this.hostServices.set('seed.native.invoke', async (args) => {
      const invocation = args.invocation as import('@motusai/seed-sdk').SeedInvocation
      const packageId = String(args.package_id || '')
      return await this.nativeHost.call(packageId, { type: 'invoke', capability: String(args.capability || ''),
        method: String(args.method || ''), invocation, chain: Array.isArray(args.chain) ? args.chain.filter((x): x is string => typeof x === 'string') : [],
        trace: args.trace as import('../shared/diagnostic-trace').DiagnosticTraceContext | undefined }, invocation.request_id)
    })
    this.hostServices.set('seed.native.cancel', async (args) => {
      this.nativeHost.cancel(String(args.package_id || ''), String(args.request_id || ''))
      return null
    })
    this.hostServices.set('seed.native.local-api', async (args) => await this.nativeHost.call(String(args.package_id || ''), {
      type: 'local-api', url: String(args.url || ''), method: String(args.method || ''),
      headers: args.headers as Array<[string, string]>, body: args.body as Uint8Array | undefined,
      client: args.client as import('@motusai/seed-sdk').SeedLocalApiClient | null,
      trace: args.trace as import('../shared/diagnostic-trace').DiagnosticTraceContext | undefined,
    }))
    this.hostServices.set('seed.native.local-api.read', async (args) => await this.nativeHost.call(String(args.package_id || ''), {
      type: 'local-api-read', stream_id: String(args.stream_id || ''),
    }))
    this.hostServices.set('seed.native.local-api.close', async (args) => await this.nativeHost.call(String(args.package_id || ''), {
      type: 'local-api-close', stream_id: String(args.stream_id || ''),
    }))
    this.hostServices.set('seed.native.configuration-options', async (args) => await this.nativeHost.call(String(args.package_id || ''), {
      type: 'configuration-options', configuration_id: String(args.configuration_id || ''), field_key: String(args.field_key || ''),
      values: args.values as Record<string, string>,
    }))
    this.hostServices.set('seed.native.reconnect', async (args) => await this.nativeHost.call(String(args.package_id || ''), {
      type: 'reconnect', configuration_id: String(args.configuration_id || ''), profile_id: String(args.profile_id || ''),
    }))
  }

  async initialize() {
    await this.store.load()
    this.localClients = await this.store.localClients()
    this.languagePreferenceChanged(this.store.languagePreference())
    this.syncPreventSystemSleep()
    await this.reloadPlugins()
    const storedCloudSession = this.store.cloudSession()
    if (storedCloudSession && Date.parse(storedCloudSession.refreshExpiresAt) > Date.now()) {
      this.user = storedCloudSession.user
      this.authStatus = { status: 'signed_in' }
    } else if (storedCloudSession) {
      await this.store.clearCloudSession()
    }
    this.connector.start()
    this.entitlementTimer = setInterval(() => {
      if (!this.user) return
      void this.refreshInstalledEntitlements().catch(() => {
        if (Date.now() >= this.entitlementExpiresAt) void this.applyExpiredEntitlements()
      })
    }, 60_000)
    if (this.user) this.configureWorker()
    this.updater.start()
    void this.currentDistribution().catch(() => undefined)
    this.startupStatus = 'ready'
    await this.publishSnapshot()
    void this.refreshStartupCloudState(storedCloudSession).catch(() => undefined)
  }

  private async refreshStartupCloudState(storedCloudSession: ReturnType<SeedStore['cloudSession']>) {
    if (!storedCloudSession || Date.parse(storedCloudSession.refreshExpiresAt) <= Date.now()) return
    if (this.store.cloudSession()?.refreshToken !== storedCloudSession.refreshToken) return
    try {
      await this.cloudAccessToken(storedCloudSession.accessToken)
      await this.refreshPluginCatalog().catch(() => undefined)
    } catch { /* Keep the current session on temporary network failures. */ }
  }

  private emit(event: SeedEvent) {
    this.window()?.webContents.send('seed:event', event)
  }

  private async handleWorkerEvent(event: WorkerEvent) {
    if (event.type === 'diagnostic') {
      this.diagnostics.record({ level: event.level, source: 'connector', event: event.event,
        message: event.message, error_name: event.error_name, error_stack: event.error_stack,
        plugin_id: event.plugin_id, plugin_version: event.plugin_version,
        request_id: event.request_id, operation: event.operation,
        trace_id: event.trace_id, span_id: event.span_id, parent_span_id: event.parent_span_id,
        phase: event.phase, duration_ms: event.duration_ms, error_code: event.error_code, details: event.details })
      return
    }
    if (event.type === 'plugin.contributions.changed') {
      if (event.configurations.length || event.managementViews.length) {
        this.pluginContributions.set(event.packageId, {
          configurations: event.configurations,
          managementViews: event.managementViews,
        })
      } else {
        this.pluginContributions.delete(event.packageId)
      }
      this.installedPlugins = this.installedPlugins.map((plugin) => plugin.id === event.packageId
        ? { ...plugin, configurations: event.configurations, managementViews: event.managementViews }
        : plugin)
      await this.publishSnapshot()
      return
    }
    if (event.type === 'plugin.runtime.failed') {
      const plugin = this.installedPlugins.find((candidate) => candidate.id === event.packageId)
      await this.store.auditSystem('plugin.runtime.start', 'failed', `${plugin?.name.zh_Hans || '插件'}启动失败：${event.message}`, 'control', {
        plugin_id: event.packageId,
        ...(plugin ? { plugin_name_en_us: plugin.name.en_US, plugin_name_zh_hans: plugin.name.zh_Hans } : {}),
      })
      await this.publishSnapshot()
      return
    }
    if (event.type === 'host.invoke') {
      const trace = event.trace && { trace_id: event.trace.trace_id, span_id: randomUUID(), parent_span_id: event.trace.span_id }
      const started = performance.now()
      const span = trace && { ...trace, source: 'broker' as const, event: 'host.invoke', operation: event.service,
        request_id: event.requestId }
      if (span) this.diagnostics.record({ ...span, level: 'info', phase: 'started', message: 'Host service started.' })
      try {
        const service = this.hostServices.get(event.service)
        if (!service) throw new Error(`Seed 主进程不支持服务：${event.service}`)
        const result = await service(event.arguments)
        if (span) this.diagnostics.record({ ...span, level: 'info', phase: 'completed',
          duration_ms: Math.round(performance.now() - started), message: 'Host service completed.' })
        this.connector.send({
          type: 'host.result',
          requestId: event.requestId,
          ok: true,
          result,
        })
      } catch (error) {
        this.diagnostics.record({ ...(span || { source: 'broker' as const, event: 'host.invoke', operation: event.service,
          request_id: event.requestId }), level: 'error', phase: 'failed',
          duration_ms: Math.round(performance.now() - started),
          error_code: error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined,
          ...errorDetails(error) })
        this.connector.send({
          type: 'host.result',
          requestId: event.requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          errorCode: error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
            ? String((error as { code: string }).code)
            : 'host_invoke_error',
        })
      }
      return
    }
    if (event.type === 'task.changed') {
      if (event.phase === 'started') {
        const startsBatch = this.activeTasks.size === 0
        if (startsBatch) this.taskBatchHadFailure = false
        this.activeTasks.add(event.requestId)
        this.activeTaskIds.set(event.requestId, event.taskId)
        this.taskStartedAt.set(event.requestId, Date.now())
        if (startsBatch) {
          await this.setMascotState('running')
          this.scheduleMascotWorking()
        } else {
          await this.publishSnapshot()
        }
      } else {
        const startedAt = this.taskStartedAt.get(event.requestId)
        if (event.phase === 'failed') this.taskBatchHadFailure = true
        this.activeTasks.delete(event.requestId)
        this.activeTaskIds.delete(event.requestId)
        this.taskStartedAt.delete(event.requestId)
        if (this.activeTasks.size > 0) {
          await this.publishSnapshot()
        } else {
          const remainingRunningMs = remainingMascotRunningMs(startedAt)
          this.scheduleMascotState(
            this.taskBatchHadFailure ? 'failed' : 'review',
            remainingRunningMs,
            this.taskBatchHadFailure ? mascotTiming.failedMs : mascotTiming.reviewMs,
          )
        }
      }
      return
    }
    if (event.type === 'audit') await this.store.addAudit(event.entry)
    await this.publishSnapshot()
  }

  private async setMascotState(state: MascotState, resetAfterMs?: number) {
    if (state !== 'running' && this.mascotWorkTimer) clearTimeout(this.mascotWorkTimer)
    if (state !== 'running') this.mascotWorkTimer = null
    if (this.mascotResetTimer) clearTimeout(this.mascotResetTimer)
    this.mascotResetTimer = null
    this.mascotState = state
    this.mascotChangedAt = new Date().toISOString()
    await this.publishSnapshot()
    if (resetAfterMs) {
      this.mascotResetTimer = setTimeout(() => {
        this.mascotResetTimer = null
        if (this.activeTasks.size === 0) void this.setMascotState('idle')
      }, resetAfterMs)
    }
  }

  private scheduleMascotWorking() {
    if (this.mascotWorkTimer) clearTimeout(this.mascotWorkTimer)
    this.mascotWorkTimer = setTimeout(() => {
      this.mascotWorkTimer = null
      if (this.activeTasks.size > 0 && this.mascotState === 'running') void this.setMascotState('working')
    }, mascotTiming.workingTransitionMs)
  }

  private scheduleMascotState(state: MascotState, delayMs: number, resetAfterMs: number) {
    if (this.mascotResetTimer) clearTimeout(this.mascotResetTimer)
    this.mascotResetTimer = setTimeout(() => {
      this.mascotResetTimer = null
      if (this.activeTasks.size === 0) void this.setMascotState(state, resetAfterMs)
    }, delayMs)
  }

  private configureWorker() {
    this.connector.send({
      type: 'configure',
      appVersion: app.getVersion(),
      locale: resolveSeedLocale(this.store.languagePreference()),
      backupRoot: join(app.getPath('userData'), 'backups'),
      pluginDataRoot: join(app.getPath('userData'), 'plugin-data'),
      plugins: this.runtimePlugins,
    })
  }

  snapshot(): SeedSnapshot {
    const loginSettings = app.getLoginItemSettings()
    const audio = this.audioService.snapshot()
    return {
      appName: buildConfig.appName,
      appVersion: app.getVersion(),
      platform: process.platform,
      architecture: process.arch,
      startup: { status: this.startupStatus },
      auth: this.authStatus,
      ...(this.user ? { user: this.user } : {}),
      plugins: this.installedPlugins.filter((plugin) => this.pluginIsAuthorized(plugin.id)),
      catalogPlugins: this.remotePluginCatalog,
      ...(this.remotePluginCatalogNextCursor ? { catalogNextCursor: this.remotePluginCatalogNextCursor } : {}),
      localClients: this.localClients,
      ...(this.navigationRequest ? { navigationRequest: this.navigationRequest } : {}),
      audit: this.store.audit(),
      launchAtLogin: loginSettings.openAtLogin,
      preventSystemSleep: this.store.preventSystemSleep(),
      languagePreference: this.store.languagePreference(),
      locale: resolveSeedLocale(this.store.languagePreference()),
      themePreference: this.store.themePreference(),
      pluginConfigurations: Object.fromEntries(this.installedPlugins.filter((plugin) => this.pluginIsAuthorized(plugin.id)).flatMap((plugin) => plugin.configurations.map((configuration) => {
        const key = pluginConfigurationKey(plugin.id, configuration.id)
        return [key, pluginConfigurationState(configuration, this.store.pluginConfiguration(key))]
      }))),
      update: this.updater.snapshot(),
      audio: {
        ...(audio.session_id ? { sessionId: audio.session_id } : {}),
        state: audio.state,
        durationMs: audio.duration_ms,
        ...(audio.error ? { error: audio.error } : {}),
      },
      mascot: {
        state: this.mascotState,
        changedAt: this.mascotChangedAt,
        activeTaskCount: new Set(this.activeTaskIds.values()).size,
      },
    }
  }

  async publishSnapshot() {
    this.emit({ type: 'snapshot.changed', snapshot: this.snapshot() })
  }

  async requestNavigation(request: Omit<NonNullable<SeedSnapshot['navigationRequest']>, 'id'>) {
    this.navigationRequest = { id: randomUUID(), ...request }
    await this.publishSnapshot()
  }

  audioSnapshot() {
    return this.audioService.snapshot()
  }

  resumeNetworkConnections() {
    this.distributionEvents.reconnectNow()
  }

  async cancelAudio() {
    return await this.audioService.cancelActive()
  }

  async signIn() {
    if (this.pendingCloudAuthorization) return
    const distribution = await this.currentDistribution()
    const authorization = createCloudAuthorization(distribution)
    this.authStatus = { status: 'authorizing' }
    await this.publishSnapshot()
    let authorizationTimeout: ReturnType<typeof setTimeout> | undefined
    try {
      const code = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('登录请求已超时，请重新登录。')), 10 * 60_000)
        authorizationTimeout = timeout
        this.pendingCloudAuthorization = {
          state: authorization.state,
          verifier: authorization.verifier,
          resolve,
          reject,
          timeout,
        }
        void openCloudAuthorization(authorization).catch(reject)
      })
      const credential = await exchangeCloudAuthorizationCode(distribution, code, authorization.verifier)
      await this.store.setCloudSession(credential)
      this.user = credential.user
      this.authStatus = { status: 'signed_in' }
      try {
        await this.refreshInstalledEntitlements()
      } catch (error) {
        if (!this.user) throw error
        await this.store.auditSystem('plugin.entitlements', 'failed', error instanceof Error ? error.message : String(error))
      }
      await this.store.auditSystem('account.login', 'allowed', 'Seed Cloud 账号登录已完成。')
      await this.refreshPluginCatalog({ refreshEntitlements: false }).catch(() => undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === '登录已取消。') {
        this.authStatus = { status: 'signed_out' }
        return
      }
      this.authStatus = { status: 'error', error: message }
      await this.store.auditSystem('account.login', 'failed', message)
      await this.publishSnapshot()
      throw error
    } finally {
      if (authorizationTimeout) clearTimeout(authorizationTimeout)
      this.pendingCloudAuthorization = null
      await this.publishSnapshot()
    }
  }

  async cancelSignIn() {
    if (!this.pendingCloudAuthorization) throw new Error('当前没有等待中的登录流程。')
    const pending = this.pendingCloudAuthorization
    this.pendingCloudAuthorization = null
    clearTimeout(pending.timeout)
    pending.reject(new Error('登录已取消。'))
    this.authStatus = { status: 'signed_out' }
    await this.publishSnapshot()
  }

  handleOAuthCallback(value: string) {
    const distribution = this.distribution
    if (!distribution) return false
    const callback = parseCloudAuthorizationCallback(value, distribution.auth.redirect_uri)
    if (!callback) return false
    this.showAuthorizationWindow()
    const pending = this.pendingCloudAuthorization
    if (!pending) {
      this.authStatus = { status: 'error', error: '登录请求已经结束，请重新登录。' }
      void this.publishSnapshot()
      return true
    }
    if (!stateMatches(callback.state, pending.state)) {
      pending.reject(new Error('登录状态无效，请重新登录。'))
    } else if (callback.error) {
      pending.reject(new Error(callback.error === 'access_denied' ? '登录已取消。' : '登录授权失败。'))
    } else if (!callback.code) {
      pending.reject(new Error('登录回调缺少授权码。'))
    } else {
      pending.resolve(callback.code)
    }
    return true
  }

  handlePluginOAuthCallback(value: string) {
    return this.pluginBrowserAuthorization.handleCallback(value)
  }

  async logout() {
    this.pluginBrowserAuthorization.cancelAll()
    this.pendingCloudAuthorization?.reject(new Error('登录已取消。'))
    if (this.pendingCloudAuthorization) clearTimeout(this.pendingCloudAuthorization.timeout)
    this.pendingCloudAuthorization = null
    const cloudSession = this.store.cloudSession()
    // Connector lifecycle commands are serialized; let it finish plugin cleanup without blocking account logout.
    this.connector.send({ type: 'unconfigure' })
    await this.store.clearCloudSession()
    this.user = undefined
    this.authorizedInstalledPluginIds.clear()
    this.entitlementExpiresAt = 0
    this.remotePluginCatalog = []
    this.verifiedCatalogPlugins.clear()
    await this.reloadPlugins()
    this.authStatus = { status: 'signed_out' }
    this.activeTasks.clear()
    this.activeTaskIds.clear()
    this.taskStartedAt.clear()
    this.taskBatchHadFailure = false
    if (this.mascotResetTimer) clearTimeout(this.mascotResetTimer)
    this.mascotResetTimer = null
    if (this.mascotWorkTimer) clearTimeout(this.mascotWorkTimer)
    this.mascotWorkTimer = null
    this.mascotState = 'idle'
    this.mascotChangedAt = new Date().toISOString()
    if (cloudSession && this.distribution) {
      void revokeCloudCredential(this.distribution, cloudSession.refreshToken).catch(() => undefined)
    }
    await this.store.auditSystem('account.logout', 'allowed', '已退出登录。')
    await this.publishSnapshot()
  }

  private showAuthorizationWindow() {
    const window = this.window()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    if (process.platform === 'darwin') app.focus({ steal: true })
    window.focus()
  }

  private async verifyLocalClientCapabilityApproval(
    argumentsValue: Record<string, unknown>,
    consumer: SeedPluginRuntimeDefinition,
  ) {
    if (consumer.publisher_type !== 'official' || consumer.runtime_kind !== 'native-host') return false
    const approval = argumentsValue.approval
    const now = Date.now()
    for (const [id, expiresAt] of this.consumedLocalClientApprovalIds) {
      if (expiresAt <= now) this.consumedLocalClientApprovalIds.delete(id)
    }
    if (!approval) return false
    const valid = validateLocalClientCapabilityApproval(argumentsValue, this.consumedLocalClientApprovalIds, now)
    if (!valid || !await this.store.hasLocalClientAuthorization(consumer.package_id, valid.authorizationId)) return false
    this.consumedLocalClientApprovalIds.set(valid.id, valid.expiresAt)
    return true
  }

  async setLaunchAtLogin(enabled: boolean) {
    app.setLoginItemSettings({ openAtLogin: enabled })
    await this.store.auditSystem('settings.launch_at_login', 'allowed', enabled ? '已开启登录时启动。' : '已关闭登录时启动。')
    await this.publishSnapshot()
    return app.getLoginItemSettings().openAtLogin
  }

  async setPreventSystemSleep(enabled: boolean) {
    await this.store.setPreventSystemSleep(enabled)
    this.syncPreventSystemSleep()
    await this.store.auditSystem('settings.prevent_system_sleep', 'allowed', enabled ? '已开启运行时防止系统休眠。' : '已关闭运行时防止系统休眠。')
    await this.publishSnapshot()
    return this.store.preventSystemSleep()
  }

  async setLanguagePreference(preference: SeedLanguagePreference) {
    await this.store.setLanguagePreference(preference)
    this.languagePreferenceChanged(preference)
    this.configureWorker()
    await this.publishSnapshot()
  }

  async setThemePreference(preference: SeedThemePreference) {
    await this.store.setThemePreference(preference)
    await this.publishSnapshot()
  }

  async updatePluginConfiguration(input: UpdatePluginConfigurationInput) {
    const locale = resolveSeedLocale(this.store.languagePreference())
    const english = locale.toLowerCase().startsWith('en')
    const plugin = this.installedPlugins.find((candidate) => candidate.id === input.pluginId && candidate.enabled && this.pluginIsAuthorized(candidate.id))
    const configuration = plugin?.configurations.find((candidate) => candidate.id === input.configurationId)
    if (!plugin || !configuration) throw new Error(english
      ? 'The plugin is not installed, is disabled, or has no configuration.'
      : '插件未安装、未启用或没有可配置项。')
    if (configuration.permission && !plugin.permissions.includes(configuration.permission)) throw new Error(english
      ? 'The plugin did not declare the permission required by this configuration.'
      : '插件未声明配置所需权限。')
    const key = pluginConfigurationKey(plugin.id, configuration.id)
    const value = normalizePluginConfiguration(configuration, input.values, this.store.pluginConfiguration(key), locale)
    const groupedConfigurations = configuration.profiles.defaultGroup
      ? plugin.configurations.filter((candidate) => candidate.profiles.defaultGroup === configuration.profiles.defaultGroup)
      : [configuration]
    const groupedValues = new Map(groupedConfigurations.map((candidate) => [
      candidate.id,
      candidate.id === configuration.id
        ? value
        : this.store.pluginConfiguration(pluginConfigurationKey(plugin.id, candidate.id)) || initialPluginConfiguration(candidate),
    ]))
    const reconciled = reconcilePluginConfigurationDefaultGroup(plugin.configurations, groupedValues, configuration.id)
    await this.store.setPluginConfigurations(Object.fromEntries([...reconciled].map(([configurationId, stored]) => [
      pluginConfigurationKey(plugin.id, configurationId),
      stored,
    ])))
    await this.store.auditSystem('settings.plugin_configuration', 'allowed', `已更新 ${plugin.name.zh_Hans} 的${configuration.title.zh_Hans}配置。`, 'control', {
      plugin_id: plugin.id,
      plugin_name_en_us: plugin.name.en_US,
      plugin_name_zh_hans: plugin.name.zh_Hans,
      action_label_en_us: configuration.title.en_US,
      action_label_zh_hans: configuration.title.zh_Hans,
    })
    this.runtimePlugins = this.runtimePlugins.map((candidate) => candidate.package_id === plugin.id
      ? { ...candidate, configuration_revision: randomUUID() }
      : candidate)
    this.configureWorker()
    await this.publishSnapshot()
  }

  async queryPluginConfigurationOptions(input: import('../shared/contracts').QueryPluginConfigurationOptionsInput) {
    if (!this.user || this.authStatus.status !== 'signed_in') return []
    const plugin = this.installedPlugins.find((candidate) => candidate.id === input.pluginId && candidate.enabled && candidate.status === 'ready' && this.pluginIsAuthorized(candidate.id))
    const configuration = plugin?.configurations.find((candidate) => candidate.id === input.configurationId)
    const field = configuration
      ? [...configuration.profiles.fields, ...configuration.fields].find((candidate) => candidate.key === input.fieldKey)
      : undefined
    if (!plugin || !configuration || !field?.dynamicOptions) throw new Error('插件动态配置选项不可用。')
    return await this.connector.queryPluginConfigurationOptions(plugin.id, configuration.id, field.key, input.values)
  }

  async queryPluginConfigurationProfileStatuses(input: import('../shared/contracts').QueryPluginConfigurationProfileStatusesInput) {
    const plugin = this.installedPlugins.find((candidate) => candidate.id === input.pluginId && candidate.enabled && candidate.status === 'ready' && this.pluginIsAuthorized(candidate.id))
    const configuration = plugin?.configurations.find((candidate) => candidate.id === input.configurationId)
    if (!plugin || !configuration?.profiles.status || configuration.profiles.status.source !== 'connections') {
      throw new Error('插件配置档案状态不可用。')
    }
    return await this.connector.queryPluginConfigurationProfileStatuses(plugin.id, configuration.id)
  }

  async reconnectPluginConfigurationProfile(input: import('../shared/contracts').ReconnectPluginConfigurationProfileInput) {
    const plugin = this.installedPlugins.find((candidate) => candidate.id === input.pluginId && candidate.enabled && candidate.status === 'ready' && this.pluginIsAuthorized(candidate.id))
    const configuration = plugin?.configurations.find((candidate) => candidate.id === input.configurationId)
    if (!plugin || !configuration?.profiles.status || configuration.profiles.status.source !== 'connections') {
      throw new Error('插件配置档案状态不可用。')
    }
    await this.connector.reconnectPluginConfigurationProfile(plugin.id, configuration.id, input.profileId)
  }

  async queryPluginManagementView(input: import('../shared/contracts').QueryPluginManagementViewInput) {
    const plugin = this.installedPlugins.find((candidate) => candidate.id === input.pluginId && candidate.enabled && candidate.status === 'ready' && this.pluginIsAuthorized(candidate.id))
    const view = plugin?.managementViews.find((candidate) => candidate.id === input.viewId)
    const dataSource = input.sourceId ? view?.dataSources[input.sourceId] : undefined
    const source = input.sourceId ? dataSource : view?.source
    if (!plugin || !view || !source) throw new Error('插件管理视图不可用。')
    const argumentsValue = input.arguments || {}
    if (input.sourceId) {
      const allowed = new Set(dataSource?.parameters || [])
      if (Object.keys(argumentsValue).some((key) => !allowed.has(key))) throw new Error('插件管理数据源参数无效。')
    } else if (Object.keys(argumentsValue).length) {
      throw new Error('插件管理视图不接受动态参数。')
    }
    const capability = plugin.capabilities.find((candidate) => candidate.id === source.capability)
    const method = capability?.methods.find((candidate) => candidate.name === source.method)
    if (!method || method.risk !== 'read') throw new Error('插件管理视图只能读取插件声明的只读能力。')
    return await this.connector.queryPluginManagement(plugin.id, view.id, input.sourceId, argumentsValue)
  }

  async invokePluginManagementAction(input: import('../shared/contracts').InvokePluginManagementActionInput) {
    const plugin = this.installedPlugins.find((candidate) => candidate.id === input.pluginId && candidate.enabled && candidate.status === 'ready' && this.pluginIsAuthorized(candidate.id))
    const view = plugin?.managementViews.find((candidate) => candidate.id === input.viewId)
    const action = view?.actions.find((candidate) => candidate.id === input.actionId)
    if (!plugin || !view || !action) throw new Error('插件管理动作不可用。')
    const allowedArguments = new Set([
      ...Object.keys(action.argumentBindings),
      ...(action.input?.fields.map((field) => field.key) || []),
    ])
    if (Object.keys(input.arguments).some((key) => !allowedArguments.has(key))) throw new Error('插件管理动作参数无效。')
    const invalidField = action.input && invalidManagementInput(action.input.fields, input.arguments)
    if (invalidField) throw new Error(`插件管理字段无效：${invalidField}`)
    for (const field of action.input?.fields || []) {
      if (field.type !== 'file' || !input.arguments[field.key]) continue
      const path = input.arguments[field.key] as string
      const file = await realpath(path).then((resolved) => stat(resolved), () => null)
      if (!file?.isFile()) throw new Error(`所选文件不存在或不是普通文件：${field.key}`)
    }
    const capability = plugin.capabilities.find((candidate) => candidate.id === action.target.capability)
    const method = capability?.methods.find((candidate) => candidate.name === action.target.method)
    if (!method) throw new Error('插件管理动作引用的能力不可用。')
    const result = await this.connector.invokePluginManagement(plugin.id, view.id, action.id, input.arguments)
    await this.store.auditSystem(`plugin.${plugin.id}.management.${action.id}`, 'allowed', `已执行 ${plugin.name.zh_Hans} 的${action.label.zh_Hans}操作。`, method.risk, {
      plugin_id: plugin.id,
      plugin_name_en_us: plugin.name.en_US,
      plugin_name_zh_hans: plugin.name.zh_Hans,
      action_label_en_us: action.label.en_US,
      action_label_zh_hans: action.label.zh_Hans,
    })
    await this.publishSnapshot()
    return result
  }

  async checkForUpdates() {
    await this.currentDistribution()
    return await this.updater.check()
  }

  async downloadUpdate() {
    return await this.updater.download()
  }

  installUpdate() {
    return this.updater.install()
  }

  private syncPreventSystemSleep() {
    if (this.store.preventSystemSleep()) {
      if (this.powerSaveBlockerId === null || !powerSaveBlocker.isStarted(this.powerSaveBlockerId)) {
        this.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension')
      }
      return
    }
    if (this.powerSaveBlockerId !== null && powerSaveBlocker.isStarted(this.powerSaveBlockerId)) powerSaveBlocker.stop(this.powerSaveBlockerId)
    this.powerSaveBlockerId = null
  }

  async clearAudit() {
    await this.store.clearAudit()
    await this.publishSnapshot()
  }

  queryAudit(input: AuditQueryInput) {
    return this.store.queryAudit(input)
  }

  queryUsage() {
    return this.store.queryUsage()
  }

  async readProfile(): Promise<TerminalUserProfile> {
    return this.requestProfile(readCloudUser)
  }

  async updateProfile(input: UpdateProfileInput): Promise<TerminalUserProfile> {
    return this.requestProfile((distribution, accessToken) => updateCloudUser(distribution, accessToken, input))
  }

  private async requestProfile(request: (distribution: SeedDistribution, accessToken: string) => Promise<TerminalUserProfile>) {
    const distribution = await this.currentDistribution()
    const accessToken = await this.cloudAccessToken()
    let user: TerminalUserProfile
    try {
      user = await request(distribution, accessToken)
    } catch (error) {
      if (!cloudSessionWasRejected(error)) throw error
      user = await request(distribution, await this.cloudAccessToken(accessToken))
    }
    await this.rememberProfile(user)
    return user
  }

  private async rememberProfile(user: TerminalUserProfile) {
    const session = this.store.cloudSession()
    if (!session || session.user.id !== user.id) throw new Error('登录会话已改变。')
    if (session.user.displayName === user.displayName
      && session.user.username === user.username
      && session.user.avatarDataUrl === user.avatarDataUrl) return
    await this.store.setCloudSession({ ...session, user })
    this.user = user
    await this.publishSnapshot()
  }

  async uploadLogs(input: TerminalLogUploadRange) {
    if (this.logUploadAbortController) throw new Error('已有诊断包正在上传。')
    const accessToken = await this.cloudAccessToken()
    if (!this.user) throw new Error('请先登录 MotusAI Cloud 账号后再上传诊断包。')
    const endAt = new Date().toISOString()
    const startAt = new Date(Date.now() - input.days * 24 * 60 * 60 * 1_000).toISOString()
    const abortController = new AbortController()
    this.logUploadAbortController = abortController
    try {
      const activity = await this.store.auditForDiagnostics(startAt, endAt)
      const result = await this.logUploader.upload({
        cloudUrl: this.seedCloudUrl,
        accessToken,
        accountId: this.user.id,
        workDirectory: join(app.getPath('userData'), 'diagnostic-uploads'),
        days: input.days,
        appName: buildConfig.appName,
        appVersion: app.getVersion(),
        platform: process.platform,
        entries: activity.entries,
        entryCount: activity.count,
        plugins: this.installedPlugins.map((plugin) => ({ package_id: plugin.id, version: plugin.version,
          runtime_kind: plugin.runtimeKind, enabled: plugin.enabled, status: plugin.status,
          capabilities: plugin.capabilities.map((capability) => capability.id) })),
        crashDumpDirectory: app.getPath('crashDumps'),
        startAt,
        endAt,
      }, {
        signal: abortController.signal,
        onProgress: (progress) => {
          this.logUploadPhase = progress.phase
          this.emit({ type: 'logs.upload.progress', progress })
        },
      })
      await this.store.auditSystem('logs.upload', 'allowed', `诊断包已上传：${result.uploadId}`, 'write')
      await this.publishSnapshot()
      return result
    } catch (error) {
      if (abortController.signal.aborted) {
        await this.store.auditSystem('logs.upload', 'denied', '诊断包上传已取消。', 'write')
        await this.publishSnapshot()
        return false
      }
      const message = error instanceof Error ? error.message : String(error)
      await this.store.auditSystem('logs.upload', 'failed', `诊断包上传失败：${message}`, 'write')
      await this.publishSnapshot()
      throw error
    } finally {
      if (this.logUploadAbortController === abortController) {
        this.logUploadAbortController = null
        this.logUploadPhase = null
        this.emit({ type: 'logs.upload.progress', progress: null })
      }
    }
  }

  async cancelLogUpload() {
    if (!this.logUploadAbortController) return false
    if (this.logUploadPhase === 'completing' || this.logUploadPhase === 'completed') throw new Error('诊断包正在服务端完成合并，当前无法取消。')
    this.logUploadAbortController.abort()
    return true
  }

  private trustedCatalogUrl(value: string) {
    const marketUrl = this.distribution?.market_url
    if (!marketUrl) throw new Error('客户端尚未配置插件市场。')
    const url = new URL(value, marketUrl)
    if (url.origin !== new URL(marketUrl).origin || url.username || url.password) {
      throw new Error('Seed Cloud 返回了不受信任的插件资源地址。')
    }
    return url.toString()
  }

  private async privateCatalogIcon(value: string, accessToken: string): Promise<string | undefined> {
    const response = await fetch(this.trustedCatalogUrl(value), {
      headers: { Accept: 'image/*', Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
    })
    if (!response.ok) return undefined
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim()
    if (!contentType || !['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(contentType)) return undefined
    const maximum = 256 * 1024
    if (Number(response.headers.get('content-length') || 0) > maximum || !response.body) return undefined
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let size = 0
    while (true) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.length
      if (size > maximum) {
        await reader.cancel()
        return undefined
      }
      chunks.push(Buffer.from(item.value))
    }
    if (!size) return undefined
    const bytes = Buffer.concat(chunks)
    return `data:${contentType};base64,${bytes.toString('base64')}`
  }

  private async cloudAccessToken(rejectedToken?: string): Promise<string> {
    const session = this.store.cloudSession()
    if (!session) throw new Error('请先登录 MotusAI Cloud 账号。')
    if (rejectedToken && session.accessToken !== rejectedToken) return session.accessToken
    if (!rejectedToken && Date.parse(session.accessExpiresAt) > Date.now() + 30_000) return session.accessToken
    if (this.cloudRefreshPromise) return this.cloudRefreshPromise
    const refresh = this.refreshCloudAccessToken(session)
    this.cloudRefreshPromise = refresh
    try {
      return await refresh
    } finally {
      if (this.cloudRefreshPromise === refresh) this.cloudRefreshPromise = null
    }
  }

  private async refreshCloudAccessToken(session: NonNullable<ReturnType<SeedStore['cloudSession']>>): Promise<string> {
    try {
      const refreshed = await refreshCloudCredential(await this.currentDistribution(), session.refreshToken, session.user)
      if (this.store.cloudSession()?.refreshToken !== session.refreshToken) throw new Error('登录会话已改变。')
      await this.store.setCloudSession(refreshed)
      this.user = refreshed.user
      this.authStatus = { status: 'signed_in' }
      return refreshed.accessToken
    } catch (error) {
      if (cloudSessionWasRejected(error) && this.store.cloudSession()?.refreshToken === session.refreshToken) {
        await this.store.clearCloudSession()
        this.user = undefined
        this.authStatus = { status: 'signed_out' }
        this.entitlementExpiresAt = 0
        await this.applyExpiredEntitlements()
        await this.publishSnapshot()
      }
      throw error
    }
  }

  private async applyExpiredEntitlements() {
    if (Date.now() < this.entitlementExpiresAt) return
    if (!this.authorizedInstalledPluginIds.size && !this.remotePluginCatalog.some((plugin) => plugin.visibility === 'organization')) return
    this.authorizedInstalledPluginIds.clear()
    this.remotePluginCatalog = this.remotePluginCatalog.filter((plugin) => plugin.visibility === 'public')
    for (const [id, plugin] of this.verifiedCatalogPlugins) {
      if (plugin.visibility === 'organization') this.verifiedCatalogPlugins.delete(id)
    }
    await this.reloadPlugins()
    this.configureWorker()
    await this.publishSnapshot()
  }

  private pluginIsAuthorized(pluginId: string): boolean {
    return Date.now() < this.entitlementExpiresAt && this.authorizedInstalledPluginIds.has(pluginId)
  }

  private async refreshInstalledEntitlements() {
    const distribution = await this.currentDistribution()
    if (!distribution.market_url || !this.user) {
      await this.applyExpiredEntitlements()
      return
    }
    const installed = await this.pluginInstaller.listInstalled()
    const endpoint = new URL(distribution.market_url)
    endpoint.pathname = endpoint.pathname.replace(/\/plugins$/, '/entitlements')
    const accessToken = await this.cloudAccessToken()
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ plugin_ids: installed.map((plugin) => plugin.id) }),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`无法确认插件使用权限（${response.status}）。`)
    const result = entitlementResponseSchema.parse(await response.json())
    if (!this.user || this.store.cloudSession()?.accessToken !== accessToken) return
    const runtimeChanged = entitlementRefreshChangesRuntime(
      installed, this.authorizedInstalledPluginIds, result.items, Date.now() >= this.entitlementExpiresAt,
    )
    await this.pluginInstaller.syncEntitlements(result.items)
    this.authorizedInstalledPluginIds.clear()
    for (const item of result.items) if (item.authorized) this.authorizedInstalledPluginIds.add(item.plugin_id)
    this.entitlementExpiresAt = Date.now() + 5 * 60_000
    // A routine renewal must not restart plugins or abort their active Cloud streams.
    if (runtimeChanged) {
      await this.reloadPlugins()
      this.configureWorker()
    }
    await this.publishSnapshot()
  }

  private async handleDistributionEvent(event: SeedDistributionEvent) {
    if (event.dist_id !== buildConfig.distributionId) return
    if (event.type === 'plugin.catalog.changed') {
      this.pluginCatalogRefreshQueue = this.pluginCatalogRefreshQueue
        .catch(() => undefined)
        .then(async () => {
          if (event.revision === this.remotePluginCatalogRevision) return
          await this.refreshPluginCatalog()
        })
        .catch(() => undefined)
      await this.pluginCatalogRefreshQueue
      return
    }
    const targets = process.platform === 'darwin'
      ? [`mac-${process.arch}`, 'mac-universal']
      : process.platform === 'win32'
        ? [`win-${process.arch}`]
        : process.platform === 'linux'
          ? [`linux-${process.arch}`]
          : []
    if (event.channel !== 'stable' || !targets.includes(event.platform)) return
    await this.currentDistribution(true)
    await this.updater.check().catch(() => false)
  }

  private async reconcileDistributionState() {
    await this.currentDistribution(true)
    if (this.user) await this.refreshPluginCatalog()
    await this.updater.check().catch(() => false)
  }

  private async currentDistribution(force = false) {
    const now = Math.floor(Date.now() / 1000)
    if (force || !this.distribution || this.distribution.exp <= now + 30) {
      const discovered = await discoverDistribution()
      const expectedRedirectUri = `${buildConfig.appId}:/oauth/callback`
      if (discovered.auth.redirect_uri !== expectedRedirectUri) {
        throw new Error('登录回调与当前客户端身份不匹配。')
      }
      if (this.distribution && (
        discovered.auth.client_id !== this.distribution.auth.client_id
        || discovered.auth.issuer !== this.distribution.auth.issuer
      )) {
        throw new Error('客户端连接配置已更改，请重新启动应用。')
      }
      this.distribution = discovered
      this.updater.configure(discovered.update_url)
      this.distributionEvents.configure(discovered.events_url)
    }
    return this.distribution
  }

  async openWebsite() {
    await shell.openExternal(officialWebsiteUrl)
  }

  async personalCreditWallet() {
    if (!this.user) throw new Error('请先登录后查看个人积分。')
    return this.creditBilling.personalWallet()
  }

  async personalCreditGrants(cursor?: string) {
    if (!this.user) throw new Error('请先登录后查看赠送记录。')
    return this.creditBilling.personalGrants(cursor)
  }

  async openPersonalWallet() {
    if (!this.user) throw new Error('请先登录后查看个人积分。')
    await shell.openExternal(new URL('/credits', this.seedCloudUrl).toString())
  }

  private async fetchPluginCatalog(search = '', cursor?: string): Promise<SeedCatalogPage> {
    const distribution = await this.currentDistribution()
    if (!distribution.market_url) throw new Error('客户端尚未配置插件市场。')
    const query = new URLSearchParams({
      platform: process.platform,
      architecture: process.arch,
      page_size: '20',
    })
    if (search.trim()) query.set('query', search.trim())
    query.set('client_version', app.getVersion())
    if (cursor) query.set('cursor', cursor)
    const catalogUrl = new URL(distribution.market_url)
    for (const [key, value] of query) catalogUrl.searchParams.set(key, value)
    const accessToken = await this.cloudAccessToken()
    const response = await fetch(catalogUrl, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(`无法读取 Seed Cloud 插件目录（${response.status}）。`)
    const parsed = seedCatalogResponseSchema.parse(body)
    const items = await Promise.all(parsed.items.map(async (plugin) => ({
      ...plugin,
      ...(plugin.iconUrl ? { iconUrl: plugin.visibility === 'organization'
        ? await this.privateCatalogIcon(plugin.iconUrl, accessToken)
        : this.trustedCatalogUrl(plugin.iconUrl) } : {}),
      ...(plugin.iconDarkUrl ? { iconDarkUrl: plugin.visibility === 'organization'
        ? await this.privateCatalogIcon(plugin.iconDarkUrl, accessToken)
        : this.trustedCatalogUrl(plugin.iconDarkUrl) } : {}),
      versions: plugin.versions.map((version) => ({
        ...version,
        downloadUrl: this.trustedCatalogUrl(version.downloadUrl),
      })),
    })))
    for (const plugin of items) this.verifiedCatalogPlugins.set(plugin.id, plugin)
    return { items, ...(parsed.next_cursor ? { nextCursor: parsed.next_cursor } : {}) }
  }

  async refreshPluginCatalog(options: { refreshEntitlements?: boolean } = {}) {
    const items: SeedCatalogPlugin[] = []
    const visited = new Set<string>()
    let cursor: string | undefined
    while (true) {
      const page = await this.fetchPluginCatalog('', cursor)
      items.push(...page.items)
      if (!page.nextCursor) break
      if (visited.has(page.nextCursor)) throw new Error('Seed Cloud 插件目录分页游标重复。')
      visited.add(page.nextCursor)
      cursor = page.nextCursor
    }
    this.verifiedCatalogPlugins.clear()
    for (const plugin of items) this.verifiedCatalogPlugins.set(plugin.id, plugin)
    this.remotePluginCatalog = items
    this.remotePluginCatalogNextCursor = null
    this.remotePluginCatalogRevision = `${Date.now()}`
    if (options.refreshEntitlements !== false) await this.refreshInstalledEntitlements()
    await this.publishSnapshot()
    return this.remotePluginCatalog
  }

  async loadMorePluginCatalog() {
    const cursor = this.remotePluginCatalogNextCursor
    if (!cursor) return this.remotePluginCatalog
    const page = await this.fetchPluginCatalog('', cursor)
    const known = new Set(this.remotePluginCatalog.map((plugin) => plugin.id))
    this.remotePluginCatalog = [...this.remotePluginCatalog, ...page.items.filter((plugin) => !known.has(plugin.id))]
    this.remotePluginCatalogNextCursor = page.nextCursor ?? null
    await this.publishSnapshot()
    return this.remotePluginCatalog
  }

  searchPluginCatalog(query: string, cursor?: string) {
    return this.fetchPluginCatalog(query, cursor)
  }

  async installPlugin(pluginId: string, version: string) {
    let installedSummary = ''
    let installedMetadata: { plugin_id: string; plugin_version: string; plugin_name_en_us: string; plugin_name_zh_hans: string } | undefined
    try {
      const plugin = this.verifiedCatalogPlugins.get(pluginId)
      if (!plugin) throw new Error('插件不在当前已验证的服务端目录中，请刷新后重试。')
      const release = plugin.versions.find((candidate) => candidate.version === version)
      if (!release) throw new Error('所选插件版本不在当前服务端目录中，请刷新后重试。')
      if (!plugin.compatible) throw new Error(plugin.minSeedVersion
        ? `此插件需要 Seed ${plugin.minSeedVersion} 或更高版本，请先更新客户端。`
        : '此插件版本缺少最低 Seed 版本声明，请等待发布新版。')
      if (release.runtimeKind === 'native-host' && plugin.publisherType !== 'official') {
        throw new Error('当前 Seed 只允许安装官方 native-host 插件。')
      }
      const verified = await this.pluginInstaller.downloadAndVerify(plugin, release)
      await this.pluginInstaller.install(verified, { publisherType: plugin.publisherType, visibility: plugin.visibility, source: 'marketplace', enabled: true })
      await this.refreshInstalledEntitlements()
      const installed = this.installedPlugins.find((candidate) => candidate.id === verified.manifest.id)
      const runtime = this.runtimePlugins.find((candidate) => candidate.package_id === verified.manifest.id)
      if (!installed || installed.version !== verified.manifest.version || !installed.enabled || !runtime) {
        throw new Error('插件安装后未能通过本地完整性校验并载入运行时。')
      }
      installedSummary = `已安装 ${installed.name.zh_Hans}（${installed.version}）。`
      installedMetadata = { plugin_id: installed.id, plugin_version: installed.version, plugin_name_en_us: installed.name.en_US, plugin_name_zh_hans: installed.name.zh_Hans }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.store.auditSystem('plugin.install', 'failed', `安装 ${pluginId}@${version} 失败：${message}`, 'control')
      await this.publishSnapshot()
      throw error
    }
    await this.store.auditSystem('plugin.install', 'allowed', installedSummary, undefined, installedMetadata)
    await this.publishSnapshot()
    return true
  }

  async uninstallPlugin(pluginId: string) {
    let uninstalledSummary = ''
    let uninstalledMetadata: { plugin_id: string; plugin_version: string; plugin_name_en_us: string; plugin_name_zh_hans: string } | undefined
    try {
      const plugin = this.installedPlugins.find((candidate) => candidate.id === pluginId)
      if (!plugin) throw new Error('插件尚未安装。')
      this.pluginBrowserAuthorization.cancelPlugin(plugin.id)
      await this.pluginInstaller.uninstall(plugin.id)
      await this.store.removePluginLocalClientAuthorizations(plugin.id)
      this.localClients = await this.store.localClients()
      await this.reloadPlugins()
      await this.pythonEnvironmentService.remove(plugin.id)
      this.configureWorker()
      uninstalledSummary = `已卸载 ${plugin.name.zh_Hans}（${plugin.version}）。`
      uninstalledMetadata = { plugin_id: plugin.id, plugin_version: plugin.version, plugin_name_en_us: plugin.name.en_US, plugin_name_zh_hans: plugin.name.zh_Hans }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.store.auditSystem('plugin.uninstall', 'failed', `卸载 ${pluginId} 失败：${message}`, 'control')
      await this.publishSnapshot()
      throw error
    }
    await this.store.auditSystem('plugin.uninstall', 'allowed', uninstalledSummary, undefined, uninstalledMetadata)
    await this.publishSnapshot()
    return true
  }

  private async reloadPlugins() {
    this.pluginBrowserAuthorization.cancelAll()
    await this.creditBilling.closeAllRelayStreams()
    this.billedRelayStreams.clear()
    await this.pluginInstaller.pruneInactiveVersions()
    const installedPlugins = await this.pluginInstaller.listInstalled()
    const previousVersions = new Map(this.installedPlugins.map((plugin) => [plugin.id, plugin.version]))
    for (const pluginId of this.pluginContributions.keys()) {
      const installed = installedPlugins.find((plugin) => plugin.id === pluginId)
      if (!installed || previousVersions.get(pluginId) !== installed.version) this.pluginContributions.delete(pluginId)
    }
    this.installedPlugins = installedPlugins.map((plugin) => ({
      ...plugin,
      ...(this.pluginContributions.get(plugin.id) || {}),
    }))
    const installedRuntimePlugins = await this.pluginInstaller.listRuntimePlugins()
    this.runtimePlugins = installedRuntimePlugins.filter((plugin) =>
      Date.now() < this.entitlementExpiresAt && this.authorizedInstalledPluginIds.has(plugin.package_id))
    await this.sandboxHost.configure(this.runtimePlugins)
  }

  private async invokePluginBroker(packageId: string, service: string, argumentsValue: Record<string, unknown>): Promise<unknown> {
    if (service === 'seed.management.text') {
      const update = z.object({
        view_id: z.string().min(1).max(100), value_path: z.string().min(1).max(200),
        stream_id: z.string().min(1).max(200), operation: z.enum(['append', 'replace']),
        text: z.string().max(1_048_576), offset: z.number().int().nonnegative().optional(),
      }).strict().parse(Object.fromEntries(Object.entries(argumentsValue).filter(([key]) => key !== 'package_id')))
      if (update.operation === 'append' && update.offset === undefined) throw new Error('增量文本缺少偏移量。')
      const plugin = this.runtimePlugins.find((candidate) => candidate.package_id === packageId)
      const view = this.pluginContributions.get(packageId)?.managementViews.find((candidate) => candidate.id === update.view_id)
      if (!plugin || !view || view.renderer !== 'seed.panel' || !Array.isArray(view.props.blocks) || !view.props.blocks.some((block: unknown) =>
        Boolean(block && typeof block === 'object' && 'type' in block && block.type === 'markdown'
          && 'value_path' in block && block.value_path === update.value_path))) {
        throw new Error('插件只能更新自身已声明的 Markdown 区块。')
      }
      this.emit({ type: 'plugin.management.text', pluginId: packageId, viewId: update.view_id,
        valuePath: update.value_path, streamId: update.stream_id, operation: update.operation,
        text: update.text, offset: update.offset })
      return null
    }
    if (service === 'seed.cloud.relay' || service === 'seed.cloud.models' ||
      ['seed.cloud.relay.stream.start', 'seed.cloud.relay.stream.next', 'seed.cloud.relay.stream.close'].includes(service)) {
      const plugin = this.runtimePlugins.find((candidate) => candidate.package_id === packageId)
      if (!plugin?.permissions.includes('cloud.relay')) {
        throw Object.assign(new Error('插件未声明云转发权限。'), { code: 'broker_permission_denied' })
      }
      if (service === 'seed.cloud.relay.stream.next' || service === 'seed.cloud.relay.stream.close') {
        const streamId = z.string().uuid().parse(argumentsValue.stream_id)
        if (service.endsWith('.next')) {
          const result = await this.creditBilling.nextRelayStream(packageId, streamId)
          if (result.done) {
            const billing = this.billedRelayStreams.get(streamId)
            this.billedRelayStreams.delete(streamId)
            if (billing) await this.recordRelaySettlement(billing.callId, billing.pluginId).catch(() => undefined)
          }
          return result
        }
        this.billedRelayStreams.delete(streamId)
        return this.creditBilling.closeRelayStream(packageId, streamId)
      }
      const input = z.object({
        capability_id: z.string().regex(/^[a-z][a-z0-9._-]*$/),
        method: z.string().regex(/^[a-z][a-z0-9._-]*$/),
        ...(service === 'seed.cloud.relay' || service === 'seed.cloud.relay.stream.start' ? {
          call_id: z.string().uuid().optional(),
          payload: z.record(z.string(), z.unknown()),
        } : {}),
      }).parse(argumentsValue)
      const declared = plugin.capabilities.find((capability) => capability.id === input.capability_id)
        ?.methods.find((method) => method.name === input.method)
      if (!declared || declared.annotations?.['billing.settlement'] !== 'cloud_relay' ||
        typeof declared.annotations?.['billing.relay_template'] !== 'string') {
        throw Object.assign(new Error('云转发能力未在插件中声明。'), { code: 'broker_permission_denied' })
      }
      if (service === 'seed.cloud.models') return this.creditBilling.models({
        plugin_id: packageId, capability_id: input.capability_id, method: input.method,
      })
      const { call_id: callId, payload } = input as typeof input & {
        call_id?: string; payload: Record<string, unknown>
      }
      const body = JSON.stringify(payload)
      if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('云转发请求过大。')
      const relay = service === 'seed.cloud.relay.stream.start'
        ? this.creditBilling.startRelayStream.bind(this.creditBilling)
        : this.creditBilling.relay.bind(this.creditBilling)
      if (callId) return relay({
        call_id: callId, plugin_id: packageId,
        capability_id: input.capability_id, method: input.method, payload,
      })
      const billingModelId = relayBillingModelId(declared.annotations?.['billing.product'], payload)
      const preparation = await this.creditBilling.prepare({
        invocation_id: randomUUID(), plugin_id: packageId, plugin_version: plugin.version,
        capability_id: input.capability_id, method: input.method,
        ...(billingModelId ? { model_id: billingModelId } : {}),
        arguments_sha256: createHash('sha256').update(body).digest('hex'),
      })
      if (!preparation.billable) {
        throw Object.assign(new Error('此云转发能力尚未配置积分价格。'), { code: 'credit_price_unavailable' })
      }
      try {
        const result = await relay({
          call_id: preparation.call_id, plugin_id: packageId,
          capability_id: input.capability_id, method: input.method, payload,
        })
        if (service === 'seed.cloud.relay.stream.start') {
          const streamId = z.string().uuid().parse((result as { stream_id?: unknown }).stream_id)
          this.billedRelayStreams.set(streamId, { callId: preparation.call_id, pluginId: packageId })
        } else {
          await this.recordRelaySettlement(preparation.call_id, packageId).catch(() => undefined)
        }
        return result
      } catch (error) {
        await this.creditBilling.cancel(preparation.call_id).catch(() => undefined)
        throw error
      }
    }
    if (service === 'seed.native.capabilities.list' || service === 'seed.native.capabilities.invoke') {
      if (!this.runtimePlugins.some((plugin) => plugin.package_id === packageId && plugin.runtime_kind === 'native-host')) {
        throw new Error('原生插件能力请求来源无效。')
      }
      if (service === 'seed.native.capabilities.list') return await this.connector.queryNativeCapabilities(packageId)
      return await this.connector.invokeNativeCapability(packageId,
        argumentsValue.invocation as import('@motusai/seed-sdk').SeedPluginCapabilityInvocation,
        Array.isArray(argumentsValue.chain) ? argumentsValue.chain.filter((x): x is string => typeof x === 'string') : [])
    }
    if (service === 'seed.plugin.audit' || service === 'seed.plugin.diagnostic') {
      const plugin = this.runtimePlugins.find((candidate) => candidate.package_id === packageId)
      const handler = this.hostServices.get(service)
      if (!plugin || !handler) throw new Error('插件上报服务不可用。')
      return await handler({ ...argumentsValue, package_id: packageId, plugin_version: plugin.version })
    }
    if (service === 'seed.plugin-authorization') {
      const handler = this.hostServices.get(service)
      if (!handler) throw new Error('插件浏览器授权服务不可用。')
      return await handler({ ...argumentsValue, package_id: packageId })
    }
    if (service === 'seed.plugin-secret') {
      const handler = this.hostServices.get(service)
      if (!handler) throw new Error('插件私密凭据服务不可用。')
      return await handler({ ...argumentsValue, package_id: packageId })
    }
    if (service === 'seed.broker.files.invoke') {
      const method = String(argumentsValue.method || '')
      const request = argumentsValue.request && typeof argumentsValue.request === 'object'
        ? argumentsValue.request as import('@motusai/seed-sdk').SeedInvocation
        : null
      if (!method || !request) throw new Error('文件 Broker 请求无效。')
      return await this.fileBroker.invoke(method, request)
    }
    if (service === 'seed.shell.open-path') {
      const plugin = this.runtimePlugins.find((candidate) => candidate.package_id === packageId)
      if (!plugin?.permissions.includes('shell.open-path')) throw Object.assign(new Error('插件未声明打开路径权限。'), { code: 'broker_permission_denied' })
      const requestedPath = String(argumentsValue.path || '')
      if (!isAbsolute(requestedPath)) throw Object.assign(new Error('只能打开插件私有目录中的绝对路径。'), { code: 'broker_path_denied' })
      const pluginDataPath = await realpath(join(app.getPath('userData'), 'plugin-data', packageId))
      const targetPath = await realpath(requestedPath)
      const boundary = relative(pluginDataPath, targetPath)
      if (boundary === '..' || boundary.startsWith(`..${sep}`) || isAbsolute(boundary)) {
        throw Object.assign(new Error('只能打开当前插件的私有目录。'), { code: 'broker_path_denied' })
      }
      const error = await shell.openPath(targetPath)
      if (error) throw new Error(error)
      return { opened: true }
    }
    if (service === 'seed.process') {
      return await this.sidecarProcessService.invoke(packageId, argumentsValue)
    }
    if (service === 'seed.python') {
      return await this.pythonEnvironmentService.invoke(packageId, argumentsValue)
    }
    if (service === 'seed.audio') {
      const plugin = this.runtimePlugins.find((candidate) => candidate.package_id === packageId)
      if (!plugin?.permissions.includes('device.audio.capture')) throw Object.assign(new Error('插件未声明麦克风采集权限。'), { code: 'broker_permission_denied' })
      return await this.audioService.invoke(argumentsValue, packageId)
    }
    if (service === 'seed.configuration') {
      const plugin = this.runtimePlugins.find((candidate) => candidate.package_id === packageId)
      const configurationId = String(argumentsValue.configuration_id || '')
      const publishedDeclaration = this.pluginContributions.get(packageId)?.configurations.find((candidate) => candidate.id === configurationId)
      const declaration = plugin && brokerPluginConfigurationDeclaration({
        configurationId, published: publishedDeclaration, bootstrap: argumentsValue.declaration,
        runtimeKind: plugin.runtime_kind, permissions: plugin.permissions,
      })
      if (!plugin || !declaration) throw Object.assign(new Error('插件只能读取自身声明的配置。'), { code: 'broker_configuration_denied' })
      if (declaration.secretAccess !== 'owner') throw Object.assign(new Error('该配置的敏感值只能由 Seed Broker 使用。'), { code: 'broker_configuration_denied' })
      const key = pluginConfigurationKey(plugin.package_id, declaration.id)
      return this.store.pluginConfiguration(key) || initialPluginConfiguration(declaration)
    }
    throw new Error(`Seed 不支持 Broker 服务：${service}`)
  }

  private async recordRelaySettlement(callId: string, pluginId: string) {
    const settlement = await this.creditBilling.status(callId)
    if (!settlement.billable || settlement.state !== 'settled' ||
      !isCreditAmount(settlement.charged_amount) || settlement.charged_amount < 0) return
    const plugin = this.runtimePlugins.find((candidate) => candidate.package_id === pluginId)
    this.diagnostics.record({
      level: 'info', source: 'main', event: 'credit.settled', message: 'Cloud relay credit settlement recorded.',
      plugin_id: pluginId, plugin_version: plugin?.version, operation: 'credit.settled',
      details: {
        credit_charged_amount: Number(settlement.charged_amount),
        ...(plugin?.name ? { plugin_name_en_us: plugin.name.en_US, plugin_name_zh_hans: plugin.name.zh_Hans } : {}),
      },
    })
  }

  async stop() {
    if (this.entitlementTimer) clearInterval(this.entitlementTimer)
    this.entitlementTimer = null
    this.pluginBrowserAuthorization.cancelAll()
    this.updater.stop()
    this.distributionEvents.stop()
    this.pendingCloudAuthorization?.reject(new Error('登录已取消。'))
    if (this.pendingCloudAuthorization) clearTimeout(this.pendingCloudAuthorization.timeout)
    this.pendingCloudAuthorization = null
    if (this.mascotResetTimer) clearTimeout(this.mascotResetTimer)
    this.mascotResetTimer = null
    if (this.mascotWorkTimer) clearTimeout(this.mascotWorkTimer)
    this.mascotWorkTimer = null
    this.activeTasks.clear()
    this.activeTaskIds.clear()
    this.taskStartedAt.clear()
    this.taskBatchHadFailure = false
    if (this.powerSaveBlockerId !== null && powerSaveBlocker.isStarted(this.powerSaveBlockerId)) powerSaveBlocker.stop(this.powerSaveBlockerId)
    this.powerSaveBlockerId = null
    await this.nativeHost.stopAll()
    await this.creditBilling.closeAllRelayStreams()
    this.billedRelayStreams.clear()
    await this.connector.stop()
    await this.sidecarProcessService.stop()
    await this.pythonEnvironmentService.stop()
    await this.audioService.destroy()
    this.sandboxHost.destroy()
    await this.store.close()
  }
}
