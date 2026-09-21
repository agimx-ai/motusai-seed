import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { PluginConfigurationOption, PluginConfigurationProfileStatus, WorkerCommand, WorkerEvent } from '../shared/contracts'

export class ConnectorManager {
  private child: UtilityProcess | null = null
  private stopping = false
  private readonly pendingManagement = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private readonly pendingConfigurationOptions = new Map<string, { resolve(value: PluginConfigurationOption[]): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private readonly pendingConfigurationProfileStatuses = new Map<string, { resolve(value: PluginConfigurationProfileStatus[]): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private readonly pendingConfigurationProfileReconnects = new Map<string, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private readonly pendingNativeCapabilities = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()

  constructor(
    private serviceName: string,
    private onEvent: (event: WorkerEvent) => void,
    private onExit: (code: number) => void = () => undefined,
    private onOutput: (stream: 'stdout' | 'stderr', chunk: string) => void = () => undefined,
  ) {}

  start() {
    if (this.stopping || this.child) return
    const workerPath = join(__dirname, '../connector/worker.js')
    const child = utilityProcess.fork(workerPath, [], { serviceName: `${this.serviceName} Connector`, stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    child.stdout?.on('data', (chunk: Buffer) => this.onOutput('stdout', chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => this.onOutput('stderr', chunk.toString('utf8')))
    child.on('message', (message) => {
      const event = message as WorkerEvent
      if (event.type === 'native.capability.result') {
        const pending = this.pendingNativeCapabilities.get(event.requestId)
        if (!pending) return
        this.pendingNativeCapabilities.delete(event.requestId)
        clearTimeout(pending.timer)
        if (event.ok) pending.resolve(event.result)
        else pending.reject(Object.assign(new Error(event.error || '插件能力调用失败。'), { code: event.errorCode }))
        return
      }
      if (event.type === 'plugin.management.result') {
        const pending = this.pendingManagement.get(event.requestId)
        if (!pending) return
        this.pendingManagement.delete(event.requestId)
        clearTimeout(pending.timer)
        if (event.ok) pending.resolve(event.result)
        else pending.reject(new Error(event.error || '插件管理视图查询失败。'))
        return
      }
      if (event.type === 'plugin.configuration.options.result') {
        const pending = this.pendingConfigurationOptions.get(event.requestId)
        if (!pending) return
        this.pendingConfigurationOptions.delete(event.requestId)
        clearTimeout(pending.timer)
        if (event.ok) pending.resolve(event.options || [])
        else pending.reject(new Error(event.error || '获取插件配置选项失败。'))
        return
      }
      if (event.type === 'plugin.configuration.profile-statuses.result') {
        const pending = this.pendingConfigurationProfileStatuses.get(event.requestId)
        if (!pending) return
        this.pendingConfigurationProfileStatuses.delete(event.requestId)
        clearTimeout(pending.timer)
        if (event.ok) pending.resolve(event.statuses || [])
        else pending.reject(new Error(event.error || '获取插件配置档案状态失败。'))
        return
      }
      if (event.type === 'plugin.configuration.profile.reconnect.result') {
        const pending = this.pendingConfigurationProfileReconnects.get(event.requestId)
        if (!pending) return
        this.pendingConfigurationProfileReconnects.delete(event.requestId)
        clearTimeout(pending.timer)
        if (event.ok) pending.resolve()
        else pending.reject(new Error(event.error || '插件配置档案重连失败。'))
        return
      }
      this.onEvent(event)
    })
    child.on('exit', (code) => {
      if (this.child !== child) return
      if (!this.stopping) this.onExit(code)
      this.child = null
      this.rejectPendingManagement(new Error(`本地连接器已退出（${code}）。`))
    })
  }

  send(command: WorkerCommand) {
    if (!this.child) {
      if (this.stopping) return
      this.start()
    }
    this.child?.postMessage(command)
  }

  queryNativeCapabilities(packageId: string) {
    return this.requestNativeCapability({ type: 'native.capability.list', packageId })
  }

  invokeNativeCapability(packageId: string, invocation: import('@motusai/seed-sdk').SeedPluginCapabilityInvocation, chain: string[]) {
    return this.requestNativeCapability({ type: 'native.capability.invoke', packageId, invocation, chain })
  }

  private requestNativeCapability(command:
    | { type: 'native.capability.list'; packageId: string }
    | { type: 'native.capability.invoke'; packageId: string; invocation: import('@motusai/seed-sdk').SeedPluginCapabilityInvocation; chain: string[] }) {
    const requestId = randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingNativeCapabilities.delete(requestId)
        reject(new Error('插件能力请求超时。'))
      }, 10 * 60_000)
      this.pendingNativeCapabilities.set(requestId, { resolve, reject, timer })
      try { this.send({ ...command, requestId } as WorkerCommand) }
      catch (error) {
        clearTimeout(timer)
        this.pendingNativeCapabilities.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  queryPluginManagement(pluginId: string, viewId: string, sourceId?: string, argumentsValue?: Record<string, unknown>) {
    return this.requestPluginManagement({ type: 'plugin.management.query', pluginId, viewId, sourceId, arguments: argumentsValue })
  }

  invokePluginManagement(pluginId: string, viewId: string, actionId: string, argumentsValue: Record<string, unknown>) {
    return this.requestPluginManagement({ type: 'plugin.management.invoke', pluginId, viewId, actionId, arguments: argumentsValue })
  }

  queryPluginConfigurationOptions(pluginId: string, configurationId: string, fieldKey: string, values: Record<string, string>) {
    const requestId = randomUUID()
    return new Promise<PluginConfigurationOption[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingConfigurationOptions.delete(requestId)
        reject(new Error('获取插件配置选项超时。'))
      }, 20_000)
      this.pendingConfigurationOptions.set(requestId, { resolve, reject, timer })
      try {
        this.send({ type: 'plugin.configuration.options.query', requestId, pluginId, configurationId, fieldKey, values })
      } catch (error) {
        clearTimeout(timer)
        this.pendingConfigurationOptions.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  queryPluginConfigurationProfileStatuses(pluginId: string, configurationId: string) {
    const requestId = randomUUID()
    return new Promise<PluginConfigurationProfileStatus[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingConfigurationProfileStatuses.delete(requestId)
        reject(new Error('获取插件配置档案状态超时。'))
      }, 20_000)
      this.pendingConfigurationProfileStatuses.set(requestId, { resolve, reject, timer })
      try {
        this.send({ type: 'plugin.configuration.profile-statuses.query', requestId, pluginId, configurationId })
      } catch (error) {
        clearTimeout(timer)
        this.pendingConfigurationProfileStatuses.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  reconnectPluginConfigurationProfile(pluginId: string, configurationId: string, profileId: string) {
    const requestId = randomUUID()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingConfigurationProfileReconnects.delete(requestId)
        reject(new Error('插件配置档案重连超时。'))
      }, 20_000)
      this.pendingConfigurationProfileReconnects.set(requestId, { resolve, reject, timer })
      try {
        this.send({ type: 'plugin.configuration.profile.reconnect', requestId, pluginId, configurationId, profileId })
      } catch (error) {
        clearTimeout(timer)
        this.pendingConfigurationProfileReconnects.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private requestPluginManagement(command:
    | { type: 'plugin.management.query'; pluginId: string; viewId: string; sourceId?: string; arguments?: Record<string, unknown> }
    | { type: 'plugin.management.invoke'; pluginId: string; viewId: string; actionId: string; arguments: Record<string, unknown> }
  ) {
    const requestId = randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingManagement.delete(requestId)
        reject(new Error('插件管理视图查询超时。'))
      }, 30_000)
      this.pendingManagement.set(requestId, { resolve, reject, timer })
      try { this.send({ ...command, requestId } as WorkerCommand) }
      catch (error) {
        clearTimeout(timer)
        this.pendingManagement.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private rejectPendingManagement(error: Error) {
    for (const pending of this.pendingNativeCapabilities.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pendingNativeCapabilities.clear()
    for (const pending of this.pendingManagement.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingManagement.clear()
    for (const pending of this.pendingConfigurationOptions.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingConfigurationOptions.clear()
    for (const pending of this.pendingConfigurationProfileStatuses.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingConfigurationProfileStatuses.clear()
    for (const pending of this.pendingConfigurationProfileReconnects.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingConfigurationProfileReconnects.clear()
  }

  async stop() {
    this.stopping = true
    const child = this.child
    if (!child) return
    this.rejectPendingManagement(new Error('本地连接器已停止。'))
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (this.child === child) this.child = null
        resolve()
      }
      const timeout = setTimeout(() => {
        child.kill()
        finish()
      }, 5_000)
      child.once('exit', finish)
      child.postMessage({ type: 'shutdown' } satisfies WorkerCommand)
    })
  }
}
