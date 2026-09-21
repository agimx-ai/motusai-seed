import { randomUUID } from 'node:crypto'
import type { WorkerCommand, WorkerEvent } from '../shared/contracts'
import type { CapsRuntimeService } from './caps'
import { ConnectorCommandDispatcher } from './command-dispatcher'
import { SeedLocalHttpGateway, seedLocalApiPort } from './local-http-gateway'
import { SeedPluginHost } from './plugin-host'
import { GlobalTaskActivityObserver } from './global-task-activity-observer'

type ParentPort = {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort
if (!parentPort) throw new Error('The local connector must run as an Electron utility process.')

let configuration: Extract<WorkerCommand, { type: 'configure' }> | null = null
const pendingHostInvocations = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()

function invokeHost(service: string, argumentsValue: Record<string, unknown>) {
  const requestId = randomUUID()
  return new Promise<unknown>((resolve, reject) => {
    pendingHostInvocations.set(requestId, { resolve, reject })
    emit({ type: 'host.invoke', requestId, service, arguments: argumentsValue, trace: pluginHost.activeDiagnosticTrace() })
  })
}

const runtimeService: CapsRuntimeService = {
  configuration: () => configuration,
  invoke_host: invokeHost,
}
const taskActivityObserver = new GlobalTaskActivityObserver(emit)
let pluginHost = new SeedPluginHost(runtimeService, taskActivityObserver, (packageId, contributions) => {
  emit({ type: 'plugin.contributions.changed', packageId, ...contributions })
}, 'remote', undefined, true, (event) => emit({ type: 'diagnostic', level: event.phase === 'failed' ? 'error' : 'info', ...event }))
const localHttpGateway = new SeedLocalHttpGateway(runtimeService, () => pluginHost, seedLocalApiPort, taskActivityObserver,
  (event) => emit({ type: 'diagnostic', level: event.phase === 'failed' ? 'error' : 'info', ...event }))
let pluginsReady: Promise<void> = Promise.resolve()

function configurePlugins(command: Extract<WorkerCommand, { type: 'configure' }>) {
  pluginsReady = pluginsReady.then(async () => {
    await localHttpGateway.start()
    const failures = await pluginHost.start(command.plugins)
    for (const failure of failures) emit({ type: 'plugin.runtime.failed', ...failure })
    const failedIds = new Set(failures.map((failure) => failure.packageId))
    localHttpGateway.updatePluginStates(command.plugins.map((plugin) => ({
      plugin_id: plugin.package_id,
      version: plugin.version,
      state: failedIds.has(plugin.package_id) ? 'failed' : 'ready',
      ...(plugin.configuration_revision ? { configuration_revision: plugin.configuration_revision } : {}),
    })))
  })
  return pluginsReady
}

function emit(event: WorkerEvent) {
  parentPort!.postMessage(event)
}

function reportFailure(event: string, error: unknown, level: 'error' | 'fatal' = 'error', pluginId?: string, requestId?: string, operation?: string) {
  emit({ type: 'diagnostic', level, event, message: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error ? { error_name: error.name, error_stack: error.stack } : {}),
    ...(pluginId ? { plugin_id: pluginId } : {}), ...(requestId ? { request_id: requestId } : {}),
    ...(operation ? { operation } : {}),
  })
}
process.on('uncaughtExceptionMonitor', (error) => reportFailure('connector.uncaught_exception', error, 'fatal'))
process.on('unhandledRejection', (reason) => {
  reportFailure('connector.unhandled_rejection', reason, 'fatal')
  process.exitCode = 1
  setImmediate(() => process.exit(1))
})

async function handleCommand(command: WorkerCommand) {
  if (command.type === 'native.runtime.updated') {
    let snapshot = command.snapshot
    const remainsConfigured = configuration?.plugins.some((plugin) => plugin.package_id === command.packageId) === true
    try {
      // A configured native plugin is restarted automatically. Keep its last published UI declarations
      // mounted while the process is temporarily unavailable so the plugin page does not collapse to empty.
      if (snapshot || !remainsConfigured) pluginHost.applyRemoteSnapshot(command.packageId, snapshot)
    } catch (error) {
      snapshot = null
      if (!remainsConfigured) pluginHost.applyRemoteSnapshot(command.packageId, null)
      await invokeHost('seed.native.stop', { package_id: command.packageId }).catch(() => undefined)
      emit({ type: 'plugin.runtime.failed', packageId: command.packageId,
        message: error instanceof Error ? error.message : String(error) })
    }
    if (configuration) localHttpGateway.updatePluginStates(configuration.plugins.map((plugin) => ({
      plugin_id: plugin.package_id, version: plugin.version,
      state: plugin.package_id === command.packageId && !snapshot ? 'failed' : 'ready',
      ...(plugin.configuration_revision ? { configuration_revision: plugin.configuration_revision } : {}),
    })))
    return
  }
  if (command.type === 'native.capability.list' || command.type === 'native.capability.invoke') {
    try {
      const result = command.type === 'native.capability.list'
        ? pluginHost.consumedCapabilitiesByPackage(command.packageId)
        : await pluginHost.invokeConsumedByPackage(command.packageId, command.invocation, command.chain)
      emit({ type: 'native.capability.result', requestId: command.requestId, ok: true, result })
    } catch (error) {
      emit({ type: 'native.capability.result', requestId: command.requestId, ok: false,
        error: error instanceof Error ? error.message : String(error),
        errorCode: error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
          ? String((error as { code: string }).code) : 'native_capability_error' })
    }
    return
  }
  if (command.type === 'plugin.configuration.profile.reconnect') {
    await pluginsReady
    try {
      await pluginHost.reconnectProfileConnection(command.pluginId, command.configurationId, command.profileId)
      emit({ type: 'plugin.configuration.profile.reconnect.result', requestId: command.requestId, ok: true })
    } catch (error) {
      reportFailure('plugin.connection.reconnect.failed', error, 'error', command.pluginId, command.requestId, `${command.configurationId}.${command.profileId}`)
      emit({ type: 'plugin.configuration.profile.reconnect.result', requestId: command.requestId, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
    return
  }
  if (command.type === 'plugin.configuration.profile-statuses.query') {
    await pluginsReady
    const declaration = pluginHost.configuration(command.pluginId, command.configurationId)
    if (!declaration?.profiles.status || declaration.profiles.status.source !== 'connections') {
      emit({ type: 'plugin.configuration.profile-statuses.result', requestId: command.requestId, ok: false, error: '插件配置档案状态不可用。' })
      return
    }
    const statuses = pluginHost.connectionSnapshots(command.pluginId)
      .filter((connection) => connection.profile?.configuration_id === command.configurationId)
      .map((connection) => ({
        profileId: connection.profile!.profile_id,
        state: connection.state,
        reconnectable: connection.reconnectable === true,
        ...(connection.error ? { error: connection.error } : {}),
      }))
    emit({ type: 'plugin.configuration.profile-statuses.result', requestId: command.requestId, ok: true, statuses })
    return
  }
  if (command.type === 'plugin.configuration.options.query') {
    await pluginsReady
    try {
      const options = await pluginHost.resolveConfigurationOptions(
        command.pluginId,
        command.configurationId,
        command.fieldKey,
        command.values,
      )
      emit({ type: 'plugin.configuration.options.result', requestId: command.requestId, ok: true, options })
    } catch (error) {
      if (!configuration) {
        emit({ type: 'plugin.configuration.options.result', requestId: command.requestId, ok: true, options: [] })
        return
      }
      reportFailure('plugin.configuration.options.failed', error, 'error', command.pluginId, command.requestId, `${command.configurationId}.${command.fieldKey}`)
      emit({ type: 'plugin.configuration.options.result', requestId: command.requestId, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
    return
  }
  if (command.type === 'plugin.management.query') {
    await pluginsReady
    const plugin = configuration?.plugins.find((candidate) => candidate.package_id === command.pluginId)
    const view = pluginHost.managementView(command.pluginId, command.viewId)
    const source = command.sourceId ? view?.dataSources[command.sourceId] : view?.source
    if (!plugin || !view || !source) {
      emit({ type: 'plugin.management.result', requestId: command.requestId, ok: false, error: '插件管理视图不可用。' })
      return
    }
    try {
      const result = await pluginHost.invoke(source.capability, source.method, {
        request_id: command.requestId,
        provider_plugin_id: plugin.package_id,
        session_id: 'seed.management',
        arguments: { ...source.arguments, ...(command.arguments || {}) },
        context: { source: 'seed.management', plugin_id: plugin.package_id, view_id: view.id, data_source_id: command.sourceId || 'primary' },
        principal: { kind: 'seed', surface: 'management' },
      })
      emit({ type: 'plugin.management.result', requestId: command.requestId, ok: true, result })
    } catch (error) {
      emit({ type: 'plugin.management.result', requestId: command.requestId, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
    return
  }
  if (command.type === 'plugin.management.invoke') {
    await pluginsReady
    const plugin = configuration?.plugins.find((candidate) => candidate.package_id === command.pluginId)
    const view = pluginHost.managementView(command.pluginId, command.viewId)
    const action = view?.actions.find((candidate) => candidate.id === command.actionId)
    if (!plugin || !view || !action) {
      emit({ type: 'plugin.management.result', requestId: command.requestId, ok: false, error: '插件管理动作不可用。' })
      return
    }
    try {
      const result = await pluginHost.invoke(action.target.capability, action.target.method, {
        request_id: command.requestId,
        provider_plugin_id: plugin.package_id,
        session_id: 'seed.management',
        arguments: { ...command.arguments, ...action.target.arguments },
        context: { source: 'seed.management', plugin_id: plugin.package_id, view_id: view.id, action_id: action.id },
        principal: { kind: 'seed', surface: 'management' },
      })
      emit({ type: 'plugin.management.result', requestId: command.requestId, ok: true, result })
    } catch (error) {
      emit({ type: 'plugin.management.result', requestId: command.requestId, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
    return
  }
  if (command.type === 'local-gateway.event') {
    localHttpGateway.publishStateEvent(command.event)
    return
  }
  if (command.type === 'configure') {
    configuration = command
    await configurePlugins(command)
    return
  }
  if (command.type === 'host.result') {
    const pending = pendingHostInvocations.get(command.requestId)
    if (!pending) return
    pendingHostInvocations.delete(command.requestId)
    if (command.ok) pending.resolve(command.result)
    else {
      const error = new Error(command.error || '主进程能力调用失败。') as Error & { code?: string }
      error.code = command.errorCode || 'host_invoke_error'
      pending.reject(error)
    }
    return
  }
  if (command.type === 'unconfigure') {
    configuration = null
    for (const pending of pendingHostInvocations.values()) pending.reject(new Error('客户端已退出登录。'))
    pendingHostInvocations.clear()
    const previous = pluginHost
    pluginHost = new SeedPluginHost(runtimeService, taskActivityObserver, (packageId, contributions) => {
      emit({ type: 'plugin.contributions.changed', packageId, ...contributions })
    }, 'remote', undefined, true, (event) => emit({ type: 'diagnostic', level: event.phase === 'failed' ? 'error' : 'info', ...event }))
    pluginsReady = Promise.all([previous.stop(), localHttpGateway.stop()]).then(() => undefined)
    await pluginsReady
  }
  if (command.type === 'shutdown') {
    void Promise.all([pluginHost.stop(), localHttpGateway.stop()]).finally(() => process.exit(0))
  }
}

const commandDispatcher = new ConnectorCommandDispatcher<WorkerCommand>(handleCommand, (error) => {
  reportFailure('connector.command.failed', error)
})

parentPort.on('message', (event) => {
  commandDispatcher.dispatch(event.data as WorkerCommand)
})
