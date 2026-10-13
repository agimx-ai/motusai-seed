import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { SeedPluginRuntimeDefinition } from '../shared/contracts'
import { invokeLocalCreditRelay } from './local-credit-relay'

const plugin = { package_id: 'com.example.generator', version: '1.0.0', capabilities: [{ id: 'generate', methods: [
  { name: 'start', annotations: { 'billing.settlement': 'local_relay', 'billing.product': 'iq.generate' } },
] }] } as SeedPluginRuntimeDefinition
const target = { capability_id: 'generate', method: 'start' }

describe('local relay identity and Cloud authority', () => {
  it('prepares the existing Cloud invocation with a stable argument digest and authenticated plugin identity', async () => {
    const client = { prepare: vi.fn().mockResolvedValue({ billable: true }), localRelay: vi.fn() }
    const input = { ...target, invocation_id: randomUUID(), plugin_version: '1.0.0', plugin_id: 'forged', amount: 1 }
    await invokeLocalCreditRelay(client, plugin, 'seed.local.relay.prepare', { ...input, arguments: { a: 1, b: 2 } })
    await invokeLocalCreditRelay(client, plugin, 'seed.local.relay.prepare', { ...input, arguments: { b: 2, a: 1 } })
    expect(client.prepare.mock.calls[0]).toEqual(client.prepare.mock.calls[1])
    expect(client.prepare.mock.calls[0]![0]).toEqual({ ...target, invocation_id: input.invocation_id,
      plugin_version: '1.0.0', plugin_id: plugin.package_id, arguments_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
  })

  it('forwards only the original call identity and outcome, never a local price', async () => {
    const client = { prepare: vi.fn(), localRelay: vi.fn().mockResolvedValue({ state: 'settled', charged_amount: 100 }) }
    const input = { ...target, call_id: randomUUID(), task_id: randomUUID(), outcome: 'succeeded' as const }
    await expect(invokeLocalCreditRelay(client, plugin, 'seed.local.relay', { ...input, amount: 1, plugin_id: 'forged' }))
      .resolves.toMatchObject({ charged_amount: 100 })
    expect(client.localRelay).toHaveBeenCalledExactlyOnceWith({ ...input, plugin_id: plugin.package_id })
    expect(client.prepare).not.toHaveBeenCalled()
  })

  it('rejects undeclared methods and invalid task identities before contacting Cloud', async () => {
    const client = { prepare: vi.fn(), localRelay: vi.fn() }
    await expect(invokeLocalCreditRelay(client, plugin, 'seed.local.relay', { ...target, method: 'status' }))
      .rejects.toMatchObject({ code: 'broker_permission_denied' })
    await expect(invokeLocalCreditRelay(client, undefined, 'seed.local.relay', target))
      .rejects.toMatchObject({ code: 'broker_permission_denied' })
    await expect(invokeLocalCreditRelay(client, plugin, 'seed.local.relay', { ...target, call_id: 'bad' }))
      .rejects.toThrow()
    await expect(invokeLocalCreditRelay(client, plugin, 'seed.local.relay.prepare', { ...target,
      invocation_id: randomUUID(), plugin_version: '0.1.0', arguments: {} }))
      .rejects.toMatchObject({ code: 'broker_permission_denied' })
    expect(client.localRelay).not.toHaveBeenCalled()
    expect(client.prepare).not.toHaveBeenCalled()
  })
})
