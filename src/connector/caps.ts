import { Context, type Fiber, type Plugin } from '../vendor/cordis-core'
import type { WorkerCommand } from '../shared/contracts'
import { type SeedEffectSetup, type SeedInvocation } from '@motusai/seed-sdk'

export type CapsInvokeContext = Omit<SeedInvocation, 'principal' | 'signal'> & Partial<Pick<SeedInvocation, 'principal' | 'signal'>>

export type CapsServiceKey = string
export type CapsEventListener = (...args: unknown[]) => unknown

export type CapsRuntimeService = {
  configuration(): Extract<WorkerCommand, { type: 'configure' }> | null
  invoke_host(service: string, arguments_value: Record<string, unknown>): Promise<unknown>
}

/** Seed-facing facade. Plugin packages never import the vendored Cordis core. */
export class CapsContext {
  constructor(private readonly cordis: Context = new Context()) {}

  has(key: CapsServiceKey) { return this.cordis.get(key) !== undefined }

  get<T>(key: CapsServiceKey): T {
    const value = this.cordis.get(key)
    if (value === undefined) throw new Error(`Caps service is not available: ${key}`)
    return value as T
  }

  optional<T>(key: CapsServiceKey): T | undefined { return this.cordis.get(key) as T | undefined }

  provide<T>(key: CapsServiceKey, service: T) {
    assertServiceKey(key)
    return this.cordis.provide(key, service)
  }

  effect(setup: SeedEffectSetup, label = 'seed.plugin.effect') {
    return this.cordis.effect(setup, label)
  }

  on(name: string, listener: CapsEventListener) { return this.cordis.on(name as never, listener as never) }
  emit(name: string, ...args: unknown[]) { return (this.cordis.emit as (...values: unknown[]) => unknown)(name, ...args) }
  parallel(name: string, ...args: unknown[]) { return (this.cordis.parallel as (...values: unknown[]) => Promise<void>)(name, ...args) }
  serial(name: string, ...args: unknown[]) { return (this.cordis.serial as (...values: unknown[]) => Promise<unknown>)(name, ...args) }
  waterfall(name: string, initial: unknown, ...args: unknown[]) {
    const dispatchArgs = [name, initial, ...args]
    const callbacks = this.cordis.events.dispatch('waterfall', dispatchArgs)
    const run = (value: unknown): unknown => {
      const callback = callbacks.shift()
      return callback ? callback(value, (nextValue = value) => run(nextValue)) : value
    }
    return run(initial)
  }

  /** Internal bridge used only by the host to mount child plugin Fibers. */
  child(context: Context) { return new CapsContext(context) }
  /** Internal root Context; never exported through the plugin package format. */
  root() { return this.cordis }
}

type PluginRecord = { plugin: Plugin; fiber?: Fiber }

function assertServiceKey(key: string) {
  if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(key)) throw new Error(`Invalid caps service key: ${key}`)
}

/** Package-level Cordis Fiber registry. Runtime contributions live inside each package Fiber. */
export class CapsRegistry {
  readonly context = new CapsContext()
  private readonly plugins = new Map<string, PluginRecord>()
  private started = false

  register(pluginId: string, plugin: Plugin) {
    if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(pluginId)) throw new Error(`Invalid plugin id: ${pluginId}`)
    if (this.plugins.has(pluginId)) throw new Error(`Plugin already registered: ${pluginId}`)
    const record: PluginRecord = { plugin }
    this.plugins.set(pluginId, record)
    if (this.started) this.mount(record)

    return async () => {
      if (this.plugins.get(pluginId) !== record) return
      await record.fiber?.dispose()
      this.plugins.delete(pluginId)
    }
  }

  async start() {
    if (this.started) return
    this.started = true
    for (const record of this.plugins.values()) this.mount(record)
    await this.settle()
  }

  async stop() {
    if (!this.started) return
    this.started = false
    const fibers = [...this.plugins.values()].flatMap((record) => record.fiber ? [record.fiber] : []).reverse()
    for (const fiber of fibers) await fiber.dispose()
    for (const record of this.plugins.values()) {
      record.fiber = undefined
    }
  }

  async clear() {
    await this.stop()
    this.plugins.clear()
  }

  async reload(pluginId: string) {
    const record = this.plugins.get(pluginId)
    if (!record) throw new Error(`Caps plugin is not registered: ${pluginId}`)
    await record.fiber?.dispose()
    record.fiber = undefined
    if (this.started) {
      this.mount(record)
      await record.fiber!.await()
    }
  }

  private mount(record: PluginRecord) {
    if (!record.fiber) record.fiber = this.context.root().plugin(record.plugin)
  }

  private async settle() {
    const outcomes = await Promise.allSettled(
      [...this.plugins.values()].flatMap((record) => record.fiber ? [record.fiber.await()] : []),
    )
    const errors = outcomes.flatMap((outcome) => outcome.status === 'rejected' ? [outcome.reason] : [])
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, 'Seed capability plugins failed to start')
  }
}
