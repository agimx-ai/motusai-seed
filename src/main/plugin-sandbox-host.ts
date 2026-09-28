import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import { BrowserWindow, ipcMain, session } from 'electron'
import type { SeedInvocation } from '@motusai/seed-sdk'
import type { SeedPluginRuntimeDefinition } from '../shared/contracts'

const pluginHostPath = 'src/renderer/hosts/plugin/index.html'
const pluginHostProtocolUrl = `seed-plugin://runtime/host/${pluginHostPath}`
const channels = {
  ready: 'seed-plugin-host:ready',
  configure: 'seed-plugin-host:configure',
  configured: 'seed-plugin-host:configured',
  invoke: 'seed-plugin-host:invoke',
  result: 'seed-plugin-host:result',
  broker: 'seed-plugin-host:broker',
} as const

type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }

function errorWithCode(message: string, code?: string, params?: Record<string, string | number | boolean>) {
  const error = new Error(message) as Error & { code?: string; params?: Record<string, string | number | boolean> }
  if (code) error.code = code
  if (params) error.params = params
  return error
}

function isInside(root: string, target: string) {
  const value = relative(root, target)
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..')
}

function contentType(path: string) {
  switch (extname(path)) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': case '.mjs': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.yaml': return 'application/yaml; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    default: return 'application/octet-stream'
  }
}

function requiredPermissions(service: string, argumentsValue: Record<string, unknown>) {
  if (service === 'seed.plugin-authorization') {
    if (argumentsValue.operation === 'cancel') return []
    const request = argumentsValue.request as { standard?: unknown } | undefined
    if (request?.standard === 'oauth2.authorization_code.pkce') return ['authorization.oauth2.pkce']
    if (request?.standard === 'openid_connect.authorization_code.pkce') return ['authorization.oidc.pkce']
    return null
  }
  if (service === 'seed.configuration') return []
  if (service === 'seed.cloud.relay' || service === 'seed.cloud.models' ||
    ['seed.cloud.relay.stream.start', 'seed.cloud.relay.stream.next', 'seed.cloud.relay.stream.close'].includes(service)) return ['cloud.relay']
  if (service === 'seed.plugin.audit' || service === 'seed.plugin.diagnostic') return []
  if (service === 'seed.plugin-secret') return []
  if (service === 'seed.shell.open-path') return ['shell.open-path']
  if (service === 'seed.process') return ['process.sidecar']
  if (service === 'seed.python') return ['process.python']
  if (service === 'seed.audio') {
    const operation = String(argumentsValue.operation || '')
    if (['capture.start', 'capture.pause', 'capture.resume', 'capture.segment', 'capture.stop', 'capture.cancel', 'capture.interrupt', 'capture.status', 'capture.consume', 'capture.sessions', 'capture.read', 'capture.ack', 'capture.discard'].includes(operation)) {
      return ['device.audio.capture']
    }
    return null
  }
  if (service !== 'seed.broker.files.invoke') return null
  const method = String(argumentsValue.method || '')
  if (['roots', 'list', 'stat', 'search', 'find', 'grep', 'read', 'read_binary'].includes(method)) return ['resources.directory.read']
  if (method === 'edit') return ['resources.directory.read', 'resources.directory.write']
  if (['mkdir', 'write', 'move', 'delete'].includes(method)) return ['resources.directory.write']
  return null
}

/** Executes installed browser bundles in a hidden, Node-free Electron sandbox. */
export class SeedPluginSandboxHost {
  private window: BrowserWindow | null = null
  private ready: Promise<void> | null = null
  private readyResolve: (() => void) | null = null
  private readyReject: ((error: Error) => void) | null = null
  private readonly routes = new Map<string, string>()
  private readonly brokerTokens = new Map<string, string>()
  private readonly plugins = new Map<string, SeedPluginRuntimeDefinition>()
  private readonly pending = new Map<string, Pending>()
  private configured: Pending | null = null
  private protocolReady: Promise<void> | null = null
  private crashed = false
  private readonly partition: string
  private readonly channels: typeof channels

  constructor(
    private readonly invokeBroker: (packageId: string, service: string, argumentsValue: Record<string, unknown>) => Promise<unknown>,
    private readonly packageId: string,
    private readonly report?: (event: string, message: string, details?: Record<string, string | number | boolean | null>) => void,
  ) {
    const suffix = `:${createHash('sha256').update(packageId).digest('hex').slice(0, 16)}`
    this.partition = `seed-plugin-runtime${suffix}`
    this.channels = Object.fromEntries(Object.entries(channels).map(([key, value]) => [key, `${value}${suffix}`])) as typeof channels
    ipcMain.on(this.channels.ready, this.handleReady)
    ipcMain.on(this.channels.configured, this.handleConfigured)
    ipcMain.on(this.channels.result, this.handleResult)
    ipcMain.handle(this.channels.broker, this.handleBroker)
  }

  private trustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
    if (!this.window || event.sender !== this.window.webContents) throw new Error('拒绝未知插件 Host 的 IPC 请求。')
  }

  private handleReady = (event: Electron.IpcMainEvent) => {
    this.trustedSender(event)
    this.readyResolve?.()
    this.readyResolve = null
  }

  private handleConfigured = (event: Electron.IpcMainEvent, message: Record<string, unknown>) => {
    this.trustedSender(event)
    const pending = this.configured
    if (!pending) return
    this.configured = null
    clearTimeout(pending.timer)
    if (message.ok === true) pending.resolve(undefined)
    else pending.reject(errorWithCode(String(message.error || '插件 Host 配置失败。'), 'plugin_configuration_error'))
  }

  private handleResult = (event: Electron.IpcMainEvent, message: Record<string, unknown>) => {
    this.trustedSender(event)
    const requestId = String(message.request_id || '')
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    clearTimeout(pending.timer)
    if (message.ok === true) pending.resolve(message.result)
    else pending.reject(errorWithCode(
      String(message.error || '插件调用失败。'),
      String(message.error_code || 'plugin_invoke_error'),
      message.error_params && typeof message.error_params === 'object'
        ? message.error_params as Record<string, string | number | boolean>
        : undefined,
    ))
  }

  private handleBroker = async (event: Electron.IpcMainInvokeEvent, message: Record<string, unknown>) => {
    this.trustedSender(event)
    const packageId = this.brokerTokens.get(String(message.broker_token || '')) || ''
    const service = String(message.service || '')
    const argumentsValue = message.arguments && typeof message.arguments === 'object'
      ? message.arguments as Record<string, unknown>
      : {}
    const plugin = this.plugins.get(packageId)
    if (!plugin) throw errorWithCode('插件未启用或已被卸载。', 'plugin_not_enabled')
    const required = requiredPermissions(service, argumentsValue)
    if (!required) throw errorWithCode(`插件请求了未知 Broker 服务：${service}`, 'broker_service_rejected')
    const missing = required.filter((permission) => !plugin.permissions.includes(permission))
    if (missing.length) throw errorWithCode(`插件未声明 Broker 权限：${missing.join('、')}`, 'broker_permission_denied')
    return await this.invokeBroker(packageId, service, argumentsValue)
  }

  private async installProtocol() {
    if (this.protocolReady) return this.protocolReady
    this.protocolReady = (async () => {
      const hostSession = session.fromPartition(this.partition)
      hostSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      const scriptSources = process.env.VITE_DEV_SERVER_URL ? "'self' seed-plugin:" : "'self'"
      hostSession.webRequest.onHeadersReceived((details, callback) => callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [`default-src 'none'; script-src ${scriptSources}; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`],
        },
      }))
      await hostSession.protocol.handle('seed-plugin', async (request) => {
        try {
          const url = new URL(request.url)
          const segments = decodeURIComponent(url.pathname).split('/').filter(Boolean)
          let root = ''
          let relativePath = ''
          if (segments[0] === 'host') {
            root = join(__dirname, '../../renderer')
            relativePath = segments.slice(1).join('/') || pluginHostPath
          } else if (segments[0] === 'plugins' && segments[1]) {
            root = this.routes.get(segments[1]) || ''
            relativePath = segments.slice(2).join('/')
          }
          if (!root || !relativePath || relativePath.includes('\0')) return new Response('Not found', { status: 404 })
          const canonicalRoot = await realpath(root)
          const candidate = await realpath(resolve(canonicalRoot, relativePath))
          if (!isInside(canonicalRoot, candidate)) return new Response('Forbidden', { status: 403 })
          return new Response(await readFile(candidate), {
            headers: {
              'Content-Type': contentType(candidate),
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
            },
          })
        } catch {
          return new Response('Not found', { status: 404 })
        }
      })
    })()
    return this.protocolReady
  }

  private async ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return
    this.crashed = false
    await this.installProtocol()
    this.ready = new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.readyResolve = null
        this.readyReject = null
        reject(errorWithCode('插件 Host 启动超时。', 'plugin_host_ready_timeout'))
      }, 15_000)
      this.readyResolve = () => {
        clearTimeout(timer)
        this.readyReject = null
        resolvePromise()
      }
      this.readyReject = (error) => {
        clearTimeout(timer)
        this.readyResolve = null
        reject(error)
      }
    })
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/plugin-host.js'),
        partition: this.partition,
        additionalArguments: [`--seed-plugin-channel-suffix=:${createHash('sha256').update(this.packageId).digest('hex').slice(0, 16)}`],
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        devTools: false,
      },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('preload-error', (_event, preloadPath, error) => {
      this.report?.('plugin.preload.failed', error.message, { preload_path: preloadPath, error_stack: error.stack || '' })
      process.stderr.write(`Seed Plugin Host preload error (${preloadPath}): ${error.message}\n`)
    })
    window.webContents.on('console-message', ({ message, lineNumber, sourceId }) => {
      if (message) this.report?.('plugin.console', message, { line_number: lineNumber, source_id: sourceId })
      if (process.env.MOTUSAI_PLUGIN_HOST_DEBUG === 'true' && message) {
        process.stderr.write(`Seed Plugin Host console (${sourceId}:${lineNumber}): ${message}\n`)
      }
    })
    window.webContents.on('did-finish-load', () => {
      if (process.env.MOTUSAI_PLUGIN_HOST_DEBUG === 'true') {
        void window.webContents.executeJavaScript(`({ url: location.href, api: typeof window.seedPluginRuntime, html: document.documentElement.outerHTML.slice(0, 500), scripts: [...document.scripts].map((item) => item.src), resources: performance.getEntriesByType('resource').map((item) => item.name) })`)
          .then((value) => process.stderr.write(`Seed Plugin Host loaded: ${JSON.stringify(value)}\n`))
      }
    })
    window.webContents.on('did-fail-load', (_event, code, description, url) => {
      this.report?.('plugin.host.load.failed', description, { code, url })
      const error = errorWithCode(`插件 Host 页面加载失败（${code}）：${description} ${url}`, 'plugin_host_load_failed')
      this.readyReject?.(error)
      this.rejectAll(error)
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      this.crashed = true
      this.report?.('plugin.process.gone', details.reason, { exit_code: details.exitCode })
      const error = errorWithCode(`插件 Host 渲染进程已退出：${details.reason}`, 'plugin_host_crashed')
      this.readyReject?.(error)
      this.rejectAll(error)
      if (!window.isDestroyed()) window.destroy()
    })
    window.webContents.on('will-navigate', (event, url) => {
      const developmentUrl = process.env.VITE_DEV_SERVER_URL
        ? `${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')}/${pluginHostPath}`
        : ''
      if (url !== pluginHostProtocolUrl && url !== developmentUrl) event.preventDefault()
    })
    window.on('closed', () => {
      if (this.window === window) this.window = null
      const error = errorWithCode('插件 Host 已退出。', 'plugin_host_closed')
      this.readyReject?.(error)
      this.rejectAll(error)
    })
    this.window = window
    const developmentUrl = process.env.VITE_DEV_SERVER_URL
      ? `${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')}/${pluginHostPath}`
      : ''
    await Promise.all([window.loadURL(developmentUrl || pluginHostProtocolUrl), this.ready])
  }

  async configure(plugins: SeedPluginRuntimeDefinition[]) {
    if (plugins.length !== 1 || plugins[0]?.package_id !== this.packageId || plugins[0].runtime_kind !== 'sandboxed-web') {
      throw new Error('每个插件 Host 只能加载其所属的单个沙箱插件。')
    }
    await this.ensureWindow()
    this.routes.clear()
    this.brokerTokens.clear()
    this.plugins.clear()
    const browserPlugins = plugins.filter((plugin) => plugin.runtime_kind === 'sandboxed-web')
    const payload = browserPlugins.map((plugin) => {
      const token = createHash('sha256').update(`${plugin.package_id}\0${plugin.version}\0${plugin.root_path}`).digest('hex')
      const brokerToken = randomUUID()
      this.routes.set(token, plugin.root_path)
      this.brokerTokens.set(brokerToken, plugin.package_id)
      this.plugins.set(plugin.package_id, plugin)
      const entryRelative = relative(plugin.root_path, plugin.entry_path).split(sep).join('/')
      if (!entryRelative || entryRelative.startsWith('../')) throw new Error(`插件入口越过安装目录：${plugin.package_id}`)
      return {
        package_id: plugin.package_id,
        version: plugin.version,
        broker_token: brokerToken,
        entry_url: `seed-plugin://runtime/plugins/${token}/${entryRelative}`,
        capabilities: plugin.capabilities,
      }
    })
    const configurationId = randomUUID()
    await new Promise<void>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.configured = null
        reject(errorWithCode('插件 Host 配置超时。', 'plugin_configuration_timeout'))
      }, 30_000)
      this.configured = { resolve: resolvePromise, reject, timer }
      this.window!.webContents.send(this.channels.configure, {
        configuration_id: configurationId,
        plugins: payload,
      })
    })
  }

  async invoke(packageId: string, capability: string, method: string, invocation: Omit<SeedInvocation, 'signal'>) {
    if (!this.plugins.has(packageId)) throw errorWithCode('插件未启用。', 'plugin_not_enabled')
    await this.ensureWindow()
    const requestId = randomUUID()
    return await new Promise<unknown>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(errorWithCode('插件调用超时。', 'plugin_invoke_timeout'))
      }, 120_000)
      this.pending.set(requestId, { resolve: resolvePromise, reject, timer })
      this.window!.webContents.send(this.channels.invoke, {
        request_id: requestId,
        package_id: packageId,
        capability,
        method,
        invocation,
      })
    })
  }

  private rejectAll(error: Error) {
    if (this.configured) {
      clearTimeout(this.configured.timer)
      this.configured.reject(error)
      this.configured = null
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  destroy() {
    this.readyReject?.(errorWithCode('插件 Host 已停止。', 'plugin_host_stopped'))
    this.rejectAll(errorWithCode('插件 Host 已停止。', 'plugin_host_stopped'))
    this.window?.destroy()
    this.window = null
    const hostSession = session.fromPartition(this.partition)
    if (hostSession.protocol.isProtocolHandled('seed-plugin')) hostSession.protocol.unhandle('seed-plugin')
    ipcMain.off(this.channels.ready, this.handleReady)
    ipcMain.off(this.channels.configured, this.handleConfigured)
    ipcMain.off(this.channels.result, this.handleResult)
    ipcMain.removeHandler(this.channels.broker)
  }

  isHealthy() { return !this.crashed && Boolean(this.window && !this.window.isDestroyed()) }
}

/** One Chromium renderer process and one storage partition per sandboxed plugin. */
export class SeedPluginSandboxSupervisor {
  private readonly hosts = new Map<string, SeedPluginSandboxHost>()
  private readonly plugins = new Map<string, SeedPluginRuntimeDefinition>()
  private readonly restarts = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly crashTimes = new Map<string, number[]>()

  constructor(
    private readonly invokeBroker: (packageId: string, service: string, argumentsValue: Record<string, unknown>) => Promise<unknown>,
    private readonly report: (packageId: string, event: string, message: string, details?: Record<string, string | number | boolean | null>) => void,
  ) {}

  async configure(plugins: SeedPluginRuntimeDefinition[]) {
    const browserPlugins = plugins.filter((plugin) => plugin.runtime_kind === 'sandboxed-web')
    const nextIds = new Set(browserPlugins.map((plugin) => plugin.package_id))
    const previousPlugins = new Map(this.plugins)
    for (const [packageId, timer] of this.restarts) {
      clearTimeout(timer)
      this.restarts.delete(packageId)
    }
    this.plugins.clear()
    for (const plugin of browserPlugins) this.plugins.set(plugin.package_id, plugin)
    for (const [packageId, host] of this.hosts) {
      if (nextIds.has(packageId)) continue
      host.destroy()
      this.hosts.delete(packageId)
    }
    for (const plugin of browserPlugins) {
      if (this.hosts.get(plugin.package_id)?.isHealthy() && JSON.stringify(previousPlugins.get(plugin.package_id)) === JSON.stringify(plugin)) continue
      await this.start(plugin)
    }
  }

  private async start(plugin: SeedPluginRuntimeDefinition) {
    this.hosts.get(plugin.package_id)?.destroy()
    const host = new SeedPluginSandboxHost(this.invokeBroker, plugin.package_id, (event, message, details) => {
      this.report(plugin.package_id, event, message, details)
      if (event === 'plugin.process.gone') this.scheduleRestart(plugin.package_id)
    })
    this.hosts.set(plugin.package_id, host)
    try { await host.configure([plugin]) }
    catch (error) {
      this.report(plugin.package_id, 'plugin.configure.failed', error instanceof Error ? error.stack || error.message : String(error))
      if (this.hosts.get(plugin.package_id) === host) {
        host.destroy()
        this.hosts.delete(plugin.package_id)
      }
      this.scheduleRestart(plugin.package_id)
    }
  }

  private scheduleRestart(packageId: string) {
    if (this.restarts.has(packageId) || !this.plugins.has(packageId)) return
    const now = Date.now()
    const recent = (this.crashTimes.get(packageId) || []).filter((time) => now - time < 60_000)
    recent.push(now)
    this.crashTimes.set(packageId, recent)
    if (recent.length > 3) {
      this.report(packageId, 'plugin.restart.exhausted', '插件在 60 秒内多次崩溃，已停止自动重启。')
      return
    }
    const timer = setTimeout(() => {
      this.restarts.delete(packageId)
      const plugin = this.plugins.get(packageId)
      if (plugin) void this.start(plugin)
    }, Math.min(10_000, 1_000 * 2 ** (recent.length - 1)))
    this.restarts.set(packageId, timer)
  }

  invoke(packageId: string, capability: string, method: string, invocation: Omit<SeedInvocation, 'signal'>) {
    const host = this.hosts.get(packageId)
    if (!host || !host.isHealthy()) throw errorWithCode('插件运行进程暂不可用。', 'plugin_host_unavailable')
    return host.invoke(packageId, capability, method, invocation)
  }

  destroy() {
    for (const timer of this.restarts.values()) clearTimeout(timer)
    this.restarts.clear()
    this.plugins.clear()
    for (const host of this.hosts.values()) host.destroy()
    this.hosts.clear()
  }
}
