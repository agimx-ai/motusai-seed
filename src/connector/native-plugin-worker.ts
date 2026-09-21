import { randomUUID } from 'node:crypto'
import type { NativePluginCommand, NativePluginEvent, NativePluginOperation } from '../shared/native-plugin-process'
import { SeedPluginHost } from './plugin-host'
import { GlobalTaskActivityObserver } from './global-task-activity-observer'
import type { WorkerCommand } from '../shared/contracts'
import { waitForSettlement } from './shutdown'

type ParentPort = {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: NativePluginEvent): void
}
const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort
if (!parentPort) throw new Error('Native plugin runtime requires an Electron utility process.')
const emit = (event: NativePluginEvent) => parentPort!.postMessage(event)

let configuration: Extract<WorkerCommand, { type: 'configure' }> | null = null
let host: SeedPluginHost | null = null
let started = false
const pendingHost = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()
const active = new Map<string, AbortController>()
const responseStreams = new Map<string, ReadableStreamDefaultReader<Uint8Array>>()

function report(event: string, error: unknown) {
  emit({ type: 'diagnostic', event, message: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error ? { error_name: error.name, error_stack: error.stack } : {}) })
}
process.on('uncaughtExceptionMonitor', (error) => report('native.uncaught_exception', error))
process.on('unhandledRejection', (error) => {
  report('native.unhandled_rejection', error)
  setImmediate(() => process.exit(1))
})

function invokeHost(service: string, args: Record<string, unknown>) {
  const requestId = randomUUID()
  return new Promise<unknown>((resolve, reject) => {
    pendingHost.set(requestId, { resolve, reject })
    emit({ type: 'host.invoke', requestId, service, arguments: args, trace: host?.activeDiagnosticTrace() })
  })
}

async function call(operation: NativePluginOperation, signal: AbortSignal) {
  if (!host || !configuration) throw new Error('Native plugin is not ready.')
  const packageId = configuration.plugins[0]!.package_id
  switch (operation.type) {
    case 'invoke':
      return await host.invokeNativeWithChain(operation.capability, operation.method,
        { ...operation.invocation, signal }, operation.chain, operation.trace)
    case 'configuration-options':
      return await host.resolveConfigurationOptions(packageId, operation.configuration_id, operation.field_key, operation.values)
    case 'reconnect':
      await host.reconnectProfileConnection(packageId, operation.configuration_id, operation.profile_id)
      return null
    case 'local-api': {
      const request = new Request(operation.url, {
        method: operation.method, headers: operation.headers,
        ...(operation.body ? { body: operation.body } : {}), signal,
      })
      const registration = host.localApi(packageId)
      if (!registration) throw new Error('Plugin local API is unavailable.')
      const response = await host.withDiagnosticTrace(operation.trace, () => registration.handle(request, operation.client))
      const streamId = response.body ? randomUUID() : null
      if (streamId && response.body) responseStreams.set(streamId, response.body.getReader())
      return { status: response.status, headers: [...response.headers.entries()], stream_id: streamId }
    }
    case 'local-api-read': {
      const reader = responseStreams.get(operation.stream_id)
      if (!reader) throw new Error('Plugin response stream is unavailable.')
      try {
        const result = await reader.read()
        if (result.done) { responseStreams.delete(operation.stream_id); reader.releaseLock() }
        return result.done ? { done: true } : { done: false, chunk: result.value }
      } catch (error) {
        responseStreams.delete(operation.stream_id)
        throw error
      }
    }
    case 'local-api-close': {
      const reader = responseStreams.get(operation.stream_id)
      responseStreams.delete(operation.stream_id)
      if (reader) await reader.cancel().catch(() => undefined)
      return null
    }
  }
}

async function handle(command: NativePluginCommand) {
  if (command.type === 'host.result') {
    const pending = pendingHost.get(command.requestId)
    if (!pending) return
    pendingHost.delete(command.requestId)
    if (command.ok) pending.resolve(command.result)
    else {
      const error = Object.assign(new Error(command.error || 'Host service failed.'), { code: command.errorCode })
      pending.reject(error)
    }
    return
  }
  if (command.type === 'start') {
    if (host) throw new Error('Native plugin process cannot run multiple plugins.')
    configuration = { ...command.configuration, plugins: [command.plugin] }
    const observer = new GlobalTaskActivityObserver((event) => {
      if (event.type === 'task.changed') emit(event)
    })
    host = new SeedPluginHost({ configuration: () => configuration, invoke_host: invokeHost },
      observer, undefined, 'local', (packageId, snapshot) => {
        if (started && packageId === command.plugin.package_id) emit({ type: 'snapshot', snapshot })
      }, false, (entry) => emit({ type: 'host.diagnostic', entry }))
    const failures = await host.start([command.plugin])
    if (failures.length) throw new Error(failures[0]!.message)
    started = true
    emit({ type: 'ready', snapshot: host.runtimeSnapshot(command.plugin.package_id) })
    return
  }
  if (command.type === 'call') {
    const controller = new AbortController()
    active.set(command.requestId, controller)
    try {
      const result = await call(command.operation, controller.signal)
      emit({ type: 'result', requestId: command.requestId, ok: true, result })
    } catch (error) {
      emit({ type: 'result', requestId: command.requestId, ok: false, error: error instanceof Error ? error.message : String(error),
        errorCode: error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
          ? String((error as { code: string }).code) : 'native_plugin_error' })
    } finally { active.delete(command.requestId) }
    return
  }
  if (command.type === 'cancel') {
    active.get(command.requestId)?.abort(new Error('Invocation cancelled.'))
    return
  }
  if (command.type === 'stop') {
    for (const controller of active.values()) controller.abort(new Error('Plugin stopped.'))
    try {
      await waitForSettlement((async () => {
        await Promise.allSettled([...responseStreams.values()].map((reader) => reader.cancel()))
        responseStreams.clear()
        await host?.stop()
      })(), 500)
    } finally {
      process.exit(0)
    }
  }
}

parentPort.on('message', (event) => {
  void handle(event.data as NativePluginCommand).catch((error) => {
    report('native.command.failed', error)
    if ((event.data as NativePluginCommand).type === 'start') process.exit(1)
  })
})
