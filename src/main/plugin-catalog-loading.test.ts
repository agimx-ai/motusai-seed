import { describe, expect, it, vi } from 'vitest'
import type { SeedCatalogPlugin } from '../shared/contracts'

vi.mock('electron', () => ({ app: {}, BrowserWindow: class {}, powerSaveBlocker: {}, shell: {}, ipcMain: {}, session: {} }))
vi.mock('./updater', () => ({ SeedUpdater: class {} }))
import { SeedRuntime } from './runtime'

function setup() {
  const runtime = Object.assign(Object.create(SeedRuntime.prototype) as SeedRuntime, {
    pluginCatalogStatus: 'loading', installedPluginsStatus: 'loading', remotePluginCatalog: [],
    verifiedCatalogPlugins: new Map(),
    pluginUninstallOperations: new Set(),
    publishSnapshot: vi.fn(async () => {}),
    fetchPluginCatalog: vi.fn(async () => ({ items: [] as SeedCatalogPlugin[] })),
    refreshInstalledEntitlements: vi.fn(async () => {}),
  })
  return runtime
}

describe('Runtime plugin catalog loading', () => {
  it.each([false, true])('settles installation only after entitlement-triggered activation (failed: %s)', async (failed) => {
    const runtime = setup()
    const id = 'com.example.test'
    const installed = { id, version: '1.1.0', enabled: true, status: 'ready', name: { en_US: 'Test', zh_Hans: 'Test' } }
    let activate!: () => void
    let reject!: (error: Error) => void
    const activation = new Promise<void>((resolve, fail) => { activate = resolve; reject = fail })
    const emit = vi.fn()
    const completed = vi.fn()
    Object.assign(runtime, {
      pluginInstallOperations: new Map(),
      installedPlugins: [installed],
      runtimePlugins: [{ package_id: id, version: '1.1.0' }],
      pluginReloadWork: Promise.resolve(),
      pluginServicesReady: activation,
      authorizedInstalledPluginIds: new Set([id]),
      entitlementExpiresAt: Date.now() + 60_000,
      verifiedCatalogPlugins: new Map([[id, {
        compatible: true, publisherType: 'official', labels: [], visibility: 'public',
        versions: [{ version: '1.1.0', runtimeKind: 'native-host' }],
      }]]),
      pluginInstaller: {
        downloadAndVerify: vi.fn(async () => ({ manifest: { id, version: '1.1.0' } })),
        install: vi.fn(async () => {}),
        listInstalled: vi.fn(async () => [installed]),
      },
      store: { auditSystem: vi.fn(async () => {}) },
      emit,
    })
    const work = runtime.installPlugin(id, '1.1.0')
    void work.then(completed, () => {})
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      progress: expect.objectContaining({ phase: 'activating' }),
    })))
    expect(completed).not.toHaveBeenCalled()
    expect(emit.mock.calls.some(([event]) => event.progress?.phase === 'completed')).toBe(false)
    if (failed) {
      const rejected = expect(work).rejects.toThrow('Activation failed')
      reject(new Error('Activation failed'))
      await rejected
      expect(emit.mock.calls.some(([event]) => event.progress?.phase === 'completed')).toBe(false)
    } else {
      activate()
      await expect(work).resolves.toBe(true)
      expect(emit.mock.calls.some(([event]) => event.progress?.phase === 'completed')).toBe(true)
    }
  })

  it.each([
    { formalVersion: '1.1.0', developmentVersion: '0.2.0', runtimeVersion: '1.1.0', authorized: true, error: undefined },
    { formalVersion: '1.1.0', developmentVersion: '2.0.0', runtimeVersion: '2.0.0', authorized: true, error: undefined },
    { formalVersion: '1.0.0', developmentVersion: '2.0.0', runtimeVersion: '2.0.0', authorized: true, error: '插件安装状态' },
    { formalVersion: '1.1.0', developmentVersion: '2.0.0', runtimeVersion: '0.1.0', authorized: true, error: '运行时未能载入' },
    { formalVersion: '1.1.0', developmentVersion: '2.0.0', runtimeVersion: '2.0.0', authorized: false, error: '未获得运行权限' },
    { formalVersion: '1.1.0', developmentVersion: '0.2.0', runtimeVersion: '', authorized: true, enabled: false, error: undefined },
  ])('validates the installed release independently of the selected runtime ($developmentVersion/$runtimeVersion/$authorized)', async ({ formalVersion, developmentVersion, runtimeVersion, authorized, error, enabled = true }) => {
    const runtime = setup()
    const id = 'com.example.test'
    const installed = { id, version: formalVersion, enabled, status: 'ready', name: { en_US: 'Test', zh_Hans: 'Test' } }
    const active = { ...installed, source: 'development', version: developmentVersion }
    const auditSystem = vi.fn(async () => {})
    const reloadPlugins = vi.fn(async () => {
      Reflect.set(runtime, 'installedPlugins', [developmentVersion === '0.2.0' ? { ...installed, source: 'installed' } : active])
    })
    Object.assign(runtime, {
      pluginInstallOperations: new Map(),
      installedPlugins: [active],
      runtimePlugins: [{ package_id: id, version: runtimeVersion }],
      authorizedInstalledPluginIds: new Set(authorized ? [id] : []),
      entitlementExpiresAt: Date.now() + 60_000,
      verifiedCatalogPlugins: new Map([[id, {
        compatible: true, publisherType: 'official', labels: [], visibility: 'public',
        versions: [{ version: '1.1.0', runtimeKind: 'native-host' }],
      }]]),
      pluginInstaller: {
        downloadAndVerify: vi.fn(async () => ({ manifest: { id, version: '1.1.0' } })),
        install: vi.fn(async () => {}),
        listInstalled: vi.fn(async () => [installed]),
      },
      store: { auditSystem },
      emit: vi.fn(),
      reloadPlugins,
      configureWorker: vi.fn(),
    })
    if (error) {
      await expect(runtime.installPlugin(id, '1.1.0')).rejects.toThrow(error)
    } else {
      await expect(runtime.installPlugin(id, '1.1.0')).resolves.toBe(true)
      expect(Reflect.get(runtime, 'pluginInstaller').install.mock.calls[0][1]).not.toHaveProperty('enabled')
      if (developmentVersion === '0.2.0') expect(reloadPlugins).toHaveBeenCalledOnce()
      expect(auditSystem).toHaveBeenCalledWith('plugin.install', 'allowed', '已安装 Test（1.1.0）。', undefined,
        expect.objectContaining({ plugin_version: '1.1.0' }))
      expect(Reflect.get(runtime, 'installedPlugins')[0].version).toBe(developmentVersion === '0.2.0' ? formalVersion : developmentVersion)
    }
  })

  it('does not let a lower development directory bypass authorization for the selected installed release', () => {
    const runtime = setup()
    Object.assign(runtime, {
      installedPlugins: [{ id: 'com.example.test', source: 'installed', version: '1.1.0' }],
      developmentPlugins: { has: () => true },
      authorizedInstalledPluginIds: new Set(),
      entitlementExpiresAt: Date.now() + 60_000,
    })
    expect(Reflect.get(runtime, 'pluginIsAuthorized').call(runtime, 'com.example.test')).toBe(false)
    Reflect.set(runtime, 'installedPlugins', [{ id: 'com.example.test', source: 'development', version: '2.0.0' }])
    expect(Reflect.get(runtime, 'pluginIsAuthorized').call(runtime, 'com.example.test')).toBe(true)
  })

  it('blocks data reset during installation and blocks installation/uninstallation during reset', async () => {
    const runtime = setup()
    Reflect.set(runtime, 'pluginInstallOperations', new Map([['example', {}]]))
    Reflect.set(runtime, 'pluginUninstallOperations', new Set())
    await expect(runtime.resetOrphanedPluginData([])).rejects.toThrow('请稍后')
    Reflect.set(runtime, 'pluginInstallOperations', new Map())
    Reflect.set(runtime, 'pluginUninstallOperations', new Set(['example']))
    await expect(runtime.resetOrphanedPluginData([])).rejects.toThrow('请稍后')
    Reflect.set(runtime, 'resettingPluginData', true)
    await expect(runtime.installPlugin('com.example.test', '1.0.0')).rejects.toThrow('正在重置')
    await expect(runtime.uninstallPlugin('com.example.test')).rejects.toThrow('正在重置')
    Reflect.set(runtime, 'resettingPluginData', false)
    Reflect.set(runtime, 'pluginUninstallOperations', new Set())
    Reflect.set(runtime, 'pluginDataCleaner', () => ({ reset: async () => { throw new Error('Failed cleanup') } }))
    await expect(runtime.resetOrphanedPluginData([])).rejects.toThrow('Failed cleanup')
    expect(Reflect.get(runtime, 'resettingPluginData')).toBe(false)
  })

  it('does not uninstall an automatic update in progress or reinstall a plugin being removed', async () => {
    const runtime = setup()
    Reflect.set(runtime, 'pluginInstallOperations', new Map([['com.example.test', {}]]))
    await expect(runtime.uninstallPlugin('com.example.test')).rejects.toThrow('正在安装或更新')
    Reflect.set(runtime, 'pluginInstallOperations', new Map())
    Reflect.set(runtime, 'pluginUninstallOperations', new Set(['com.example.test']))
    await expect(runtime.installPlugin('com.example.test', '1.1.0')).rejects.toThrow('正在卸载')
  })
  it('starts in loading and reaches ready for a successfully loaded empty catalog', async () => {
    const runtime = setup()
    expect(Reflect.get(runtime, 'pluginCatalogStatus')).toBe('loading')
    expect(Reflect.get(runtime, 'installedPluginsStatus')).toBe('loading')
    const request = runtime.refreshPluginCatalog()
    expect(Reflect.get(runtime, 'pluginCatalogStatus')).toBe('loading')
    await expect(request).resolves.toEqual([])
    expect(Reflect.get(runtime, 'pluginCatalogStatus')).toBe('ready')
    expect(Reflect.get(runtime, 'publishSnapshot')).toHaveBeenCalledTimes(2)
  })

  it('keeps loading until installed authorization has also settled', async () => {
    const runtime = setup()
    const items = [{ id: 'com.example.catalog' }] as SeedCatalogPlugin[]
    Reflect.set(runtime, 'fetchPluginCatalog', vi.fn(async () => ({ items })))
    let finish!: () => void
    Reflect.set(runtime, 'refreshInstalledEntitlements', vi.fn(() => new Promise<void>((resolve) => { finish = resolve })))
    const request = runtime.refreshPluginCatalog()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(Reflect.get(runtime, 'pluginCatalogStatus')).toBe('loading')
    expect(Reflect.get(runtime, 'remotePluginCatalog')).toEqual([])
    finish()
    await request
    expect(Reflect.get(runtime, 'pluginCatalogStatus')).toBe('ready')
    expect(Reflect.get(runtime, 'remotePluginCatalog')).toEqual(items)
  })

  it('preserves the previous catalog if installed authorization fails before publication', async () => {
    const runtime = setup()
    const previous = [{ id: 'com.example.previous' }]
    Reflect.set(runtime, 'remotePluginCatalog', previous)
    Reflect.set(runtime, 'fetchPluginCatalog', vi.fn(async () => ({ items: [{ id: 'com.example.next' }] })))
    Reflect.set(runtime, 'refreshInstalledEntitlements', vi.fn(async () => { throw new Error('Authorization failed') }))
    await expect(runtime.refreshPluginCatalog()).rejects.toThrow('Authorization failed')
    expect(Reflect.get(runtime, 'remotePluginCatalog')).toBe(previous)
  })

  it('settles failed requests as errors, clears errors on retry, and preserves existing data', async () => {
    const runtime = setup()
    const existing = [{ id: 'example' }]
    Reflect.set(runtime, 'remotePluginCatalog', existing)
    Reflect.set(runtime, 'fetchPluginCatalog', vi.fn(async () => { throw new Error('Network unavailable') }))
    await expect(runtime.refreshPluginCatalog()).rejects.toThrow('Network unavailable')
    expect(Reflect.get(runtime, 'pluginCatalogStatus')).toBe('error')
    expect(Reflect.get(runtime, 'pluginCatalogError')).toBe('Network unavailable')
    expect(Reflect.get(runtime, 'remotePluginCatalog')).toBe(existing)
    Reflect.set(runtime, 'fetchPluginCatalog', vi.fn(async () => ({ items: [] })))
    const retry = runtime.refreshPluginCatalog()
    expect(Reflect.get(runtime, 'pluginCatalogError')).toBeUndefined()
    await retry
    expect(Reflect.get(runtime, 'pluginCatalogStatus')).toBe('ready')
  })

  it('settles installed-list failures independently, including catalog refreshes that skip entitlements', async () => {
    const runtime = setup()
    Reflect.deleteProperty(runtime, 'refreshInstalledEntitlements')
    Reflect.set(runtime, 'readInstalledEntitlements', vi.fn(async () => { throw new Error('Authorization unavailable') }))
    const refreshInstalled = Reflect.get(runtime, 'refreshInstalledEntitlements').bind(runtime) as () => Promise<void>
    await expect(refreshInstalled()).rejects.toThrow('Authorization unavailable')
    expect(Reflect.get(runtime, 'installedPluginsStatus')).toBe('error')
    await runtime.refreshPluginCatalog({ refreshEntitlements: false })
    expect(Reflect.get(runtime, 'pluginCatalogStatus')).toBe('ready')
    expect(Reflect.get(runtime, 'installedPluginsStatus')).toBe('error')
    Reflect.set(runtime, 'readInstalledEntitlements', vi.fn(async () => {}))
    await refreshInstalled()
    expect(Reflect.get(runtime, 'installedPluginsStatus')).toBe('ready')
    Reflect.set(runtime, 'readInstalledEntitlements', vi.fn(async () => { throw new Error('Routine renewal failed') }))
    await expect(refreshInstalled()).rejects.toThrow('Routine renewal failed')
    expect(Reflect.get(runtime, 'installedPluginsStatus')).toBe('ready')
  })
})
