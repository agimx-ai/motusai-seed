import { describe, expect, it, vi } from 'vitest'
import type { StoredPluginConfiguration } from '../shared/contracts'
import { pluginConfigurationKey } from '../shared/contracts'
import { seedPluginConfigurationSchema } from '../shared/plugin-manifest'

vi.mock('electron', () => ({ app: { getPreferredSystemLanguages: () => ['en-US'], getLocale: () => 'en-US' }, BrowserWindow: class {}, powerSaveBlocker: {}, shell: {}, ipcMain: {}, session: {} }))
vi.mock('./updater', () => ({ SeedUpdater: class {} }))
import { SeedRuntime } from './runtime'

const text = { en_US: 'Accounts', zh_Hans: '账户' }
const declaration = {
  id: 'accounts', schema_version: 1, renderer: 'seed.profiles', title: text, description: text,
  permission: 'network.connect.internet', secret_access: 'owner',
  profiles: {
    min_items: 0, max_items: 4, default_required: true, id_prefix: 'account', summary_fields: ['name'],
    fields: [{ key: 'name', type: 'text', label: text, required: true }, { key: 'secret', type: 'secret', label: text, required: true }],
    actions: { save: { label: text } },
  },
}
const pluginId = 'com.example.accounts'

function setup() {
  const configuration = seedPluginConfigurationSchema.parse(declaration)
  const stored = new Map<string, StoredPluginConfiguration>()
  const configureWorker = vi.fn()
  const auditSystem = vi.fn(async () => undefined)
  const runtime = Object.assign(Object.create(SeedRuntime.prototype), {
    pluginConfigurationWrites: new Map(),
    runtimePlugins: [{ package_id: pluginId, runtime_kind: 'native-host', permissions: ['network.connect.internet'] }],
    installedPlugins: [{ id: pluginId, enabled: true, name: text, permissions: ['network.connect.internet'], configurations: [configuration] }],
    pluginContributions: new Map([[pluginId, { configurations: [configuration], managementViews: [] }]]),
    pluginIsAuthorized: () => true, configureWorker, publishSnapshot: vi.fn(async () => undefined),
    store: {
      languagePreference: () => 'en-US',
      pluginConfiguration: (key: string) => stored.get(key),
      setPluginConfigurations: async (values: Record<string, StoredPluginConfiguration>) => {
        await Promise.resolve()
        for (const [key, value] of Object.entries(values)) stored.set(key, value)
      },
      auditSystem,
    },
  }) as SeedRuntime
  const add = (id: string, extras = {}) => Reflect.get(runtime, 'invokePluginBroker').call(runtime, pluginId, 'seed.configuration', {
    version: 1, operation: 'add_profile', configuration_id: 'accounts', declaration,
    profile: { id, name: id, secret: `secret-${id}` }, ...extras,
  })
  return { runtime, add, stored, configureWorker, auditSystem }
}

describe('host-owned configuration profile writes', () => {
  it('serializes concurrent adds, preserves the default, and returns no credentials', async () => {
    const { add, stored, configureWorker, auditSystem } = setup()
    expect(await Promise.all([add('account-one'), add('account-two')])).toEqual([null, null])
    const value = stored.get(pluginConfigurationKey(pluginId, 'accounts'))!
    expect(value.profiles.map((item) => item.id)).toEqual(['account-one', 'account-two'])
    expect(value.default_profile_id).toBe('account-one')
    expect(configureWorker).not.toHaveBeenCalled()
    expect(JSON.stringify(auditSystem.mock.calls)).not.toContain('secret-account')
  })

  it('shares validation and locking with UI saves without clearing another profile secret', async () => {
    const { add, runtime, stored, configureWorker } = setup()
    await add('account-one')
    const save = runtime.updatePluginConfiguration({ pluginId, configurationId: 'accounts', values: {
      profiles: JSON.stringify([{ id: 'account-one', name: 'Edited name', secret: '' }]), default_profile_id: 'account-one',
    } })
    await Promise.all([save, add('account-two')])
    const value = stored.get(pluginConfigurationKey(pluginId, 'accounts'))!
    expect(value.profiles).toMatchObject([{ name: 'Edited name', secret: 'secret-account-one' }, { id: 'account-two' }])
    expect(configureWorker).toHaveBeenCalledOnce()
  })

  it('refuses duplicate IDs, bad protocol versions, extra fields, permissions and other configurations', async () => {
    const { add, stored } = setup()
    await add('account-one')
    await expect(add('account-one')).rejects.toThrow('already exists')
    await expect(add('account-two', { version: 2 })).rejects.toThrow()
    await expect(add('account-two', { unknown: 'value' })).rejects.toThrow()
    await expect(add('account-two', { declaration: { ...declaration, permission: 'device.audio.capture' } })).rejects.toThrow()
    await expect(add('account-two', { configuration_id: 'other' })).rejects.toMatchObject({ code: 'broker_configuration_denied' })
    await expect(add('account-two', { declaration: { ...declaration, secret_access: 'broker' } })).rejects.toThrow()
    expect(stored.get(pluginConfigurationKey(pluginId, 'accounts'))!.profiles).toHaveLength(1)
  })

  it('rechecks plugin lifetime when a queued write begins', async () => {
    const { runtime, add, stored } = setup()
    let release!: () => void
    Reflect.get(runtime, 'pluginConfigurationWrites').set(pluginId, new Promise<void>((resolve) => { release = resolve }))
    const pending = add('account-one')
    Reflect.set(runtime, 'runtimePlugins', [])
    release()
    await expect(pending).rejects.toMatchObject({ code: 'broker_configuration_denied' })
    expect(stored.size).toBe(0)
  })

})
