import { describe, expect, it } from 'vitest'
import type { SeedPluginRuntimeDefinition } from '../shared/contracts'
import { currentNativePluginRuntimeDefinition } from './native-plugin-runtime-definition'

function plugin(configurationRevision: string): SeedPluginRuntimeDefinition {
  return {
    package_id: 'com.example.native',
    version: '1.0.0',
    publisher_type: 'official',
    runtime_kind: 'native-host',
    root_path: '/plugins/native',
    entry_path: '/plugins/native/index.mjs',
    sidecars: [],
    permissions: ['network.connect.internet'],
    configuration_revision: configurationRevision,
    consumes: [],
    capabilities: [],
  }
}

describe('currentNativePluginRuntimeDefinition', () => {
  it('uses the currently configured definition when only a queued configuration revision is stale', () => {
    const requested = plugin('revision-1')
    const configured = plugin('revision-2')

    expect(currentNativePluginRuntimeDefinition(requested, configured)).toBe(configured)
  })

  it('accepts an exact current definition', () => {
    const configured = plugin('revision-2')

    expect(currentNativePluginRuntimeDefinition(configured, configured)).toBe(configured)
  })

  it('rejects definitions whose executable contract differs', () => {
    const requested = plugin('revision-1')
    const configured = { ...plugin('revision-2'), permissions: [] }

    expect(currentNativePluginRuntimeDefinition(requested, configured)).toBeNull()
    expect(currentNativePluginRuntimeDefinition(undefined, configured)).toBeNull()
  })
})
