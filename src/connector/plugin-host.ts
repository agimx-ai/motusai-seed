import Ajv, { type ValidateFunction } from 'ajv'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalSeedCapabilityApprovalPayload, seedNetworkPermissions, type SeedCapabilityHandler, type SeedConfigurationOption, type SeedConfigurationOptionBadge, type SeedConnectionDescriptor, type SeedConnectionHandle, type SeedConnectionSnapshot, type SeedConnectionStatus, type SeedInvocationPrincipal, type SeedLocalApiRegistration, type SeedPlugin, type SeedPluginCapabilityInvocation, type SeedPluginContext } from '@motusai/seed-sdk'
import type { CapsInvokeContext, CapsRuntimeService } from './caps'
import { CapsContext, CapsRegistry } from './caps'
import type { CapsPluginDescriptor, NativePluginRuntimeSnapshot, PluginConfigurationOption, PluginConfigurationOptionBadge, SeedPluginRuntimeDefinition } from '../shared/contracts'
import { resolveSeedLocalizedText, seedPluginConfigurationSchema, seedPluginManagementViewSchema, type SeedPluginConfiguration, type SeedPluginManagementView } from '../shared/plugin-manifest'
import type { GlobalTaskActivityObserver } from './global-task-activity-observer'
import type { DiagnosticTraceContext, HostDiagnosticEvent } from '../shared/diagnostic-trace'
import { isCreditAmount } from '../shared/credit-amount'

type MethodValidators = { input?: ValidateFunction; output?: ValidateFunction }
type NativePluginRuntime = SeedPlugin
type ConfigurationOptionsResolver = (values: Readonly<Record<string, string>>) => Promise<readonly SeedConfigurationOption[]> | readonly SeedConfigurationOption[]
type PluginContributions = {
  configurations: SeedPluginConfiguration[]
  managementViews: SeedPluginManagementView[]
}
type InvocationTaskScope = {
  activity: { requestId: string; taskId: string; operation: string }
  observedLocally: boolean
  pending: number
  handlerReturned: boolean
  terminal: boolean
  failed: boolean
}
type ConnectionRegistration = {
  snapshot: SeedConnectionSnapshot
  disposed: boolean
  reconnect?: () => void | Promise<void>
  dispose(): Promise<void>
}

const localApiMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', '*'])
const networkPermissions = new Set<string>(seedNetworkPermissions)
const connectionStates = new Set(['idle', 'connecting', 'connected', 'reconnecting', 'disconnecting', 'disconnected', 'failed'])

function localApiRegistration(plugin: SeedPluginRuntimeDefinition, registration: SeedLocalApiRegistration): SeedLocalApiRegistration {
  if (typeof registration.handle !== 'function') throw new Error(`原生插件 ${plugin.package_id} 的本地 HTTP API 缺少处理器。`)
  const origins = [...new Set(registration.allowed_origins)]
  if (!origins.length || origins.length > 16 || origins.some((origin) => (
    typeof origin !== 'string' || origin.length > 256 || origin.includes('*') || !/^[a-z][a-z0-9+.-]*:\/\/[^\s/]+$/i.test(origin)
  ))) throw new Error(`原生插件 ${plugin.package_id} 声明了无效的本地 HTTP Origin。`)
  const clientIds = [...new Set(registration.allowed_client_ids)]
  if (!clientIds.length || clientIds.length > 16 || clientIds.some((id) => !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(id))) {
    throw new Error(`原生插件 ${plugin.package_id} 声明了无效的本地客户端 ID。`)
  }
  if (!registration.routes.length || registration.routes.length > 64) {
    throw new Error(`原生插件 ${plugin.package_id} 的本地 HTTP 路由数量无效。`)
  }
  const routes = registration.routes.map((route) => {
    const method = route.method.toUpperCase()
    const segments = route.path.split('/').filter(Boolean)
    const validPath = route.path.startsWith('/') && route.path !== '/'
      && route.path !== '/v1' && !route.path.startsWith('/v1/')
      && !route.path.includes('?') && !route.path.includes('#')
      && segments.every((segment, index) => (
        /^[a-zA-Z0-9._-]+$/.test(segment)
        || /^:[a-zA-Z][a-zA-Z0-9_]*$/.test(segment)
        || (segment === '*' && index === segments.length - 1)
      ))
    if (!localApiMethods.has(method) || !validPath || route.path === '/clients/authorize'
      || (route.activity !== undefined && !['foreground', 'background', 'stream'].includes(route.activity))) {
      throw new Error(`原生插件 ${plugin.package_id} 声明了无效或保留的本地 HTTP 路由：${route.method} ${route.path}`)
    }
    return { method, path: route.path, ...(route.public ? { public: true } : {}),
      ...(route.activity ? { activity: route.activity } : {}) }
  })
  const routeKeys = new Set(routes.map((route) => `${route.method}\0${route.path}`))
  if (routeKeys.size !== routes.length) throw new Error(`原生插件 ${plugin.package_id} 重复声明了本地 HTTP 路由。`)
  return { allowed_origins: origins, allowed_client_ids: clientIds, routes, handle: registration.handle }
}

function nativeRuntime(value: unknown): NativePluginRuntime | null {
  if (!value || typeof value !== 'object') return null
  const module = value as { default?: unknown; apply?: unknown; inject?: unknown }
  const candidate = module.default && (typeof module.default === 'object' || typeof module.default === 'function')
    ? module.default as { apply?: unknown; inject?: unknown }
    : module
  if (typeof candidate === 'function') return { apply: candidate as NativePluginRuntime['apply'] }
  if (typeof candidate.apply !== 'function') return null
  return { apply: candidate.apply.bind(candidate) as NativePluginRuntime['apply'], ...(candidate.inject ? { inject: candidate.inject as NativePluginRuntime['inject'] } : {}) }
}

function validatorError(validator: ValidateFunction) {
  return (validator.errors || [])
    .slice(0, 5)
    .map((error) => `${error.instancePath || '/'} ${error.message || '不符合 schema'}`)
    .join('；')
}

function pluginFingerprint(plugin: SeedPluginRuntimeDefinition) {
  return JSON.stringify(plugin)
}

function invocationTaskId(context: CapsInvokeContext) {
  if (!context.context || typeof context.context !== 'object' || Array.isArray(context.context)) return context.request_id
  const taskContext = context.context as Record<string, unknown>
  const taskId = String(taskContext.task_id || taskContext.run_id || '').trim()
  return taskId || context.request_id
}

function providedCapabilities(plugin: SeedPluginRuntimeDefinition | undefined) {
  return new Set(plugin?.capabilities.map((capability) => capability.id) || [])
}

function consumptionMatches(
  declaration: SeedPluginRuntimeDefinition['consumes'][number],
  capability: CapsPluginDescriptor,
  method: CapsPluginDescriptor['methods'][number],
) {
  if ('capability' in declaration) {
    return declaration.capability === capability.id && declaration.methods.includes(method.name)
  }
  return method.annotations?.[declaration.match.method_annotation] === declaration.match.equals
}

function canConsume(
  consumer: SeedPluginRuntimeDefinition,
  capability: CapsPluginDescriptor,
  method: CapsPluginDescriptor['methods'][number],
) {
  return consumer.consumes.some((declaration) => consumptionMatches(declaration, capability, method))
}

function isPluginConsumable(capability: CapsPluginDescriptor) {
  return capability.exposure !== 'local'
}

function isMethodAvailableOnThisPlatform(method: CapsPluginDescriptor['methods'][number]) {
  return !method.platforms || method.platforms.some((platform) => platform === process.platform)
}

function dependsOnChangedCapability(
  consumer: SeedPluginRuntimeDefinition,
  capabilityId: string,
  providers: SeedPluginRuntimeDefinition[],
) {
  const capabilities = providers.flatMap((provider) => provider.package_id === consumer.package_id
    ? []
    : provider.capabilities.filter((capability) => capability.id === capabilityId && isPluginConsumable(capability)))
  if (!capabilities.length) return false
  if (consumer.consumes.some((declaration) => 'capability' in declaration && declaration.capability === capabilityId)) return true
  return capabilities.some((capability) => capability.methods.some((method) => canConsume(consumer, capability, method)))
}

function pluginError(error: unknown, capability: CapsPluginDescriptor, locale: string) {
  const source = error instanceof Error ? error : new Error(String(error))
  const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? String((error as { code: string }).code)
    : 'plugin_invoke_error'
  const params = error && typeof error === 'object' && (error as { params?: unknown }).params
    && typeof (error as { params?: unknown }).params === 'object'
    ? (error as { params: Record<string, unknown> }).params
    : {}
  const localized = capability.errors?.[code]
  if (!localized) return source
  const template = resolveSeedLocalizedText(localized, locale, source.message)
  const message = template.replace(/\{([a-z][a-z0-9_.-]*)\}/g, (placeholder, key: string) => {
    const value = params[key]
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : placeholder
  })
  return Object.assign(new Error(message), {
    code,
    params,
    cause: source,
    ...(source.message && source.message !== message ? { detail: source.message } : {}),
  })
}

/** Protocol router plus package-scoped Cordis runtime contribution host. */
export class SeedPluginHost {
  private plugins: SeedPluginRuntimeDefinition[] = []
  private readonly ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false })
  private readonly validators = new Map<string, MethodValidators>()
  private readonly nativeRegistries = new Map<string, CapsRegistry>()
  private readonly nativeCapabilities = new Map<string, Map<string, SeedCapabilityHandler>>()
  private readonly configurations = new Map<string, Map<string, SeedPluginConfiguration>>()
  private readonly configurationOptionsResolvers = new Map<string, Map<string, ConfigurationOptionsResolver>>()
  private readonly managementViews = new Map<string, Map<string, SeedPluginManagementView>>()
  private readonly localApis = new Map<string, SeedLocalApiRegistration>()
  private readonly deferredContributionPackages = new Set<string>()
  private readonly invocationChain = new AsyncLocalStorage<string[]>()
  private readonly diagnosticTrace = new AsyncLocalStorage<DiagnosticTraceContext>()
  private readonly invocationTasks = new AsyncLocalStorage<InvocationTaskScope>()
  private readonly pluginTaskControllers = new Map<string, Set<AbortController>>()
  private readonly pluginConnections = new Map<string, Map<string, ConnectionRegistration>>()
  private readonly remoteSnapshots = new Map<string, NativePluginRuntimeSnapshot>()
  private remoteConfigurationFingerprint = ''

  constructor(
    private readonly runtime: CapsRuntimeService,
    private readonly taskActivityObserver?: GlobalTaskActivityObserver,
    private readonly contributionsChanged?: (packageId: string, contributions: PluginContributions) => void,
    private readonly nativeExecution: 'local' | 'remote' = 'local',
    private readonly runtimeChanged?: (packageId: string, snapshot: NativePluginRuntimeSnapshot) => void,
    private readonly cloudBilling = false,
    private readonly hostDiagnostic?: (event: HostDiagnosticEvent) => void,
  ) {}

  activeDiagnosticTrace() { return this.diagnosticTrace.getStore() }

  async withDiagnosticTrace<T>(trace: DiagnosticTraceContext | undefined, work: () => Promise<T> | T): Promise<T> {
    return trace ? await this.diagnosticTrace.run(trace, work) : await work()
  }

  private emitHostDiagnostic(event: HostDiagnosticEvent) {
    try { this.hostDiagnostic?.(event) } catch { /* Diagnostics cannot interrupt plugin execution. */ }
  }

  private finishInvocationScope(scope: InvocationTaskScope) {
    if (scope.terminal || !scope.handlerReturned || scope.pending > 0) return
    scope.terminal = true
    if (scope.observedLocally) this.taskActivityObserver?.observe(scope.activity, scope.failed ? 'failed' : 'completed')
  }

  private publishContributions(packageId: string) {
    if (this.deferredContributionPackages.has(packageId)) return
    this.contributionsChanged?.(packageId, {
      configurations: [...(this.configurations.get(packageId)?.values() || [])],
      managementViews: [...(this.managementViews.get(packageId)?.values() || [])],
    })
    this.publishRuntime(packageId)
  }

  private publishRuntime(packageId: string) {
    if (this.nativeExecution === 'local') this.runtimeChanged?.(packageId, this.runtimeSnapshot(packageId))
  }

  runtimeSnapshot(packageId: string): NativePluginRuntimeSnapshot {
    const localApi = this.localApis.get(packageId)
    return {
      capabilities: [...(this.nativeCapabilities.get(packageId)?.keys() || [])],
      configurations: [...(this.configurations.get(packageId)?.values() || [])],
      managementViews: [...(this.managementViews.get(packageId)?.values() || [])],
      ...(localApi ? { localApi: {
        allowed_origins: [...localApi.allowed_origins], allowed_client_ids: [...localApi.allowed_client_ids],
        routes: [...localApi.routes],
      } } : {}),
      connections: this.connectionSnapshots(packageId),
    }
  }

  applyRemoteSnapshot(packageId: string, snapshot: NativePluginRuntimeSnapshot | null) {
    if (this.nativeExecution !== 'remote') throw new Error('Only the Connector can mount remote plugin state.')
    if (!snapshot) {
      this.remoteSnapshots.delete(packageId)
      this.nativeCapabilities.delete(packageId)
      this.configurations.delete(packageId)
      this.managementViews.delete(packageId)
      this.localApis.delete(packageId)
      this.publishContributions(packageId)
      return
    }
    const plugin = this.plugins.find((candidate) => candidate.package_id === packageId)
    if (!plugin || plugin.runtime_kind !== 'native-host') return
    const declaredCapabilities = new Set(plugin.capabilities.map((capability) => capability.id))
    if (snapshot.capabilities.some((id) => !declaredCapabilities.has(id))) throw new Error(`插件 ${packageId} 注册了未声明能力。`)
    this.remoteSnapshots.set(packageId, snapshot)
    this.nativeCapabilities.set(packageId, new Map(snapshot.capabilities.map((id) => [id, {
      invoke: async (method, context) => {
        if (context.signal?.aborted) throw Object.assign(new Error('插件调用已取消。'), { code: 'invocation_cancelled' })
        const cancel = () => { void this.runtime.invoke_host('seed.native.cancel', {
          package_id: packageId, request_id: context.request_id,
        }).catch(() => undefined) }
        context.signal?.addEventListener('abort', cancel, { once: true })
        try {
          return await this.runtime.invoke_host('seed.native.invoke', {
            package_id: packageId, capability: id, method,
            invocation: { ...context, signal: undefined }, chain: this.invocationChain.getStore() || [],
            trace: this.activeDiagnosticTrace(),
          })
        } finally { context.signal?.removeEventListener('abort', cancel) }
      },
    }])))
    if (!Array.isArray(snapshot.configurations) || !Array.isArray(snapshot.managementViews)
      || snapshot.configurations.length > 64 || snapshot.managementViews.length > 16
      || snapshot.configurations.some((item) => !item || typeof item.id !== 'string')
      || snapshot.managementViews.some((item) => !item || typeof item.id !== 'string')) {
      throw new Error(`插件 ${packageId} 返回了无效的运行时贡献。`)
    }
    // Registration was parsed in the native process; these are the normalized output shapes.
    this.configurations.set(packageId, new Map(snapshot.configurations.map((item) => [item.id, item])))
    this.managementViews.set(packageId, new Map(snapshot.managementViews.map((item) => [item.id, item])))
    if (snapshot.localApi) {
      const registration = localApiRegistration(plugin, {
        ...snapshot.localApi,
        handle: async (request, client) => {
          const body = request.method === 'GET' || request.method === 'HEAD'
            ? undefined : new Uint8Array(await request.arrayBuffer())
          const result = await this.runtime.invoke_host('seed.native.local-api', {
            package_id: packageId, url: request.url, method: request.method,
            headers: [...request.headers.entries()], body, client, trace: this.activeDiagnosticTrace(),
          }) as { status: number; headers: Array<[string, string]>; stream_id: string | null }
          const streamId = result.stream_id
          if (!streamId) return new Response(null, { status: result.status, headers: result.headers })
          let closed = false
          let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
          const abort = () => {
            if (!closed) streamController?.error(request.signal.reason)
            close()
          }
          const close = () => {
            if (closed) return
            closed = true
            request.signal.removeEventListener('abort', abort)
            void this.runtime.invoke_host('seed.native.local-api.close', {
              package_id: packageId, stream_id: streamId,
            }).catch(() => undefined)
          }
          const stream = new ReadableStream<Uint8Array>({
            start: (controller) => {
              streamController = controller
              if (request.signal.aborted) { controller.error(request.signal.reason); close() }
              else request.signal.addEventListener('abort', abort, { once: true })
            },
            pull: async (controller) => {
              if (closed) return
              try {
                const next = await this.runtime.invoke_host('seed.native.local-api.read', {
                  package_id: packageId, stream_id: streamId,
                }) as { done: boolean; chunk?: Uint8Array }
                if (closed) return
                if (next.done) { controller.close(); close(); return }
                if (!next.chunk) throw new Error('Plugin response stream returned no chunk.')
                controller.enqueue(next.chunk)
              } catch (error) { if (!closed) { controller.error(error); close() } }
            },
            cancel: close,
          })
          return new Response(stream, { status: result.status, headers: result.headers })
        },
      })
      this.localApis.set(packageId, registration)
    } else this.localApis.delete(packageId)
    this.publishContributions(packageId)
  }

  async start(plugins: SeedPluginRuntimeDefinition[]) {
    const mcpNames = new Set<string>()
    for (const plugin of plugins) for (const capability of plugin.capabilities) for (const method of capability.methods) {
      if (!isMethodAvailableOnThisPlatform(method) || method.annotations?.['mcp.tool'] !== true) continue
      const name = method.annotations['mcp.tool_name'] ?? method.name
      if (typeof name !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(name) || mcpNames.has(name)) {
        throw new Error(`MCP 工具名称无效或重复：${String(name)}`)
      }
      mcpNames.add(name)
    }
    const configuration = this.runtime.configuration()
    const remoteConfigurationFingerprint = this.nativeExecution === 'remote' ? JSON.stringify({
      locale: configuration?.locale, pluginDataRoot: configuration?.pluginDataRoot,
    }) : ''
    const remoteConfigurationChanged = this.nativeExecution === 'remote'
      && this.remoteConfigurationFingerprint !== remoteConfigurationFingerprint
    const packageIds = new Set<string>()
    for (const plugin of plugins) {
      if (packageIds.has(plugin.package_id)) throw Object.assign(
        new Error(`插件 ID 必须全局唯一：${plugin.package_id}`),
        { code: 'duplicate_plugin_id' },
      )
      packageIds.add(plugin.package_id)
    }
    const previousPlugins = new Map(this.plugins.map((plugin) => [plugin.package_id, plugin]))
    const nextPlugins = new Map(plugins.map((plugin) => [plugin.package_id, plugin]))
    const dependencyProviders = [...previousPlugins.values(), ...nextPlugins.values()]
    const changedCapabilities = new Set<string>()
    for (const packageId of new Set([...previousPlugins.keys(), ...nextPlugins.keys()])) {
      const previous = previousPlugins.get(packageId)
      const next = nextPlugins.get(packageId)
      if (previous && next && pluginFingerprint(previous) === pluginFingerprint(next)) continue
      for (const capability of providedCapabilities(previous)) changedCapabilities.add(capability)
      for (const capability of providedCapabilities(next)) changedCapabilities.add(capability)
    }
    for (const packageId of new Set([...this.nativeRegistries.keys(), ...this.remoteSnapshots.keys()])) {
      const previous = previousPlugins.get(packageId)
      const next = nextPlugins.get(packageId)
      const unchanged = Boolean(previous && next && pluginFingerprint(previous) === pluginFingerprint(next)
        && !remoteConfigurationChanged)
      const dependencyChanged = Boolean(next && [...changedCapabilities]
        .some((capabilityId) => dependsOnChangedCapability(next, capabilityId, dependencyProviders)))
      if (unchanged && !dependencyChanged) continue
      if (next) this.deferredContributionPackages.add(packageId)
      const registry = this.nativeRegistries.get(packageId)
      try { await registry?.clear() } catch { /* Best-effort cleanup before reconfiguration. */ }
      if (this.remoteSnapshots.has(packageId)) {
        await this.runtime.invoke_host('seed.native.stop', { package_id: packageId })
        this.remoteSnapshots.delete(packageId)
      }
      this.nativeRegistries.delete(packageId)
      this.nativeCapabilities.delete(packageId)
      this.configurations.delete(packageId)
      this.configurationOptionsResolvers.delete(packageId)
      this.managementViews.delete(packageId)
      this.localApis.delete(packageId)
      this.pluginConnections.delete(packageId)
      if (!next) this.publishContributions(packageId)
    }
    this.plugins = []
    this.validators.clear()
    const failures: Array<{ packageId: string; message: string }> = []
    for (const plugin of plugins.filter((candidate) => candidate.runtime_kind === 'sandboxed-web' || candidate.runtime_kind === 'native-host')) {
      const pluginCapabilityIds = new Set<string>()
      const pluginValidators = new Map<string, MethodValidators>()
      let loadedRegistry: CapsRegistry | null = null
      try {
        for (const capability of plugin.capabilities) {
          if (pluginCapabilityIds.has(capability.id)) throw new Error(`插件 ${plugin.package_id} 声明了重复能力：${capability.id}`)
          pluginCapabilityIds.add(capability.id)
          for (const method of capability.methods) {
            const validators: MethodValidators = {}
            if (method.inputSchema) validators.input = this.ajv.compile(method.inputSchema)
            if (method.outputSchema) validators.output = this.ajv.compile(method.outputSchema)
            pluginValidators.set(`${plugin.package_id}\0${capability.id}\0${method.name}`, validators)
          }
        }
        if (plugin.runtime_kind === 'native-host') {
          if (plugin.publisher_type !== 'official') throw new Error(`当前 Seed 只允许运行官方 native-host 插件：${plugin.package_id}`)
          if (this.nativeExecution === 'remote') {
            const preserved = this.remoteSnapshots.get(plugin.package_id)
            const snapshot = preserved || await this.runtime.invoke_host('seed.native.start', {
              package_id: plugin.package_id, plugin,
              configuration: this.runtime.configuration(),
            }) as NativePluginRuntimeSnapshot
            // The plugin is added to the routing table before its remote registrations are mounted.
            this.plugins.push(plugin)
            for (const [key, validators] of pluginValidators) this.validators.set(key, validators)
            this.applyRemoteSnapshot(plugin.package_id, snapshot)
            if (this.deferredContributionPackages.delete(plugin.package_id)) {
              this.publishContributions(plugin.package_id)
            }
            continue
          }
          const preserved = this.nativeRegistries.get(plugin.package_id)
          if (preserved) {
            loadedRegistry = preserved
          } else {
            const url = pathToFileURL(plugin.entry_path)
            url.searchParams.set('plugin', `${plugin.package_id}@${plugin.version}`)
            const loaded = nativeRuntime(await import(url.href))
            if (!loaded) throw new Error(`原生插件 ${plugin.package_id} 没有导出 apply(ctx)。`)
            const registry = new CapsRegistry()
            registry.register(plugin.package_id, {
              name: `seed-plugin:${plugin.package_id}`,
              inject: [...(loaded.inject?.required || [])],
              apply: async (cordisContext) => {
                const configuration = this.runtime.configuration()
                if (!configuration) throw new Error(`原生插件 ${plugin.package_id} 缺少 Seed 运行配置。`)
                const dataPath = join(configuration.pluginDataRoot, plugin.package_id)
                await mkdir(dataPath, { recursive: true })
                await loaded.apply(this.pluginContext(plugin, registry.context.child(cordisContext), dataPath))
              },
            })
            loadedRegistry = registry
            await registry.start()
          }
        }
      } catch (error) {
        await Promise.resolve(this.runtime.invoke_host('seed.plugin.diagnostic', {
          package_id: plugin.package_id, plugin_version: plugin.version,
          entry: { level: 'error', event: 'plugin.start.failed', message: error instanceof Error ? error.message : String(error),
            ...(error instanceof Error ? { error_name: error.name, error_stack: error.stack } : {}) },
        })).catch(() => undefined)
        try { await loadedRegistry?.clear() } catch { /* Best-effort cleanup after startup failure. */ }
        this.nativeRegistries.delete(plugin.package_id)
        this.nativeCapabilities.delete(plugin.package_id)
        this.configurations.delete(plugin.package_id)
        this.configurationOptionsResolvers.delete(plugin.package_id)
        this.managementViews.delete(plugin.package_id)
        this.localApis.delete(plugin.package_id)
        this.pluginConnections.delete(plugin.package_id)
        this.remoteSnapshots.delete(plugin.package_id)
        this.plugins = this.plugins.filter((candidate) => candidate.package_id !== plugin.package_id)
        if (this.nativeExecution === 'remote' && plugin.runtime_kind === 'native-host') {
          this.plugins.push(plugin)
          for (const [key, validators] of pluginValidators) this.validators.set(key, validators)
        }
        this.deferredContributionPackages.delete(plugin.package_id)
        this.publishContributions(plugin.package_id)
        failures.push({ packageId: plugin.package_id, message: error instanceof Error ? error.message : String(error) })
        continue
      }
      this.plugins.push(plugin)
      for (const [key, validators] of pluginValidators) this.validators.set(key, validators)
      if (loadedRegistry && !this.nativeRegistries.has(plugin.package_id)) this.nativeRegistries.set(plugin.package_id, loadedRegistry)
      if (this.deferredContributionPackages.delete(plugin.package_id)) this.publishContributions(plugin.package_id)
    }
    this.remoteConfigurationFingerprint = remoteConfigurationFingerprint
    return failures
  }

  private pluginContext(plugin: SeedPluginRuntimeDefinition, base: CapsContext, dataPath: string): SeedPluginContext {
    const invokeRuntimeHost = async (service: string, argumentsValue: Record<string, unknown>) => await this.runtime.invoke_host(service, {
      ...argumentsValue,
      package_id: plugin.package_id,
      ...(['seed.plugin.audit', 'seed.plugin.diagnostic'].includes(service)
        ? { plugin_version: plugin.version, trace: this.activeDiagnosticTrace() } : {}),
    })
    const invokeHost = async (service: string, argumentsValue: Record<string, unknown>) => {
      if (service === 'seed.plugin.invoke' || service.startsWith('seed.plugin-capability.')) {
        throw new Error(`原生插件 ${plugin.package_id} 不能直接调用 Seed 内部能力代理服务。`)
      }
      if (service === 'seed.configuration') {
        throw new Error(`原生插件 ${plugin.package_id} 必须通过已注册的配置接口读取设置。`)
      }
      if (service.startsWith('seed.local-client.')) {
        throw new Error(`原生插件 ${plugin.package_id} 不能直接调用 Seed 内部客户端授权服务。`)
      }
      return await invokeRuntimeHost(service, argumentsValue)
    }
    const pendingAuthorizations = new Set<string>()
    const configurationSources = new Map<string, Record<string, unknown>>()
    base.effect(() => async () => {
      await Promise.allSettled([...pendingAuthorizations].map((requestId) => invokeHost('seed.plugin-authorization', {
        operation: 'cancel', request_id: requestId,
      })))
    }, 'plugin-browser-authorization')
    const registerCapability = (capabilityId: string, handler: SeedCapabilityHandler) => {
      if (!plugin.capabilities.some((capability) => capability.id === capabilityId)) {
        throw new Error(`插件 ${plugin.package_id} 注册了未在协议清单声明的能力：${capabilityId}`)
      }
      if (!handler || typeof handler.invoke !== 'function') throw new Error(`能力 ${capabilityId} 缺少 invoke() 处理器。`)
      const handlers = this.nativeCapabilities.get(plugin.package_id) || new Map<string, SeedCapabilityHandler>()
      if (handlers.has(capabilityId)) throw new Error(`插件 ${plugin.package_id} 重复注册能力：${capabilityId}`)
      handlers.set(capabilityId, handler)
      this.nativeCapabilities.set(plugin.package_id, handlers)
      this.publishRuntime(plugin.package_id)
      return () => {
        if (handlers.get(capabilityId) === handler) handlers.delete(capabilityId)
        if (!handlers.size) this.nativeCapabilities.delete(plugin.package_id)
        this.publishRuntime(plugin.package_id)
      }
    }
    const registerConfiguration = (raw: Record<string, unknown>) => {
      const declaration = seedPluginConfigurationSchema.parse(raw)
      if (declaration.permission && !plugin.permissions.includes(declaration.permission)) {
        throw new Error(`插件配置所需权限未声明：${declaration.permission}`)
      }
      const declarations = this.configurations.get(plugin.package_id) || new Map<string, SeedPluginConfiguration>()
      if (declarations.has(declaration.id)) throw new Error(`插件 ${plugin.package_id} 重复注册配置：${declaration.id}`)
      declarations.set(declaration.id, declaration)
      configurationSources.set(declaration.id, raw)
      this.configurations.set(plugin.package_id, declarations)
      this.publishContributions(plugin.package_id)
      return () => {
        if (declarations.get(declaration.id) === declaration) declarations.delete(declaration.id)
        configurationSources.delete(declaration.id)
        if (!declarations.size) this.configurations.delete(plugin.package_id)
        this.publishContributions(plugin.package_id)
      }
    }
    const registerOptionsResolver = (configurationId: string, fieldKey: string, resolver: ConfigurationOptionsResolver) => {
      const declaration = this.configurations.get(plugin.package_id)?.get(configurationId)
      const fields = declaration
        ? [...declaration.profiles.fields, ...declaration.fields]
        : []
      const field = fields.find((candidate) => candidate.key === fieldKey)
      if (!declaration || !field?.dynamicOptions) {
        throw new Error(`插件 ${plugin.package_id} 注册了未声明的动态配置选项：${configurationId}.${fieldKey}`)
      }
      if (typeof resolver !== 'function') throw new Error(`动态配置选项 ${configurationId}.${fieldKey} 缺少解析器。`)
      const key = `${configurationId}\0${fieldKey}`
      const resolvers = this.configurationOptionsResolvers.get(plugin.package_id) || new Map<string, ConfigurationOptionsResolver>()
      if (resolvers.has(key)) throw new Error(`插件 ${plugin.package_id} 重复注册动态配置选项：${configurationId}.${fieldKey}`)
      resolvers.set(key, resolver)
      this.configurationOptionsResolvers.set(plugin.package_id, resolvers)
      return () => {
        if (resolvers.get(key) === resolver) resolvers.delete(key)
        if (!resolvers.size) this.configurationOptionsResolvers.delete(plugin.package_id)
      }
    }
    const registerManagementView = (raw: Record<string, unknown>) => {
      const view = seedPluginManagementViewSchema.parse(raw)
      const references = [...(view.source ? [{ ...view.source, readOnly: true }] : []), ...view.actions.map((action) => ({ ...action.target, readOnly: false }))]
      for (const reference of references) {
        const declared = plugin.capabilities.find((capability) => capability.id === reference.capability)
          ?.methods.find((method) => method.name === reference.method)
        if (!declared || (reference.readOnly && declared.risk !== 'read')) {
          throw new Error(`插件管理视图 ${view.id} 引用了无效的本插件能力方法：${reference.capability}.${reference.method}`)
        }
      }
      const views = this.managementViews.get(plugin.package_id) || new Map<string, SeedPluginManagementView>()
      if (views.has(view.id) || views.size >= 16) throw new Error(`插件 ${plugin.package_id} 的管理视图重复或过多：${view.id}`)
      views.set(view.id, view)
      this.managementViews.set(plugin.package_id, views)
      this.publishContributions(plugin.package_id)
      return () => {
        if (views.get(view.id) === view) views.delete(view.id)
        if (!views.size) this.managementViews.delete(plugin.package_id)
        this.publishContributions(plugin.package_id)
      }
    }
    const registerLocalApi = (registration: SeedLocalApiRegistration) => {
      if (!plugin.permissions.includes('local.http-api')) throw new Error(`原生插件 ${plugin.package_id} 未声明本地 HTTP API 权限。`)
      if (this.localApis.has(plugin.package_id)) throw new Error(`原生插件 ${plugin.package_id} 重复注册了本地 HTTP API。`)
      const validated = localApiRegistration(plugin, registration)
      this.localApis.set(plugin.package_id, validated)
      this.publishRuntime(plugin.package_id)
      return () => { if (this.localApis.get(plugin.package_id) === validated) this.localApis.delete(plugin.package_id); this.publishRuntime(plugin.package_id) }
    }
    const configuration = this.runtime.configuration()
    const taskControllers = this.pluginTaskControllers.get(plugin.package_id) || new Set<AbortController>()
    this.pluginTaskControllers.set(plugin.package_id, taskControllers)
    base.effect(() => () => {
      for (const controller of taskControllers) controller.abort(new Error('Plugin stopped.'))
      taskControllers.clear()
      if (this.pluginTaskControllers.get(plugin.package_id) === taskControllers) this.pluginTaskControllers.delete(plugin.package_id)
    }, 'seed.plugin.tasks')
    const startTask = (input: { id?: string; label?: string; request_id?: string; run_id?: string }) => {
      const controller = new AbortController()
      taskControllers.add(controller)
      const scope = this.invocationTasks.getStore()
      if (scope) scope.pending += 1
      const observesActivity = this.activeDiagnosticTrace()?.activity_visibility !== 'technical'
      const standaloneActivity = scope || !observesActivity ? undefined : {
        requestId: input.request_id || input.id || randomUUID(),
        taskId: input.id || input.run_id || input.request_id || randomUUID(),
        operation: input.label || `${plugin.package_id}.background`,
      }
      if (standaloneActivity) this.taskActivityObserver?.observe(standaloneActivity, 'started')
      let settled = false
      const settle = (failed: boolean) => {
        if (settled) return
        settled = true
        taskControllers.delete(controller)
        if (scope) {
          scope.pending -= 1
          scope.failed ||= failed
          this.finishInvocationScope(scope)
        } else if (standaloneActivity) {
          this.taskActivityObserver?.observe(standaloneActivity, failed ? 'failed' : 'completed')
        }
      }
      controller.signal.addEventListener('abort', () => settle(true), { once: true })
      return {
        id: standaloneActivity?.taskId || input.id || scope?.activity.taskId || randomUUID(),
        signal: controller.signal,
        finish: () => settle(false),
        fail: (error?: unknown) => {
          settle(true)
          if (error !== undefined) void invokeRuntimeHost('seed.plugin.diagnostic', { entry: {
            level: 'error', event: 'task.failed', message: error instanceof Error ? error.message : String(error),
            ...(error instanceof Error ? { error_name: error.name, error_stack: error.stack } : {}),
            operation: input.id || input.label || 'unnamed', request_id: input.request_id,
          } }).catch(() => undefined)
        },
      }
    }
    const registerConnection = (descriptor: SeedConnectionDescriptor): SeedConnectionHandle => {
      if (!networkPermissions.has(descriptor?.permission)) {
        throw new Error(`插件 ${plugin.package_id} 声明了无效的网络连接权限。`)
      }
      if (!plugin.permissions.includes(descriptor.permission)) {
        throw new Error(`插件 ${plugin.package_id} 未声明连接使用的权限：${descriptor.permission}`)
      }
      const id = descriptor?.id?.trim()
      const transport = descriptor?.transport?.trim()
      if (!id || !/^[a-z][a-z0-9_.-]{0,127}$/.test(id)) throw new Error(`插件 ${plugin.package_id} 声明了无效的连接 ID。`)
      if (!transport || !/^[a-z][a-z0-9_.+-]{0,63}$/.test(transport)) throw new Error(`插件 ${plugin.package_id} 声明了无效的连接传输类型。`)
      if (typeof descriptor.close !== 'function') throw new Error(`插件 ${plugin.package_id} 的连接 ${id} 缺少 close()。`)
      if (descriptor.label && (!descriptor.label.en_US?.trim() || !descriptor.label.zh_Hans?.trim())) {
        throw new Error(`插件 ${plugin.package_id} 的连接 ${id} 缺少双语名称。`)
      }
      if (descriptor.reconnect !== undefined && typeof descriptor.reconnect !== 'function') {
        throw new Error(`插件 ${plugin.package_id} 的连接 ${id} 提供了无效的重连处理器。`)
      }
      const profile = descriptor.profile
      if (profile) {
        const configuration = this.configurations.get(plugin.package_id)?.get(profile.configuration_id)
        if (!configuration?.profiles.status || !/^[a-z][a-z0-9_.-]{0,127}$/.test(profile.configuration_id)
          || !/^[a-z][a-z0-9-]{0,127}$/.test(profile.profile_id)) {
          throw new Error(`插件 ${plugin.package_id} 的连接 ${id} 关联了无效的配置档案。`)
        }
      }
      const registrations = this.pluginConnections.get(plugin.package_id) || new Map<string, ConnectionRegistration>()
      if (registrations.has(id)) throw new Error(`插件 ${plugin.package_id} 重复注册连接：${id}`)
      if (registrations.size >= 64) throw new Error(`插件 ${plugin.package_id} 注册的连接数量过多。`)
      this.pluginConnections.set(plugin.package_id, registrations)
      const controller = new AbortController()
      const registration: ConnectionRegistration = {
        disposed: false,
        snapshot: {
          plugin_id: plugin.package_id,
          id,
          transport,
          permission: descriptor.permission,
          ...(descriptor.label ? { label: { ...descriptor.label } } : {}),
          ...(profile ? { profile: { ...profile } } : {}),
          ...(descriptor.reconnect ? { reconnectable: true } : {}),
          state: 'idle',
          changed_at: new Date().toISOString(),
        },
        ...(descriptor.reconnect ? { reconnect: descriptor.reconnect } : {}),
        dispose: async () => {
          if (registration.disposed) return
          registration.disposed = true
          controller.abort(new Error('Plugin connection disposed.'))
          if (registrations.get(id) === registration) registrations.delete(id)
          if (!registrations.size && this.pluginConnections.get(plugin.package_id) === registrations) {
            this.pluginConnections.delete(plugin.package_id)
          }
          this.publishRuntime(plugin.package_id)
          await descriptor.close()
        },
      }
      registrations.set(id, registration)
      this.publishRuntime(plugin.package_id)
      base.effect(() => () => registration.dispose(), `seed.plugin.connection:${id}`)
      return {
        signal: controller.signal,
        update: (status: SeedConnectionStatus) => {
          if (registration.disposed) throw new Error(`插件连接 ${id} 已注销。`)
          if (!connectionStates.has(status.state)) throw new Error(`插件连接 ${id} 上报了无效状态。`)
          registration.snapshot = {
            ...registration.snapshot,
            state: status.state,
            changed_at: new Date().toISOString(),
            ...(status.error ? { error: status.error.slice(0, 1000) } : {}),
          }
          if (status.state === 'failed' && status.error) void invokeRuntimeHost('seed.plugin.diagnostic', { entry: {
            level: 'error', event: 'connection.failed', message: status.error, operation: id,
          } }).catch(() => undefined)
          if (!status.error) delete registration.snapshot.error
          this.publishRuntime(plugin.package_id)
        },
        dispose: () => registration.dispose(),
      }
    }
    return {
      package: {
        package_id: plugin.package_id,
        version: plugin.version,
        data_path: dataPath,
      },
      audit: { record: async (entry) => { await invokeHost('seed.plugin.audit', { entry }) } },
      diagnostics: {
        report: async (entry) => { await invokeRuntimeHost('seed.plugin.diagnostic', { entry }) },
        error: async (event, error, context) => { await invokeRuntimeHost('seed.plugin.diagnostic', { entry: {
          level: 'error', event, message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error ? { error_name: error.name, error_stack: error.stack } : {}), ...context,
        } }) },
      },
      capabilities: {
        register: registerCapability,
        list: async () => this.nativeExecution === 'local' && this.runtimeChanged
          ? await invokeRuntimeHost('seed.native.capabilities.list', {}) as Awaited<ReturnType<typeof this.consumedCapabilities>>
          : this.consumedCapabilities(plugin),
        invoke: async (invocation) => this.nativeExecution === 'local' && this.runtimeChanged
          ? await invokeRuntimeHost('seed.native.capabilities.invoke', {
            invocation: { ...invocation, signal: undefined }, chain: this.invocationChain.getStore() || [],
          })
          : this.invokeConsumedCapability(plugin, invocation),
      },
      configuration: {
        register: registerConfiguration,
        registerOptionsResolver,
        get: async (configurationId) => {
          if (!this.configurations.get(plugin.package_id)?.has(configurationId)) {
            throw new Error(`插件 ${plugin.package_id} 尚未注册配置：${configurationId}`)
          }
          return await invokeRuntimeHost('seed.configuration', {
            configuration_id: configurationId,
            declaration: configurationSources.get(configurationId),
          })
        },
      },
      management: { registerView: registerManagementView },
      localApi: { register: registerLocalApi },
      tasks: {
        start: startTask,
        run: async (input, work) => {
          const task = startTask(input)
          try {
            const result = await work(task.signal)
            task.finish()
            return result
          } catch (error) {
            task.fail(error)
            throw error
          }
        },
      },
      connections: { register: registerConnection },
      secrets: {
        get: async (key) => {
          const result = await invokeHost('seed.plugin-secret', { operation: 'get', key }) as { value?: unknown }
          return typeof result.value === 'string' ? result.value : undefined
        },
        set: async (key, value) => { await invokeHost('seed.plugin-secret', { operation: 'set', key, value }) },
        delete: async (key) => { await invokeHost('seed.plugin-secret', { operation: 'delete', key }) },
      },
      authorization: {
        authorize: async (request, signal) => {
          const permission = request.standard === 'oauth2.authorization_code.pkce'
            ? 'authorization.oauth2.pkce'
            : request.standard === 'openid_connect.authorization_code.pkce'
              ? 'authorization.oidc.pkce'
              : ''
          if (!permission || !plugin.permissions.includes(permission)) {
            throw new Error(`插件 ${plugin.package_id} 未声明对应标准的浏览器授权权限。`)
          }
          if (signal?.aborted) throw new Error('插件授权已取消。')
          const requestId = randomUUID()
          pendingAuthorizations.add(requestId)
          const cancel = () => { void invokeHost('seed.plugin-authorization', { operation: 'cancel', request_id: requestId }) }
          signal?.addEventListener('abort', cancel, { once: true })
          try {
            return await invokeHost('seed.plugin-authorization', {
              operation: 'start', request_id: requestId, request,
            }) as import('@motusai/seed-sdk').SeedBrowserAuthorizationResult
          } finally {
            signal?.removeEventListener('abort', cancel)
            pendingAuthorizations.delete(requestId)
          }
        },
      },
      invokeHost,
      has: (key) => base.has(key),
      get: <T>(key: string) => base.get<T>(key),
      optional: <T>(key: string) => base.optional<T>(key),
      provide: <T>(key: string, service: T) => base.provide(key, service),
      effect: (setup, label) => base.effect(setup, label),
      on: (name, listener) => base.on(name, listener),
      emit: (name, ...args) => base.emit(name, ...args),
      parallel: (name, ...args) => base.parallel(name, ...args),
      serial: (name, ...args) => base.serial(name, ...args),
      waterfall: (name, initial, ...args) => base.waterfall(name, initial, ...args),
    }
  }

  async stop() {
    for (const controllers of this.pluginTaskControllers.values()) {
      for (const controller of controllers) controller.abort(new Error('Plugin stopped.'))
    }
    this.pluginTaskControllers.clear()
    await Promise.all([...this.nativeRegistries.values()].map((registry) => registry.clear()))
    await Promise.all([...this.remoteSnapshots.keys()].map((packageId) => this.runtime.invoke_host('seed.native.stop', { package_id: packageId }).catch(() => undefined)))
    this.plugins = []
    this.validators.clear()
    this.nativeRegistries.clear()
    this.nativeCapabilities.clear()
    this.configurations.clear()
    this.configurationOptionsResolvers.clear()
    this.managementViews.clear()
    this.localApis.clear()
    this.pluginConnections.clear()
    this.remoteSnapshots.clear()
    this.remoteConfigurationFingerprint = ''
    this.deferredContributionPackages.clear()
  }

  localApi(packageId: string) {
    return this.localApis.get(packageId)
  }

  connectionSnapshots(packageId?: string) {
    const registrations = packageId
      ? [...(this.pluginConnections.get(packageId)?.values() || [])]
      : [...this.pluginConnections.values()].flatMap((items) => [...items.values()])
    return [...registrations.map((registration) => ({
      ...registration.snapshot,
      ...(registration.snapshot.label ? { label: { ...registration.snapshot.label } } : {}),
      ...(registration.snapshot.profile ? { profile: { ...registration.snapshot.profile } } : {}),
    })), ...[...this.remoteSnapshots.entries()].filter(([id]) => !packageId || id === packageId)
      .flatMap(([, snapshot]) => snapshot.connections)]
  }

  configuration(packageId: string, configurationId: string) {
    return this.configurations.get(packageId)?.get(configurationId)
  }

  async reconnectProfileConnection(packageId: string, configurationId: string, profileId: string) {
    if (this.remoteSnapshots.has(packageId)) {
      await this.runtime.invoke_host('seed.native.reconnect', { package_id: packageId, configuration_id: configurationId, profile_id: profileId })
      return
    }
    const registration = [...(this.pluginConnections.get(packageId)?.values() || [])].find((candidate) => (
      candidate.snapshot.profile?.configuration_id === configurationId
      && candidate.snapshot.profile.profile_id === profileId
    ))
    if (!registration?.reconnect || registration.disposed) throw new Error('插件配置档案连接当前不可重连。')
    await registration.reconnect()
  }

  managementView(packageId: string, viewId: string) {
    return this.managementViews.get(packageId)?.get(viewId)
  }

  async resolveConfigurationOptions(packageId: string, configurationId: string, fieldKey: string, values: Record<string, string>): Promise<PluginConfigurationOption[]> {
    if (this.remoteSnapshots.has(packageId)) return await this.runtime.invoke_host('seed.native.configuration-options', {
      package_id: packageId, configuration_id: configurationId, field_key: fieldKey, values,
    }) as PluginConfigurationOption[]
    const declaration = this.configurations.get(packageId)?.get(configurationId)
    const profileField = declaration?.profiles.fields.find((field) => field.key === fieldKey)
    const rootField = declaration?.fields.find((field) => field.key === fieldKey)
    const field = profileField || rootField
    const resolver = this.configurationOptionsResolvers.get(packageId)?.get(`${configurationId}\0${fieldKey}`)
    if (!declaration || !field?.dynamicOptions || !resolver) throw new Error('插件动态配置选项不可用。')
    const allowedKeys = new Set(profileField
      ? ['id', ...declaration.profiles.fields.map((candidate) => candidate.key)]
      : declaration.fields.map((candidate) => candidate.key))
    if (Object.keys(values).some((key) => !allowedKeys.has(key))) throw new Error('插件动态配置选项包含未声明字段。')
    const resolved = await resolver(Object.freeze({ ...values }))
    if (!Array.isArray(resolved)) throw new Error('插件动态配置选项必须返回数组。')
    const options: PluginConfigurationOption[] = []
    const seen = new Set<string>()
    for (const option of resolved.slice(0, 500)) {
      if (!option || typeof option.value !== 'string') throw new Error('插件动态配置选项格式无效。')
      const value = option.value.trim()
      const label = typeof option.label === 'string' ? option.label.trim() : value
      if (!value || value.length > 200 || label.length > 200 || seen.has(value)) continue
      const badges: PluginConfigurationOptionBadge[] = Array.isArray(option.badges) ? option.badges.slice(0, 4).flatMap((badge: SeedConfigurationOptionBadge) => {
        if (!badge || typeof badge.label !== 'string') return []
        const badgeLabel = badge.label.trim()
        if (!badgeLabel || badgeLabel.length > 40) return []
        const badgePrefix = typeof badge.prefix === 'string' ? badge.prefix.trim() : ''
        if (badgePrefix.length > 8) return []
        const badgeSuffix = typeof badge.suffix === 'string' ? badge.suffix.trim() : ''
        if (badgeSuffix.length > 40) return []
        const tone = (['neutral', 'info', 'success', 'warning', 'danger'] as const)
          .find((candidate) => candidate === badge.tone) || 'neutral'
        return [{
          ...(badgePrefix ? { prefix: badgePrefix } : {}),
          label: badgeLabel,
          ...(badgeSuffix ? { suffix: badgeSuffix } : {}),
          tone,
          ...(badge.strikethrough === true ? { strikethrough: true } : {}),
        }]
      }) : []
      seen.add(value)
      const imageDataUrl = (candidate: unknown) => typeof candidate === 'string'
        && candidate.length <= 350_000
        && /^data:image\/(?:svg\+xml|png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(candidate)
        ? candidate : undefined
      const iconDataUrl = imageDataUrl(option.icon_data_url)
      const iconDarkDataUrl = imageDataUrl(option.icon_dark_data_url)
      options.push({
        value, label: label || value, ...(badges.length ? { badges } : {}),
        ...(iconDataUrl ? { iconDataUrl } : {}),
        ...(iconDataUrl && iconDarkDataUrl ? { iconDarkDataUrl } : {}),
      })
    }
    return options
  }

  localizeError(packageId: string, code: string, params: Record<string, unknown>, locale: string, fallback: string) {
    const plugin = this.plugins.find((candidate) => candidate.package_id === packageId)
    const capability = plugin?.capabilities.find((candidate) => candidate.errors?.[code])
    if (!capability) return fallback
    return pluginError(Object.assign(new Error(fallback), { code, params }), capability, locale).message
  }

  supports(capability: string, method: string, providerPluginId?: string) {
    const declared = this.methodDescriptor(capability, method, providerPluginId)
    if (!declared) return false
    return declared.plugin.runtime_kind !== 'native-host'
      || Boolean(this.nativeCapabilities.get(declared.plugin.package_id)?.has(capability))
  }

  private methodDescriptors(capabilityId: string, methodName: string) {
    return this.plugins.flatMap((plugin) => {
      const capability = plugin.capabilities.find((candidate) => candidate.id === capabilityId)
      const method = capability?.methods.find((candidate) => candidate.name === methodName)
      return capability && method && isMethodAvailableOnThisPlatform(method) ? [{ plugin, capability, method }] : []
    })
  }

  methodDescriptor(capabilityId: string, methodName: string, providerPluginId?: string) {
    const matches = this.methodDescriptors(capabilityId, methodName)
    if (providerPluginId) return matches.find(({ plugin }) => plugin.package_id === providerPluginId)
    return matches.length === 1 ? matches[0] : undefined
  }

  resolveMethodDescriptor(capabilityId: string, methodName: string, providerPluginId?: string) {
    const matches = this.methodDescriptors(capabilityId, methodName)
    if (providerPluginId) {
      const selected = matches.find(({ plugin }) => plugin.package_id === providerPluginId)
      if (selected) return selected
      throw Object.assign(
        new Error(`插件 ${providerPluginId} 当前未提供能力 ${capabilityId}.${methodName}。`),
        { code: 'capability_provider_unavailable' },
      )
    }
    if (matches.length === 1) return matches[0]!
    if (matches.length > 1) throw Object.assign(
      new Error(`能力 ${capabilityId}.${methodName} 存在多个提供方，必须指定 provider_plugin_id。`),
      { code: 'capability_provider_required' },
    )
    throw Object.assign(
      new Error(`当前 Seed 不支持能力 ${capabilityId}.${methodName}。`),
      { code: 'capability_unavailable' },
    )
  }

  private consumedCapabilities(consumer: SeedPluginRuntimeDefinition) {
    return this.plugins.flatMap((provider) => provider.package_id === consumer.package_id ? [] : provider.capabilities.flatMap((capability) => {
      if (!isPluginConsumable(capability)) return []
      const methods = capability.methods.filter((method) => isMethodAvailableOnThisPlatform(method) && canConsume(consumer, capability, method))
      if (!methods.length) return []
      return [{
        id: capability.id,
        version: capability.version,
        provider_plugin_id: provider.package_id,
        provider_plugin: {
          plugin_id: provider.package_id,
          name: provider.name
            ? resolveSeedLocalizedText(provider.name, this.runtime.configuration()?.locale || 'zh-CN')
            : provider.package_id,
          ...(provider.icon_data_url ? { icon_data_url: provider.icon_data_url } : {}),
          ...(provider.icon_dark_data_url ? { icon_dark_data_url: provider.icon_dark_data_url } : {}),
        },
        ...(capability.description ? { description: resolveSeedLocalizedText(capability.description, this.runtime.configuration()?.locale || 'zh-CN') } : {}),
        methods: methods.map((method) => ({
          name: method.name,
          risk: method.risk,
          provider_plugin_id: provider.package_id,
          ...(method.description ? { description: resolveSeedLocalizedText(method.description, this.runtime.configuration()?.locale || 'zh-CN') } : {}),
          ...(method.inputSchema ? { input_schema: method.inputSchema } : {}),
          ...(method.outputSchema ? { output_schema: method.outputSchema } : {}),
          ...(Object.keys(method.annotations || {}).length ? { annotations: method.annotations } : {}),
        })),
      }]
    }))
  }

  mcpTools() {
    return this.plugins.flatMap((plugin) => plugin.capabilities.flatMap((capability) => {
      if (plugin.runtime_kind === 'native-host' && !this.nativeCapabilities.get(plugin.package_id)?.has(capability.id)) return []
      return capability.methods.filter((method) => isMethodAvailableOnThisPlatform(method) && method.annotations?.['mcp.tool'] === true).map((method) => ({
        name: String(method.annotations?.['mcp.tool_name'] ?? method.name), plugin, capability, method,
      }))
    })).sort((left, right) => left.name.localeCompare(right.name))
  }

  consumedCapabilitiesByPackage(packageId: string) {
    const plugin = this.plugins.find((candidate) => candidate.package_id === packageId)
    if (!plugin) throw new Error(`插件 ${packageId} 当前不可用。`)
    return this.consumedCapabilities(plugin)
  }

  invokeConsumedByPackage(packageId: string, invocation: SeedPluginCapabilityInvocation, chain: string[]) {
    const plugin = this.plugins.find((candidate) => candidate.package_id === packageId)
    if (!plugin) throw new Error(`插件 ${packageId} 当前不可用。`)
    return this.invocationChain.run(chain.length ? chain : [packageId], () => this.invokeConsumedCapability(plugin, invocation))
  }

  invokeNativeWithChain(capability: string, method: string, context: CapsInvokeContext, chain: string[], trace?: DiagnosticTraceContext) {
    const work = () => this.invocationChain.run(chain, () => this.invoke(capability, method, context))
    return trace ? this.diagnosticTrace.run(trace, work) : work()
  }

  private async invokeConsumedCapability(
    consumer: SeedPluginRuntimeDefinition,
    invocation: SeedPluginCapabilityInvocation,
  ) {
    const providers = this.methodDescriptors(invocation.capability, invocation.method)
      .filter((candidate) => isPluginConsumable(candidate.capability))
    const declared = invocation.provider_plugin_id
      ? providers.find((candidate) => candidate.plugin.package_id === invocation.provider_plugin_id)
      : providers.length === 1 ? providers[0] : undefined
    if (!declared && !invocation.provider_plugin_id && providers.length > 1) {
      throw Object.assign(
        new Error(`能力 ${invocation.capability}.${invocation.method} 存在多个提供方，必须指定 provider_plugin_id。`),
        { code: 'capability_provider_required' },
      )
    }
    if (!declared && invocation.provider_plugin_id) {
      throw Object.assign(
        new Error(`插件 ${invocation.provider_plugin_id} 当前未提供可供插件调用的能力 ${invocation.capability}.${invocation.method}。`),
        { code: 'capability_provider_unavailable' },
      )
    }
    if (!declared) {
      throw Object.assign(new Error(`当前没有可供插件调用的能力 ${invocation.capability}.${invocation.method}。`), { code: 'capability_unavailable' })
    }
    if (!canConsume(consumer, declared.capability, declared.method)) {
      throw Object.assign(new Error(`插件 ${consumer.package_id} 未声明使用 ${invocation.capability}.${invocation.method}。`), { code: 'capability_not_declared' })
    }
    const providerId = declared.plugin.package_id
    const chain = this.invocationChain.getStore() || [consumer.package_id]
    if (providerId === consumer.package_id || chain.includes(providerId)) {
      throw Object.assign(new Error(`已阻止插件能力循环调用：${[...chain, providerId].join(' -> ')}`), { code: 'capability_cycle' })
    }
    const requestId = invocation.request_id || randomUUID()
    const invocationContext = invocation.context && typeof invocation.context === 'object' && !Array.isArray(invocation.context)
      ? invocation.context as Record<string, unknown> : null
    const localClientContext = invocationContext !== null && 'auth_id' in invocationContext
    if ((declared.method.risk === 'write' || declared.method.risk === 'control') && (localClientContext || invocation.approval)) {
      const authorizationId = localClientContext ? String(invocationContext.auth_id || '') : ''
      if (!invocation.approval || !authorizationId) {
        await this.recordCapabilityAudit(consumer, providerId, invocation.capability, invocation.method, declared.method.risk, requestId, 'denied')
        throw Object.assign(new Error('本地客户端的逐次审批凭据缺失。'), { code: 'plugin_capability_denied' })
      }
      const argumentsSha256 = createHash('sha256').update(canonicalSeedCapabilityApprovalPayload({
        provider_plugin_id: providerId,
        capability: invocation.capability,
        capability_version: declared.capability.version,
        method: invocation.method,
        arguments: invocation.arguments,
      })).digest('hex')
      const response = await this.runtime.invoke_host('seed.plugin-capability.verify-approval', {
        consumer_plugin_id: consumer.package_id,
        provider_plugin_id: providerId,
        capability: invocation.capability,
        capability_version: declared.capability.version,
        method: invocation.method,
        auth_id: authorizationId,
        arguments_sha256: argumentsSha256,
        approval: invocation.approval,
      }) as { allowed?: unknown }
      if (response.allowed !== true) {
        await this.recordCapabilityAudit(consumer, providerId, invocation.capability, invocation.method, declared.method.risk, requestId, 'denied')
        throw Object.assign(new Error('本地客户端的逐次审批凭据无效或已失效。'), { code: 'plugin_capability_denied' })
      }
    }
    try {
      const result = await this.invocationChain.run([...chain, providerId], () => this.invoke(invocation.capability, invocation.method, {
        request_id: requestId,
        provider_plugin_id: providerId,
        session_id: consumer.package_id,
        arguments: invocation.arguments,
        context: { source: 'plugin', caller_plugin_id: consumer.package_id, value: invocation.context },
        principal: { kind: 'plugin', plugin_id: consumer.package_id },
        signal: invocation.signal,
      }))
      await this.recordCapabilityAudit(consumer, providerId, invocation.capability, invocation.method, declared.method.risk, requestId, 'allowed')
      return result
    } catch (error) {
      await this.recordCapabilityAudit(consumer, providerId, invocation.capability, invocation.method, declared.method.risk, requestId, 'failed', error)
      throw error
    }
  }

  private async recordCapabilityAudit(
    consumer: SeedPluginRuntimeDefinition,
    providerId: string,
    capability: string,
    method: string,
    risk: 'read' | 'write' | 'control',
    requestId: string,
    outcome: 'allowed' | 'denied' | 'failed',
    error?: unknown,
  ) {
    await this.runtime.invoke_host('seed.plugin.audit', {
      package_id: consumer.package_id,
      plugin_version: consumer.version,
      trace: this.activeDiagnosticTrace(),
      entry: {
        operation: `capability.${capability}.${method}`,
        outcome,
        risk,
        request_id: requestId,
        ...(error && typeof error === 'object' && 'code' in error ? { error_code: String((error as { code?: unknown }).code || '') } : {}),
        metadata: { provider_plugin_id: providerId, capability_id: capability, capability_method: method },
      },
    })
  }

  async invoke(capability: string, method: string, context: CapsInvokeContext) {
    const parent = this.activeDiagnosticTrace()
    const trace: DiagnosticTraceContext = {
      trace_id: parent?.trace_id || randomUUID(), span_id: randomUUID(),
      ...(parent ? { parent_span_id: parent.span_id } : {}),
      ...(parent?.activity_visibility ? { activity_visibility: parent.activity_visibility } : {}),
    }
    const started = performance.now()
    const plugin = this.plugins.find((candidate) => candidate.package_id === context.provider_plugin_id)
      || this.plugins.find((candidate) => candidate.capabilities.some((item) => item.id === capability))
    const callerId = context.principal?.kind === 'plugin' ? context.principal.plugin_id : undefined
    const caller = callerId ? this.plugins.find((candidate) => candidate.package_id === callerId) : undefined
    const description = plugin?.capabilities.find((item) => item.id === capability)?.methods
      .find((item) => item.name === method)?.description
    const invocationContext = context.context && typeof context.context === 'object'
      ? context.context as Record<string, unknown> : undefined
    const technicalManagementQuery = context.principal?.kind === 'seed'
      && context.principal.surface === 'management'
      && invocationContext?.source === 'seed.management'
      && typeof invocationContext.data_source_id === 'string'
    const technicalActivity = parent?.activity_visibility === 'technical' || technicalManagementQuery
    if (technicalActivity) trace.activity_visibility = 'technical'
    const details = { ...(plugin?.name ? { plugin_name_en_us: plugin.name.en_US, plugin_name_zh_hans: plugin.name.zh_Hans } : {}),
      ...(callerId ? { caller_plugin_id: callerId } : {}),
      ...(caller?.name ? { caller_name_en_us: caller.name.en_US, caller_name_zh_hans: caller.name.zh_Hans } : {}),
      ...(description ? { method_description_en_us: description.en_US, method_description_zh_hans: description.zh_Hans } : {}),
      ...(technicalActivity ? { activity_visibility: 'technical' } : {}) }
    const event = this.nativeExecution === 'local' ? 'capability.execute' : 'capability.invoke'
    const base = { ...trace, plugin_id: plugin?.package_id || context.provider_plugin_id || 'unknown',
      plugin_version: plugin?.version, request_id: context.request_id, operation: `${capability}.${method}`, details }
    this.emitHostDiagnostic({ ...base, phase: 'started', event, message: 'Capability invocation started.' })
    try {
      const result = await this.diagnosticTrace.run(trace, () => this.invokeUntraced(capability, method, context))
      this.emitHostDiagnostic({ ...base, phase: 'completed', event,
        details: { ...details, ...(trace.credit_charged_amount !== undefined
          ? { credit_charged_amount: trace.credit_charged_amount } : {}) },
        duration_ms: Math.round(performance.now() - started), message: 'Capability invocation completed.' })
      return result
    } catch (error) {
      const original = error instanceof Error && error.cause instanceof Error ? error.cause : error
      this.emitHostDiagnostic({ ...base, phase: 'failed', event,
        duration_ms: Math.round(performance.now() - started),
        error_code: error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined,
        error_name: original instanceof Error ? original.name : undefined,
        error_stack: original instanceof Error ? original.stack : undefined,
        message: original instanceof Error ? original.message : String(original) })
      throw error
    }
  }

  private async invokeUntraced(capability: string, method: string, context: CapsInvokeContext) {
    const declared = this.resolveMethodDescriptor(capability, method, context.provider_plugin_id)
    const validators = this.validators.get(`${declared.plugin.package_id}\0${capability}\0${method}`)
    if (validators?.input && !validators.input(context.arguments)) {
      const error = new Error(`能力调用参数不符合静态 schema：${validatorError(validators.input)}`) as Error & { code?: string }
      error.code = 'invalid_arguments'
      throw error
    }
    const activity = {
      requestId: context.request_id,
      taskId: invocationTaskId(context),
      operation: `${capability}.${method}`,
    }
    const observedLocally = this.activeDiagnosticTrace()?.activity_visibility !== 'technical'
      && !(this.nativeExecution === 'remote' && declared.plugin.runtime_kind === 'native-host')
    if (observedLocally) this.taskActivityObserver?.observe(activity, 'started')
    const scope: InvocationTaskScope = { activity, observedLocally, pending: 0, handlerReturned: false, terminal: false, failed: false }
    const controller = new AbortController()
    if (context.signal) {
      if (context.signal.aborted) controller.abort(context.signal.reason)
      else context.signal.addEventListener('abort', () => controller.abort(context.signal!.reason), { once: true })
    }
    const principal: SeedInvocationPrincipal = context.principal || { kind: 'seed', surface: 'system' }
    let billingContext: { call_id: string; amount: number; price_revision: number } | undefined
    try {
      const requiresCloudBilling = declared.method.annotations?.['billing.settlement'] === 'cloud_relay'
      const billing = this.cloudBilling && requiresCloudBilling ? await this.runtime.invoke_host('seed.billing.prepare', {
        invocation_id: randomUUID(),
        plugin_id: declared.plugin.package_id,
        plugin_version: declared.plugin.version,
        capability_id: capability,
        method,
        arguments_sha256: createHash('sha256').update(stableBillingJson(context.arguments)).digest('hex'),
        source_plugin_ids: [...new Set(this.invocationChain.getStore() || [])]
          .filter((pluginId) => pluginId !== declared.plugin.package_id),
      }) as { billable: boolean; call_id?: string; amount?: number; price_revision?: number } : { billable: false }
      billingContext = billing.billable ? {
        call_id: String(billing.call_id), amount: Number(billing.amount), price_revision: Number(billing.price_revision),
      } : undefined
      const handler = this.nativeCapabilities.get(declared.plugin.package_id)?.get(capability)
      if (declared.plugin.runtime_kind === 'native-host' && !handler) {
        throw new Error(`插件 ${declared.plugin.package_id} 未注册能力实现：${capability}`)
      }
      const result = await this.invocationTasks.run(scope, async () => handler
        ? await handler.invoke(method, { ...context, capability, principal, signal: controller.signal,
            ...(billingContext ? { billing: billingContext } : {}) })
        : await this.runtime.invoke_host('seed.plugin.invoke', {
            package_id: declared.plugin.package_id,
            capability,
            method,
            invocation: { ...context, principal, signal: undefined,
              ...(billingContext ? { billing: billingContext } : {}) },
          }))
      if (validators?.output && !validators.output(result)) {
        const error = new Error(`插件返回值不符合静态 schema：${validatorError(validators.output)}`) as Error & { code?: string }
        error.code = 'invalid_result'
        throw error
      }
      if (billingContext) {
        const settlement = await this.runtime.invoke_host('seed.billing.status', {
          call_id: billingContext.call_id,
        }) as { state?: string; charged_amount?: number | null }
        if (settlement.state !== 'settled') {
          const error = new Error('收费能力尚未获得可信执行端的成功回执，结果不能交付。') as Error & { code?: string }
          error.code = 'credit_execution_unconfirmed'
          throw error
        }
        if (isCreditAmount(settlement.charged_amount) && settlement.charged_amount >= 0) {
          const trace = this.activeDiagnosticTrace()
          if (trace) trace.credit_charged_amount = Number(settlement.charged_amount)
        }
      }
      scope.handlerReturned = true
      this.finishInvocationScope(scope)
      return result
    } catch (error) {
      if (billingContext) await this.runtime.invoke_host('seed.billing.cancel', {
        call_id: billingContext.call_id,
      }).catch(() => undefined)
      scope.handlerReturned = true
      scope.failed = true
      this.finishInvocationScope(scope)
      throw pluginError(error, declared.capability, this.runtime.configuration()?.locale || 'zh-CN')
    }
  }
}

function stableBillingJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableBillingJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${stableBillingJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
