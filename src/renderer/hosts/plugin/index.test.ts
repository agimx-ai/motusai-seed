// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginService } from '@motus-ai/seed-sdk';
import type { SandboxPluginConfiguration, SandboxPluginInvocation } from '../../../shared/sandbox-plugin';

let configure: (message: SandboxPluginConfiguration) => void;
let invoke: (message: SandboxPluginInvocation) => void;
let cancel: (requestId: string) => void;
let failOnLoad = false;
const unload = vi.fn();

class Service extends PluginService {
  override async onload() {
    this.register(unload);
    this.addCapability(
      { id: 'probe', version: 1, methods: [{ name: 'echo_probe', risk: 'read' }] },
      { invoke: async (_method, input) => input.arguments },
    );
    this.registerMethod('fail', () => {
      throw new Error('Service failed');
    });
    this.registerMethod('locale', () => this.app.locale);
    this.registerMethod(
      'wait',
      (_args, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        ),
    );
    if (failOnLoad) throw new Error('Loading failed');
  }
}

vi.mock('../../../shared/plugin-bundle', () => ({
  pluginBundle: (value: unknown) => value,
  pluginServiceConstructor: () => Service,
}));

const bridge = {
  ready: vi.fn(),
  configured: vi.fn(),
  result: vi.fn(),
  invokeBroker: vi.fn(async (_token: string, _service: string, _args: Record<string, unknown>) => null),
  onConfigure: vi.fn((listener: typeof configure) => {
    configure = listener;
  }),
  onInvoke: vi.fn((listener: typeof invoke) => {
    invoke = listener;
  }),
  onCancel: vi.fn((listener: typeof cancel) => {
    cancel = listener;
  }),
  onLocale: vi.fn(),
};

function configuration(token = 'owner-token'): SandboxPluginConfiguration {
  return {
    configuration_id: 'configuration',
    plugins: [
      {
        package_id: 'com.example.probe',
        version: '1.0.0',
        broker_token: token,
        api_version: 2,
        locale: 'zh-CN',
        entry_url: 'data:text/javascript,export default {}',
        sdk_manifest: {
          id: 'com.example.probe',
          version: '1.0.0',
          name: 'Probe',
          author: 'Example',
          description: '',
          minAppVersion: '0.2.15',
        },
      },
    ],
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  failOnLoad = false;
  vi.stubGlobal('seedPluginRuntime', bridge);
  await import('./index');
});
afterEach(async () => {
  await configure({ configuration_id: 'stop', plugins: [] });
  vi.unstubAllGlobals();
});

describe('sandbox service registrations and ownership', () => {
  it('registers capabilities from code and attributes failures only to the loaded owner', async () => {
    await configure(configuration());
    expect(bridge.configured).toHaveBeenCalledWith('configuration', true);
    expect(bridge.invokeBroker).toHaveBeenCalledWith('owner-token', 'seed.plugin-capabilities', {
      definitions: [expect.objectContaining({ id: 'probe' })],
    });
    await invoke({
      request_id: 'echo',
      package_id: 'com.example.probe',
      capability: 'probe',
      method: 'echo_probe',
      invocation: { request_id: 'echo', arguments: { text: 'hello' } },
    });
    expect(bridge.result).toHaveBeenCalledWith('echo', true, { text: 'hello' });
    await invoke({
      request_id: 'locale',
      package_id: 'com.example.probe',
      operation: 'service',
      method: 'locale',
      arguments: {},
    });
    expect(bridge.result).toHaveBeenCalledWith('locale', true, 'zh-CN');
    await invoke({
      request_id: 'failure',
      package_id: 'com.example.probe',
      operation: 'service',
      method: 'fail',
      arguments: {},
    });
    expect(bridge.invokeBroker).toHaveBeenCalledWith('owner-token', 'seed.plugin.diagnostic', {
      entry: expect.objectContaining({ event: 'capability.failed', request_id: 'failure', operation: 'service.fail' }),
    });
    bridge.invokeBroker.mockClear();
    await invoke({
      request_id: 'unknown',
      package_id: 'com.example.other',
      operation: 'service',
      method: 'fail',
      arguments: {},
    });
    expect(bridge.invokeBroker).not.toHaveBeenCalled();
  });

  it('does not report a cancelled call as a service failure', async () => {
    await configure(configuration());
    bridge.invokeBroker.mockClear();
    const pending = invoke({
      request_id: 'cancel',
      package_id: 'com.example.probe',
      operation: 'service',
      method: 'wait',
      arguments: {},
    });
    cancel('cancel');
    await pending;
    expect(bridge.result).toHaveBeenCalledWith(
      'cancel',
      false,
      undefined,
      'Plugin call cancelled.',
      'plugin_invoke_error',
      undefined,
    );
    expect(bridge.invokeBroker).not.toHaveBeenCalled();
  });

  it('cleans a failed replacement without retaining the previous diagnostic owner', async () => {
    await configure(configuration());
    failOnLoad = true;
    await configure(configuration('replacement-token'));
    expect(bridge.configured).toHaveBeenCalledWith('configuration', false, 'Loading failed');
    expect(unload).toHaveBeenCalledTimes(2);
    bridge.invokeBroker.mockClear();
    await invoke({
      request_id: 'stale',
      package_id: 'com.example.probe',
      operation: 'service',
      method: 'fail',
      arguments: {},
    });
    expect(bridge.invokeBroker).not.toHaveBeenCalled();
    expect(bridge.result).toHaveBeenCalledWith(
      'stale',
      false,
      undefined,
      'Plugin service is unavailable.',
      'plugin_invoke_error',
      undefined,
    );
  });
});
