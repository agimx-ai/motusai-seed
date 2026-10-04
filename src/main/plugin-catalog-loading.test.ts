import { describe, expect, it, vi } from 'vitest'
import type { SeedCatalogPlugin } from '../shared/contracts'

vi.mock('electron', () => ({ app: {}, BrowserWindow: class {}, powerSaveBlocker: {}, shell: {}, ipcMain: {}, session: {} }))
vi.mock('./updater', () => ({ SeedUpdater: class {} }))
import { SeedRuntime } from './runtime'

function setup() {
  const runtime = Object.assign(Object.create(SeedRuntime.prototype) as SeedRuntime, {
    pluginCatalogStatus: 'loading', installedPluginsStatus: 'loading', remotePluginCatalog: [],
    verifiedCatalogPlugins: new Map(),
    publishSnapshot: vi.fn(async () => {}),
    fetchPluginCatalog: vi.fn(async () => ({ items: [] as SeedCatalogPlugin[] })),
    refreshInstalledEntitlements: vi.fn(async () => {}),
  })
  return runtime
}

describe('Runtime plugin catalog loading', () => {
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
    let finish!: () => void
    Reflect.set(runtime, 'refreshInstalledEntitlements', vi.fn(() => new Promise<void>((resolve) => { finish = resolve })))
    const request = runtime.refreshPluginCatalog()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(Reflect.get(runtime, 'pluginCatalogStatus')).toBe('loading')
    finish()
    await request
    expect(Reflect.get(runtime, 'pluginCatalogStatus')).toBe('ready')
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
