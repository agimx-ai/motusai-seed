import { describe, expect, it } from 'vitest'
import { entitlementRefreshChangesRuntime } from './entitlement-refresh'

const installed = [{ id: 'plugin.one', visibility: 'public' as const }]
const authorized = new Set(['plugin.one'])
const unchanged = [{ plugin_id: 'plugin.one', visibility: 'public' as const, authorized: true }]

describe('entitlement refresh', () => {
  it('does not request a runtime reload for an unchanged renewal', () => {
    expect(entitlementRefreshChangesRuntime(installed, authorized, unchanged, false)).toBe(false)
  })

  it('reloads when authorization, visibility, or expiry changes', () => {
    expect(entitlementRefreshChangesRuntime(installed, authorized, [{ ...unchanged[0], authorized: false }], false)).toBe(true)
    expect(entitlementRefreshChangesRuntime(installed, authorized, [{ ...unchanged[0], visibility: 'organization' }], false)).toBe(true)
    expect(entitlementRefreshChangesRuntime(installed, authorized, unchanged, true)).toBe(true)
  })
})
