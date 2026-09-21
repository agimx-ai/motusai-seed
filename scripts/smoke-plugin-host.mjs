import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { app, protocol } from 'electron'
import { SeedPluginInstaller } from '../dist/electron/main/seed-plugin-installer.js'
import { SeedPluginSandboxHost } from '../dist/electron/main/plugin-sandbox-host.js'
import { NativePluginManager } from '../dist/electron/main/native-plugin-manager.js'
import { verifySeedPackage } from '../dist/electron/main/seed-package.js'

const packageArgument = process.argv[2]
if (!packageArgument) {
  process.stderr.write('请传入待验证的 .seedpkg 绝对路径。\n')
  process.exit(2)
}
const packagePath = resolve(packageArgument)
const temporary = mkdtempSync(resolve(tmpdir(), 'seed-plugin-host-smoke-'))
const watchdog = setTimeout(() => {
  process.stderr.write('Plugin Host smoke timed out.\n')
  process.exit(2)
}, 30_000)
app.setPath('userData', temporary)
protocol.registerSchemesAsPrivileged([{
  scheme: 'seed-plugin',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}])

process.stdout.write('等待 Electron ready…\n')
app.whenReady().then(async () => {
  let cleanup
  let failed = false
  try {
    process.stdout.write('校验并安装 .seedpkg…\n')
    const bytes = await readFile(packagePath)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const verified = await verifySeedPackage(bytes, { expectedPackageSha256: digest })
    let installedState
    const installer = new SeedPluginInstaller(temporary, 'https://example.test', {
      read: async () => installedState,
      write: async (state) => { installedState = structuredClone(state) },
    }, app.getVersion())
    await installer.install(verified, { publisherType: 'official', source: 'marketplace', enabled: true })
    const plugins = await installer.listRuntimePlugins()
    if (plugins.length !== 1) throw new Error(`单插件包必须解析出一个运行时，实际为 ${plugins.length} 个。`)
    const [plugin] = plugins
    process.stdout.write(`已解析 ${plugin.runtime_kind} 运行时，启动 Plugin Host…\n`)
    if (plugin.runtime_kind === 'sandboxed-web') {
      const host = new SeedPluginSandboxHost(async () => {
        throw new Error('Smoke 插件启动期间调用了意外的 Broker。')
      }, plugin.package_id)
      cleanup = () => host.destroy()
      await host.configure(plugins)
    } else if (plugin.runtime_kind === 'native-host') {
      const host = new NativePluginManager('Seed Smoke', async (_packageId, service, args) => {
          if (service === 'seed.plugin.audit') return undefined
          if (service === 'seed.plugin.diagnostic') return undefined
          if (service === 'seed.configuration') return { values: {}, profiles: [], default_profile_id: '' }
          if (service === 'seed.native.capabilities.list') return []
          if (service === 'seed.plugin-secret') return args.operation === 'get' ? {} : null
          if (service === 'seed.audio' && args.operation === 'capture.sessions') return { sessions: [] }
          throw new Error(`Smoke 插件启动期间调用了意外的 Host Service：${service}`)
        }, () => undefined, (_packageId, event, error) => process.stderr.write(`${event}: ${error.message}\n`),
        () => undefined, () => undefined)
      cleanup = () => host.stopAll()
      const snapshot = await host.start(plugin, {
        type: 'configure', serverUrl: 'https://example.test', terminalId: 'terminal-smoke', token: 'token', grants: [],
        appVersion: '0.0.0-smoke', locale: 'zh-CN', backupRoot: resolve(temporary, 'backups'),
        pluginDataRoot: resolve(temporary, 'plugin-data'), plugins,
      })
      const declaredCapabilities = new Set(plugin.capabilities.map((capability) => capability.id))
      for (const capabilityId of snapshot.capabilities) {
        if (!declaredCapabilities.has(capabilityId)) {
          throw new Error(`原生插件注册了未声明的能力：${capabilityId}`)
        }
      }
      process.stdout.write(`已注册 ${snapshot.capabilities.length}/${plugin.capabilities.length} 个声明能力。\n`)
    } else {
      throw new Error(`不支持的插件运行时：${plugin.runtime_kind}`)
    }
    await cleanup?.()
    cleanup = undefined
    process.stdout.write(`${plugin.runtime_kind} 插件安装、加载、声明注册与清理通过。\n`)
  } catch (error) {
    failed = true
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  } finally {
    try { await cleanup?.() }
    catch (error) { failed = true; process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`) }
    try { await rm(temporary, { recursive: true, force: true }) }
    catch (error) { failed = true; process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`) }
    clearTimeout(watchdog)
    app.exit(failed ? 1 : 0)
  }
})
