import { describe, expect, it } from 'vitest'
import { entitlementRefreshChangesRuntime, pluginInstallNeedsReload } from './entitlement-refresh'

const installed = [{ id: 'plugin.one', visibility: 'public' as const }]
const authorized = new Set(['plugin.one'])
const unchanged = [{ plugin_id: 'plugin.one', visibility: 'public' as const, authorized: true }]

describe('entitlement refresh', () => {
  it('reloads for a newer installed release but retains a higher development runtime', () => {
    const active = { id: 'plugin.one', version: '0.2.0', source: 'development' }
    const runtime = [{ package_id: 'plugin.one', version: '0.2.0' }]
    expect(pluginInstallNeedsReload('plugin.one', '1.1.0', [active], runtime)).toBe(true)
    expect(pluginInstallNeedsReload('plugin.one', '0.1.0', [active], runtime)).toBe(false)
    expect(pluginInstallNeedsReload('plugin.one', '0.2.0', [active], runtime)).toBe(false)
    expect(pluginInstallNeedsReload('plugin.one', '0.1.0', [active], [])).toBe(true)
  })

  it('does not request a runtime reload for an unchanged renewal', () => {
    expect(entitlementRefreshChangesRuntime(installed, authorized, unchanged, false)).toBe(false)
  })

  it('reloads when authorization, visibility, or expiry changes', () => {
    expect(entitlementRefreshChangesRuntime(installed, authorized, [{ ...unchanged[0], authorized: false }], false)).toBe(true)
    expect(entitlementRefreshChangesRuntime(installed, authorized, [{ ...unchanged[0], visibility: 'organization' }], false)).toBe(true)
    expect(entitlementRefreshChangesRuntime(installed, authorized, unchanged, true)).toBe(true)
  })

  it('reloads an installed update even when entitlement is unchanged', () => {
    expect(entitlementRefreshChangesRuntime(installed, authorized, unchanged, false)).toBe(false)
    expect(pluginInstallNeedsReload('plugin.one', '1.1.0',
      [{ id: 'plugin.one', version: '1.0.0' }], [{ package_id: 'plugin.one', version: '1.0.0' }])).toBe(true)
    expect(pluginInstallNeedsReload('plugin.one', '1.1.0',
      [{ id: 'plugin.one', version: '1.1.0' }], [{ package_id: 'plugin.one', version: '1.0.0' }])).toBe(true)
    expect(pluginInstallNeedsReload('plugin.one', '1.1.0',
      [{ id: 'plugin.one', version: '1.1.0' }], [{ package_id: 'plugin.one', version: '1.1.0' }])).toBe(false)
  })
})
