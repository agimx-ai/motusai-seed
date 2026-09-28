import type { SeedCapabilityHandler, SeedPlugin, SeedPluginContext } from '@motusai/seed-sdk'
import { CapsRegistry } from '../../../connector/caps'
import type { CapsPluginDescriptor } from '../../../shared/contracts'

type PluginModule = { default?: unknown; apply?: unknown; inject?: unknown }
type PluginConfiguration = {
  configuration_id: string
  plugins: Array<{ package_id: string; version: string; broker_token: string; entry_url: string; capabilities: CapsPluginDescriptor[] }>
}

type RuntimeRecord = { registry: CapsRegistry; handlers: Map<string, SeedCapabilityHandler> }
const runtimes = new Map<string, RuntimeRecord>()
const activeOwners = new Map<string, string>()
const runtimeBridge = window.seedPluginRuntime

function pluginRuntime(module: PluginModule): SeedPlugin {
  const candidate = module.default && (typeof module.default === 'object' || typeof module.default === 'function') ? module.default : module
  if (typeof candidate === 'function') return { apply: candidate as SeedPlugin['apply'] }
  if (!candidate || typeof candidate !== 'object' || typeof (candidate as SeedPlugin).apply !== 'function') {
    throw new Error('插件入口必须导出 apply(ctx)。')
  }
  return candidate as SeedPlugin
}

async function clearRuntimes() {
  await Promise.all([...runtimes.values()].map(({ registry }) => registry.clear()))
  runtimes.clear()
  activeOwners.clear()
}

runtimeBridge.onConfigure(async (configuration: PluginConfiguration) => {
  try {
    await clearRuntimes()
    for (const owner of configuration.plugins) {
      const registry = new CapsRegistry()
      const handlers = new Map<string, SeedCapabilityHandler>()
      const module = await import(/* @vite-ignore */ owner.entry_url) as PluginModule
      const plugin = pluginRuntime(module)
      registry.register(owner.package_id, {
        name: `seed-plugin:${owner.package_id}`,
        inject: [...(plugin.inject?.required || [])],
        apply: async (cordisContext) => {
          const base = registry.context.child(cordisContext)
          const taskControllers = new Set<AbortController>()
          const pendingAuthorizations = new Set<string>()
          base.effect(() => () => {
            for (const controller of taskControllers) controller.abort(new Error('Plugin stopped.'))
            taskControllers.clear()
            for (const requestId of pendingAuthorizations) {
              void runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin-authorization', { operation: 'cancel', request_id: requestId })
            }
            pendingAuthorizations.clear()
          }, 'seed.plugin.tasks')
          const startTask = (input: { id?: string }) => {
            const controller = new AbortController()
            taskControllers.add(controller)
            let settled = false
            const settle = () => { if (!settled) { settled = true; taskControllers.delete(controller) } }
            controller.signal.addEventListener('abort', settle, { once: true })
            return { id: input.id || crypto.randomUUID(), signal: controller.signal, finish: settle, fail: (_error?: unknown) => settle() }
          }
          const context: SeedPluginContext = {
            package: { package_id: owner.package_id, version: owner.version, data_path: '' },
            audit: { record: async (entry) => { await runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin.audit', { entry }) } },
            diagnostics: {
              report: async (entry) => { await runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin.diagnostic', { entry }) },
              error: async (event, error, details) => { await runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin.diagnostic', { entry: {
                level: 'error', event, message: error instanceof Error ? error.message : String(error),
                ...(error instanceof Error ? { error_name: error.name, error_stack: error.stack } : {}), ...details,
              } }) },
            },
            capabilities: {
              register: (capability, handler) => {
                if (!owner.capabilities.some((item) => item.id === capability)) throw new Error(`插件 ${owner.package_id} 注册了未声明能力：${capability}`)
                if (handlers.has(capability)) throw new Error(`插件 ${owner.package_id} 重复注册能力：${capability}`)
                handlers.set(capability, handler)
                return () => { if (handlers.get(capability) === handler) handlers.delete(capability) }
              },
              list: async () => [],
              invoke: async () => { throw new Error('沙箱插件暂不支持消费其他插件能力。') },
            },
            configuration: {
              register: () => { throw new Error('配置贡献需要 native-host 运行时。') },
              get: async () => { throw new Error('配置贡献需要 native-host 运行时。') },
              registerOptionsResolver: () => { throw new Error('动态配置选项需要 native-host 运行时。') },
            },
            management: {
              registerView: () => { throw new Error('管理视图贡献需要 native-host 运行时。') },
              publishText: async () => { throw new Error('管理视图贡献需要 native-host 运行时。') },
            },
            localApi: { register: () => { throw new Error('本地 HTTP API 需要 native-host 运行时。') } },
            tasks: {
              start: startTask,
              run: async (input, work) => {
                const task = startTask(input)
                try { const value = await work(task.signal); task.finish(); return value } catch (error) { task.fail(error); throw error }
              },
            },
            connections: { register: () => { throw new Error('主动网络连接需要声明 network.connect.* 权限并使用 native-host 运行时。') } },
            secrets: {
              get: async (key) => {
                const result = await runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin-secret', { operation: 'get', key }) as { value?: unknown }
                return typeof result.value === 'string' ? result.value : undefined
              },
              set: async (key, value) => { await runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin-secret', { operation: 'set', key, value }) },
              delete: async (key) => { await runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin-secret', { operation: 'delete', key }) },
            },
            authorization: {
              authorize: async (request, signal) => {
                if (signal?.aborted) throw new Error('插件授权已取消。')
                const requestId = crypto.randomUUID()
                pendingAuthorizations.add(requestId)
                const cancel = () => { void runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin-authorization', { operation: 'cancel', request_id: requestId }) }
                signal?.addEventListener('abort', cancel, { once: true })
                try {
                  return await runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin-authorization', {
                    operation: 'start', request_id: requestId, request,
                  }) as import('@motusai/seed-sdk').SeedBrowserAuthorizationResult
                } finally {
                  signal?.removeEventListener('abort', cancel)
                  pendingAuthorizations.delete(requestId)
                }
              },
            },
            invokeHost: (service, argumentsValue) => runtimeBridge.invokeBroker(owner.broker_token, service, argumentsValue),
            has: (key) => base.has(key), get: <T>(key: string) => base.get<T>(key), optional: <T>(key: string) => base.optional<T>(key),
            provide: <T>(key: string, value: T) => base.provide(key, value), effect: (setup, label) => base.effect(setup, label),
            on: (name, listener) => base.on(name, listener), emit: (name, ...args) => base.emit(name, ...args),
            parallel: (name, ...args) => base.parallel(name, ...args), serial: (name, ...args) => base.serial(name, ...args),
            waterfall: (name, initial, ...args) => base.waterfall(name, initial, ...args),
          }
          await plugin.apply(context)
        },
      })
      await registry.start()
      runtimes.set(owner.package_id, { registry, handlers })
      activeOwners.set(owner.package_id, owner.broker_token)
    }
    runtimeBridge.configured(configuration.configuration_id, true)
  } catch (error) {
    for (const owner of configuration.plugins) {
      await runtimeBridge.invokeBroker(owner.broker_token, 'seed.plugin.diagnostic', { entry: {
        level: 'error', event: 'plugin.start.failed', message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error ? { error_name: error.name, error_stack: error.stack } : {}),
      } }).catch(() => undefined)
    }
    await clearRuntimes()
    runtimeBridge.configured(configuration.configuration_id, false, error instanceof Error ? error.message : String(error))
  }
})

runtimeBridge.onInvoke(async (message) => {
  try {
    const handler = runtimes.get(message.package_id)?.handlers.get(message.capability)
    if (!handler) throw new Error(`插件能力尚未注册：${message.package_id}/${message.capability}`)
    const result = await handler.invoke(message.method, { ...message.invocation, capability: message.capability, signal: new AbortController().signal })
    runtimeBridge.result(message.request_id, true, result)
  } catch (error) {
    const runtime = [...runtimes.keys()].find((packageId) => packageId === message.package_id)
    if (runtime) {
      const owner = activeOwners.get(runtime)
      if (owner) await runtimeBridge.invokeBroker(owner, 'seed.plugin.diagnostic', { entry: {
        level: 'error', event: 'capability.failed', message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error ? { error_name: error.name, error_stack: error.stack } : {}),
        request_id: message.request_id, operation: `${message.capability}.${message.method}`,
      } }).catch(() => undefined)
    }
    runtimeBridge.result(
      message.request_id, false, undefined, error instanceof Error ? error.message : String(error),
      error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' ? String((error as { code: string }).code) : 'plugin_invoke_error',
      error && typeof error === 'object' && (error as { params?: unknown }).params && typeof (error as { params?: unknown }).params === 'object'
        ? (error as { params: Record<string, string | number | boolean> }).params : undefined,
    )
  }
})

runtimeBridge.ready()
