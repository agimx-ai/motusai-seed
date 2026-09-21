import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { NativePluginRuntimeSnapshot, SeedPluginRuntimeDefinition, WorkerCommand } from '../shared/contracts'
import type { NativePluginCommand, NativePluginEvent, NativePluginOperation } from '../shared/native-plugin-process'
import type { HostDiagnosticEvent } from '../shared/diagnostic-trace'

type Configuration = Extract<WorkerCommand, { type: 'configure' }>
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }
type Slot = {
  child: UtilityProcess
  ready: Promise<NativePluginRuntimeSnapshot>
  resolveReady(snapshot: NativePluginRuntimeSnapshot): void
  rejectReady(error: Error): void
  pending: Map<string, Pending>
  tasks: Map<string, Extract<NativePluginEvent, { type: 'task.changed' }>>
  cancelledBeforeCall: Map<string, NodeJS.Timeout>
  cancellationTimers: Map<string, NodeJS.Timeout>
  stopping: boolean
  startedAt: number
  retryCount: number
}

function remoteError(message: string, code?: string) {
  return Object.assign(new Error(message), { code: code || 'native_plugin_error' })
}

/** One Electron utility process per native plugin. Only Main may own or restart these processes. */
export class NativePluginManager {
  private readonly slots = new Map<string, Slot>()
  private readonly restarts = new Map<string, NodeJS.Timeout>()
  private readonly desired = new Map<string, { plugin: SeedPluginRuntimeDefinition; configuration: Configuration; retryCount: number }>()

  constructor(
    private readonly serviceName: string,
    private readonly invokeBroker: (packageId: string, service: string, args: Record<string, unknown>) => Promise<unknown>,
    private readonly onSnapshot: (packageId: string, snapshot: NativePluginRuntimeSnapshot | null) => void,
    private readonly onFailure: (packageId: string, event: string, error: Error) => void,
    private readonly onTask: (event: Extract<NativePluginEvent, { type: 'task.changed' }>) => void,
    private readonly onOutput: (packageId: string, stream: 'stdout' | 'stderr', chunk: string) => void,
    private readonly onDiagnostic?: (entry: HostDiagnosticEvent) => void,
  ) {}

  async start(plugin: SeedPluginRuntimeDefinition, configuration: Configuration) {
    if (plugin.runtime_kind !== 'native-host' || plugin.publisher_type !== 'official') throw new Error('Invalid native plugin runtime.')
    const packageId = plugin.package_id
    const previous = this.desired.get(packageId)
    const unchanged = previous && JSON.stringify(previous.plugin) === JSON.stringify(plugin)
      && previous.configuration.locale === configuration.locale
      && previous.configuration.pluginDataRoot === configuration.pluginDataRoot
    if (unchanged && this.slots.has(packageId)) return await this.slots.get(packageId)!.ready
    if (previous) await this.stop(packageId)
    const restricted: Configuration = { ...configuration, plugins: [plugin] }
    this.desired.set(packageId, { plugin, configuration: restricted, retryCount: 0 })
    return await this.spawn(packageId)
  }

  private spawn(packageId: string): Promise<NativePluginRuntimeSnapshot> {
    const desired = this.desired.get(packageId)
    if (!desired) throw new Error('Native plugin is no longer configured.')
    const workerPath = join(__dirname, '../connector/native-plugin-worker.js')
    const child = utilityProcess.fork(workerPath, [], { serviceName: `${this.serviceName} Plugin ${packageId}`, stdio: ['ignore', 'pipe', 'pipe'] })
    let resolveReady!: (snapshot: NativePluginRuntimeSnapshot) => void
    let rejectReady!: (error: Error) => void
    const ready = new Promise<NativePluginRuntimeSnapshot>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
    const slot: Slot = { child, ready,
      resolveReady, rejectReady, pending: new Map(), tasks: new Map(), cancelledBeforeCall: new Map(), cancellationTimers: new Map(),
      stopping: false, startedAt: Date.now(), retryCount: desired.retryCount }
    this.slots.set(packageId, slot)
    child.stdout?.on('data', (chunk: Buffer) => this.onOutput(packageId, 'stdout', chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => this.onOutput(packageId, 'stderr', chunk.toString('utf8')))
    child.on('message', (message) => { void this.handleEvent(packageId, slot, message as NativePluginEvent) })
    child.on('exit', (code) => {
      if (this.slots.get(packageId) !== slot) return
      this.slots.delete(packageId)
      const error = remoteError(`原生插件进程已退出（${code}）。`, 'native_plugin_process_gone')
      slot.rejectReady(error)
      for (const pending of slot.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
      slot.pending.clear()
      for (const timer of slot.cancelledBeforeCall.values()) clearTimeout(timer)
      slot.cancelledBeforeCall.clear()
      for (const timer of slot.cancellationTimers.values()) clearTimeout(timer)
      slot.cancellationTimers.clear()
      for (const task of slot.tasks.values()) this.onTask({ ...task, phase: 'failed' })
      slot.tasks.clear()
      this.onSnapshot(packageId, null)
      if (slot.stopping || !this.desired.has(packageId)) return
      this.onFailure(packageId, 'native.process.gone', error)
      const next = this.desired.get(packageId)!
      next.retryCount = Date.now() - slot.startedAt > 60_000 ? 0 : slot.retryCount + 1
      const delay = Math.min(30_000, 500 * 2 ** Math.min(next.retryCount, 6))
      this.restarts.set(packageId, setTimeout(() => {
        this.restarts.delete(packageId)
        if (this.desired.has(packageId)) void this.spawn(packageId).catch(() => undefined)
      }, delay))
    })
    const startupTimeout = setTimeout(() => child.kill(), 30_000)
    void ready.finally(() => clearTimeout(startupTimeout)).catch(() => undefined)
    child.postMessage({ type: 'start', plugin: desired.plugin, configuration: desired.configuration } satisfies NativePluginCommand)
    return ready
  }

  private async handleEvent(packageId: string, slot: Slot, event: NativePluginEvent) {
    if (this.slots.get(packageId) !== slot) return
    if (event.type === 'ready') { slot.resolveReady(event.snapshot); this.onSnapshot(packageId, event.snapshot); return }
    if (event.type === 'snapshot') { if (!slot.stopping) this.onSnapshot(packageId, event.snapshot); return }
    if (event.type === 'task.changed') {
      if (event.phase === 'started') slot.tasks.set(event.requestId, event)
      else slot.tasks.delete(event.requestId)
      this.onTask(event)
      return
    }
    if (event.type === 'diagnostic') {
      this.onFailure(packageId, event.event, Object.assign(new Error(event.message), { name: event.error_name || 'Error', stack: event.error_stack }))
      return
    }
    if (event.type === 'host.diagnostic') {
      this.onDiagnostic?.({ ...event.entry, plugin_id: packageId })
      return
    }
    if (event.type === 'result') {
      const pending = slot.pending.get(event.requestId)
      if (!pending) return
      slot.pending.delete(event.requestId)
      clearTimeout(pending.timer)
      const cancellationTimer = slot.cancellationTimers.get(event.requestId)
      if (cancellationTimer) clearTimeout(cancellationTimer)
      slot.cancellationTimers.delete(event.requestId)
      if (event.ok) pending.resolve(event.result)
      else pending.reject(remoteError(event.error || 'Native plugin call failed.', event.errorCode))
      return
    }
    if (event.type === 'host.invoke') {
      const started = performance.now()
      const trace = { trace_id: event.trace?.trace_id || randomUUID(), span_id: randomUUID(),
        ...(event.trace ? { parent_span_id: event.trace.span_id } : {}) }
      const base = { ...trace, event: 'host.invoke', plugin_id: packageId,
        plugin_version: this.desired.get(packageId)?.plugin.version, request_id: event.requestId, operation: event.service }
      this.onDiagnostic?.({ ...base, phase: 'started', message: 'Host service started.' })
      try {
        const result = await this.invokeBroker(packageId, event.service, event.arguments)
        this.onDiagnostic?.({ ...base, phase: 'completed', duration_ms: Math.round(performance.now() - started),
          message: 'Host service completed.' })
        if (this.slots.get(packageId) === slot) slot.child.postMessage({ type: 'host.result', requestId: event.requestId, ok: true, result } satisfies NativePluginCommand)
      } catch (error) {
        this.onDiagnostic?.({ ...base, phase: 'failed', duration_ms: Math.round(performance.now() - started),
          error_code: error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined,
          error_name: error instanceof Error ? error.name : undefined,
          error_stack: error instanceof Error ? error.stack : undefined,
          message: error instanceof Error ? error.message : String(error) })
        if (!this.onDiagnostic) this.onFailure(packageId, 'native.host.invoke.failed', error instanceof Error ? error : new Error(String(error)))
        if (this.slots.get(packageId) === slot) slot.child.postMessage({ type: 'host.result', requestId: event.requestId, ok: false,
          error: error instanceof Error ? error.message : String(error),
          errorCode: error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
            ? String((error as { code: string }).code) : 'native_broker_error' } satisfies NativePluginCommand)
      }
    }
  }

  async call(packageId: string, operation: NativePluginOperation, requestId: string = randomUUID()) {
    const slot = this.slots.get(packageId)
    if (!slot || slot.stopping) throw remoteError('原生插件进程当前不可用。', 'native_plugin_unavailable')
    await slot.ready
    if (this.slots.get(packageId) !== slot || slot.stopping) {
      throw remoteError('原生插件进程当前不可用。', 'native_plugin_unavailable')
    }
    const queuedCancellation = slot.cancelledBeforeCall.get(requestId)
    if (queuedCancellation) {
      clearTimeout(queuedCancellation)
      slot.cancelledBeforeCall.delete(requestId)
      throw remoteError('原生插件调用已取消。', 'invocation_cancelled')
    }
    if (slot.pending.has(requestId)) throw remoteError('重复的原生插件请求 ID。', 'duplicate_request_id')
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        slot.pending.delete(requestId)
        slot.child.kill()
        reject(remoteError('原生插件执行超时，进程已终止。', 'native_plugin_timeout'))
      }, operation.type === 'local-api-read' ? 24 * 60 * 60_000 : 10 * 60_000)
      slot.pending.set(requestId, { resolve, reject, timer })
      try { slot.child.postMessage({ type: 'call', requestId, operation } satisfies NativePluginCommand) }
      catch (error) {
        clearTimeout(timer)
        slot.pending.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  cancel(packageId: string, requestId: string) {
    const slot = this.slots.get(packageId)
    if (!slot) return
    if (!slot.pending.has(requestId)) {
      const previous = slot.cancelledBeforeCall.get(requestId)
      if (previous) clearTimeout(previous)
      slot.cancelledBeforeCall.set(requestId, setTimeout(() => slot.cancelledBeforeCall.delete(requestId), 30_000))
      return
    }
    slot.child.postMessage({ type: 'cancel', requestId } satisfies NativePluginCommand)
    if (!slot.cancellationTimers.has(requestId)) slot.cancellationTimers.set(requestId, setTimeout(() => {
      slot.cancellationTimers.delete(requestId)
      if (slot.pending.has(requestId)) slot.child.kill()
    }, 5_000))
  }

  async stop(packageId: string) {
    const timer = this.restarts.get(packageId)
    if (timer) { clearTimeout(timer); this.restarts.delete(packageId) }
    this.desired.delete(packageId)
    const slot = this.slots.get(packageId)
    if (!slot) { this.onSnapshot(packageId, null); return }
    slot.stopping = true
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { slot.child.kill(); resolve() }, 5_000)
      slot.child.once('exit', () => { clearTimeout(timeout); resolve() })
      slot.child.postMessage({ type: 'stop' } satisfies NativePluginCommand)
    })
  }

  async stopAll() {
    await Promise.all([...this.desired.keys()].map((packageId) => this.stop(packageId)))
  }
}
