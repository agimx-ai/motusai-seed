import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, BrowserWindow: class {}, powerSaveBlocker: {}, shell: {}, ipcMain: {}, session: {} }))
vi.mock('./updater', () => ({ SeedUpdater: class {} }))
import { SeedRuntime } from './runtime'

describe('Runtime Cloud relay', () => {
  it.each(['seed.cloud.relay', 'seed.cloud.relay.stream.start'])('does not impose a second 1 MiB limit on %s', async (service) => {
    const relay = vi.fn(async () => ({ payload: {} }))
    const startRelayStream = vi.fn(async () => ({ stream_id: 'c14cb3bb-cc6c-4009-b1d9-7ebae4b00694' }))
    const runtime = Object.assign(Object.create(SeedRuntime.prototype), {
      runtimePlugins: [{ package_id: 'com.example.plugin', permissions: ['cloud.relay'], capabilities: [
        { id: 'hosted_models', methods: [{ name: 'complete', annotations: {
          'billing.settlement': 'cloud_relay', 'billing.relay_template': 'model_chat', 'billing.product': 'model.generate',
        } }] },
      ] }],
      creditBilling: { relay, startRelayStream },
    })
    await Reflect.get(runtime, 'invokePluginBroker').call(runtime, 'com.example.plugin', service, {
      call_id: 'a9505c1e-9f5d-4658-a3e1-594a8bab2432', capability_id: 'hosted_models', method: 'complete',
      payload: { text: '内容'.repeat(200_000) },
    })
    expect(service === 'seed.cloud.relay' ? relay : startRelayStream).toHaveBeenCalledOnce()
  })

  it('cancels an automatically prepared invocation if transport rejects an oversized request', async () => {
    const callId = 'a9505c1e-9f5d-4658-a3e1-594a8bab2432'
    const failure = Object.assign(new Error('Request exceeds transport limit'), { code: 'credit_relay_request_too_large' })
    const cancel = vi.fn(async () => undefined)
    const runtime = Object.assign(Object.create(SeedRuntime.prototype), {
      runtimePlugins: [{ package_id: 'com.example.plugin', version: '1.0.0', permissions: ['cloud.relay'], capabilities: [
        { id: 'hosted_models', methods: [{ name: 'complete', annotations: {
          'billing.settlement': 'cloud_relay', 'billing.relay_template': 'model_chat', 'billing.product': 'model.generate',
        } }] },
      ] }],
      creditBilling: { prepare: vi.fn(async () => ({ billable: true, call_id: callId })),
        relay: vi.fn(async () => { throw failure }), startRelayStream: vi.fn(), cancel },
    })
    await expect(Reflect.get(runtime, 'invokePluginBroker').call(runtime, 'com.example.plugin', 'seed.cloud.relay', {
      capability_id: 'hosted_models', method: 'complete', payload: { model: 'example/model' },
    })).rejects.toBe(failure)
    expect(cancel).toHaveBeenCalledExactlyOnceWith(callId)
  })
})
