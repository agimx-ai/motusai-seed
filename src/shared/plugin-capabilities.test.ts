import { describe, expect, it } from 'vitest'
import type { PluginCapabilityGrant, SeedPluginRuntimeDefinition } from './contracts'
import { pluginCapabilityGrantIsDeclared } from './plugin-capabilities'

const grant: PluginCapabilityGrant = {
  id: 'grant-1',
  consumerPluginId: 'com.example.consumer',
  providerPluginId: 'com.motusai.seed.files',
  capability: 'files',
  capabilityVersion: 1,
  method: 'write_file',
  createdAt: '2026-09-12T00:00:00.000Z',
}

const plugins = [{
  package_id: 'com.example.consumer',
  capabilities: [],
}, {
  package_id: 'com.motusai.seed.files',
  capabilities: [{ id: 'files', version: 1, methods: [{ name: 'write_file' }] }],
}] as SeedPluginRuntimeDefinition[]

describe('plugin capability grants', () => {
  it('keeps only grants whose exact v1 method is still declared', () => {
    expect(pluginCapabilityGrantIsDeclared(grant, plugins)).toBe(true)
    expect(pluginCapabilityGrantIsDeclared({ ...grant, method: 'write' }, plugins)).toBe(false)
  })

  it('rejects grants for missing consumers or providers', () => {
    expect(pluginCapabilityGrantIsDeclared({ ...grant, consumerPluginId: 'com.example.missing' }, plugins)).toBe(false)
    expect(pluginCapabilityGrantIsDeclared({ ...grant, providerPluginId: 'com.example.missing' }, plugins)).toBe(false)
  })
})
