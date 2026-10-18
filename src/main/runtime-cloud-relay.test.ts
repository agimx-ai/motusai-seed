import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: class {},
  powerSaveBlocker: {},
  shell: {},
  ipcMain: {},
  session: {},
}));
vi.mock('./updater', () => ({ SeedUpdater: class {} }));
import { SeedRuntime } from './runtime';
import { PluginCapabilityCatalog } from './plugin-capability-catalog';

function relayRuntime(creditBilling: Record<string, unknown>, permissions = ['cloud.relay']) {
  const plugin = {
    package_id: 'com.example.plugin',
    version: '1.0.0',
    api_version: 2 as const,
    has_service: true,
    permissions,
    capabilities: [],
    consumes: [],
    resources: [],
    sidecars: [],
    runtime_kind: 'native-host' as const,
    publisher_type: 'official' as const,
    root_path: '/plugin',
    entry_path: '/plugin/main.js',
    sdk_manifest: {
      id: 'com.example.plugin',
      name: 'Probe',
      description: 'Probe',
      author: 'Example',
      version: '1.0.0',
      minAppVersion: '0.2.15',
    },
  };
  const catalog = new PluginCapabilityCatalog();
  catalog.publish(plugin, [
    {
      id: 'hosted_models',
      version: 1,
      methods: [
        {
          name: 'complete',
          risk: 'read',
          annotations: {
            'billing.settlement': 'cloud_relay',
            'billing.relay_template': 'model_chat',
            'billing.product': 'model.generate',
          },
        },
      ],
    },
  ]);
  return Object.assign(Object.create(SeedRuntime.prototype), {
    pluginCapabilityCatalog: catalog,
    runtimePlugins: [plugin],
    creditBilling,
  });
}

describe('Runtime Cloud relay', () => {
  it.each(['seed.cloud.relay', 'seed.cloud.relay.stream.start'])(
    'uses explicit billing identity without interpreting the %s payload',
    async (service) => {
      const prepare = vi.fn(async (_input: Record<string, unknown>) => ({
        billable: true,
        call_id: crypto.randomUUID(),
      }));
      const relay = vi.fn(async (_input: Record<string, unknown>) => ({ payload: {} }));
      const startRelayStream = vi.fn(async (_input: Record<string, unknown>) => ({ stream_id: crypto.randomUUID() }));
      const runtime = relayRuntime({ prepare, relay, startRelayStream, cancel: vi.fn() });
      runtime.billedRelayStreams = new Map();
      const invoke = (extra: Record<string, unknown>) =>
        Reflect.get(runtime, 'invokePluginBroker').call(runtime, 'com.example.plugin', service, {
          capability_id: 'hosted_models',
          method: 'complete',
          payload: { model: 'body-is-not-billing' },
          ...extra,
        });
      await invoke({ model_id: 'explicit-price-model' });
      expect(prepare.mock.calls[0][0]).toMatchObject({ model_id: 'explicit-price-model' });
      await invoke({});
      expect(prepare.mock.calls[1][0]).not.toHaveProperty('model_id');
      expect((service === 'seed.cloud.relay' ? relay : startRelayStream).mock.calls[0][0].payload).toEqual({
        model: 'body-is-not-billing',
      });
      await expect(invoke({ model_id: '' })).rejects.toThrow();
      expect(prepare).toHaveBeenCalledTimes(2);
    },
  );

  it('rejects undeclared Cloud relay permissions before forwarding', async () => {
    const relay = vi.fn();
    const runtime = Object.assign(Object.create(SeedRuntime.prototype), {
      pluginCapabilityCatalog: new PluginCapabilityCatalog(),
      runtimePlugins: [{ package_id: 'com.example.plugin', permissions: [], capabilities: [] }],
      creditBilling: { relay },
    });
    await expect(
      Reflect.get(runtime, 'invokePluginBroker').call(runtime, 'com.example.plugin', 'seed.cloud.relay', {
        capability_id: 'hosted_models',
        method: 'complete',
        payload: {},
      }),
    ).rejects.toMatchObject({ code: 'broker_permission_denied' });
    expect(relay).not.toHaveBeenCalled();
  });

  it.each(['seed.cloud.relay', 'seed.cloud.relay.stream.start'])(
    'does not impose a second 1 MiB limit on %s',
    async (service) => {
      const relay = vi.fn(async () => ({ payload: {} }));
      const startRelayStream = vi.fn(async () => ({ stream_id: 'c14cb3bb-cc6c-4009-b1d9-7ebae4b00694' }));
      const runtime = relayRuntime({ relay, startRelayStream });
      await Reflect.get(runtime, 'invokePluginBroker').call(runtime, 'com.example.plugin', service, {
        call_id: 'a9505c1e-9f5d-4658-a3e1-594a8bab2432',
        capability_id: 'hosted_models',
        method: 'complete',
        payload: { text: '内容'.repeat(200_000) },
      });
      expect(service === 'seed.cloud.relay' ? relay : startRelayStream).toHaveBeenCalledOnce();
    },
  );

  it('cancels an automatically prepared invocation if transport rejects an oversized request', async () => {
    const callId = 'a9505c1e-9f5d-4658-a3e1-594a8bab2432';
    const failure = Object.assign(new Error('Request exceeds transport limit'), {
      code: 'credit_relay_request_too_large',
    });
    const cancel = vi.fn(async () => undefined);
    const runtime = relayRuntime({
      prepare: vi.fn(async () => ({ billable: true, call_id: callId })),
      relay: vi.fn(async () => {
        throw failure;
      }),
      startRelayStream: vi.fn(),
      cancel,
    });
    await expect(
      Reflect.get(runtime, 'invokePluginBroker').call(runtime, 'com.example.plugin', 'seed.cloud.relay', {
        capability_id: 'hosted_models',
        method: 'complete',
        payload: { model: 'example/model' },
      }),
    ).rejects.toBe(failure);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(callId);
  });

  it('accepts a code-registered relay at bootstrap and refuses missing or withdrawn registrations', async () => {
    const plugin = {
      package_id: 'com.example.plugin',
      api_version: 2,
      version: '1.0.0',
      permissions: ['cloud.relay'],
      capabilities: [],
    };
    const catalog = new PluginCapabilityCatalog(),
      relay = vi.fn(async () => ({ payload: {} }));
    const runtime = Object.assign(Object.create(SeedRuntime.prototype), {
      runtimePlugins: [plugin],
      pluginCapabilityCatalog: catalog,
      creditBilling: { relay },
    });
    const broker = (service: string, args: Record<string, unknown>) =>
      Reflect.get(runtime, 'invokePluginBroker').call(runtime, plugin.package_id, service, args);
    const request = {
      call_id: 'a9505c1e-9f5d-4658-a3e1-594a8bab2432',
      capability_id: 'hosted_models',
      method: 'complete',
      payload: {},
    };
    await expect(broker('seed.cloud.relay', request)).rejects.toThrow();
    await broker('seed.plugin-capabilities', {
      definitions: [
        {
          id: 'hosted_models',
          version: 1,
          exposure: 'local',
          methods: [
            {
              name: 'complete',
              risk: 'read',
              annotations: {
                'billing.settlement': 'cloud_relay',
                'billing.relay_template': 'model_chat',
                'billing.product': 'model.generate',
              },
            },
          ],
        },
      ],
    });
    await expect(broker('seed.cloud.relay', request)).resolves.toEqual({ payload: {} });
    expect(relay).toHaveBeenCalledOnce();
    catalog.remove(plugin.package_id);
    await expect(broker('seed.cloud.relay', request)).rejects.toThrow();
    expect(relay).toHaveBeenCalledOnce();
  });
});
