// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  Component,
  Events,
  Plugin,
  PluginService,
  SeedPluginError,
  PluginSettingTab,
  Setting,
  createPluginI18n,
  createPluginResources,
  type App,
  type PluginManifest,
} from '@motus-ai/seed-sdk';

const manifest: PluginManifest = {
  id: 'com.example.fixture',
  name: 'Fixture',
  version: '1.0.0',
  minAppVersion: '0.2.15',
  description: 'Fixture',
  author: 'Example',
};
function app(): App {
  let revision = 0;
  let data: unknown = null;
  return {
    events: new Events(),
    locale: 'en-US',
    theme: 'light',
    i18n: createPluginI18n(),
    data: {
      load: async () => ({ revision, data }),
      save: async (next, expected) => {
        if (expected !== revision) throw new Error('data_conflict');
        return { revision: ++revision, data: (data = structuredClone(next)) };
      },
    },
    service: { call: vi.fn() },
    addSettingTab: () => vi.fn(),
    registerView: () => vi.fn(),
    addCommand: () => vi.fn(),
    addToolbarItem: () => ({ element: document.createElement('button'), dispose: vi.fn() }),
    addStatusBarItem: () => ({ element: document.createElement('span'), dispose: vi.fn() }),
  };
}

describe('public plugin lifecycle', () => {
  it('cleans partial onload failures, in reverse order, once', async () => {
    const calls: string[] = [];
    class Failed extends Component {
      override onload() {
        this.register(() => {
          calls.push('first');
        });
        this.register(async () => {
          await Promise.resolve();
          calls.push('second');
        });
        throw new Error('startup failed');
      }
      override onunload() {
        calls.push('unload');
      }
    }
    const component = new Failed();
    await expect(component.load()).rejects.toThrow('startup failed');
    await component.unload();
    await component.unload();
    expect(calls).toEqual(['unload', 'second', 'first']);
    await expect(component.load()).rejects.toThrow('cannot be reused');
  });

  it('drains initialization before unload, including late registrations', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cleanup = vi.fn();
    class Slow extends Component {
      override async onload() {
        await gate;
        this.register(cleanup);
      }
    }
    const component = new Slow();
    const loading = component.load();
    const stopping = component.unload();
    release();
    await expect(loading).rejects.toThrow('unloaded');
    await stopping;
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('continues cleanup after a disposer fails and unloads children', async () => {
    const cleanup = vi.fn();
    const child = new Component();
    child.register(cleanup);
    const parent = new Component();
    parent.addChild(child);
    parent.register(() => {
      throw new Error('cleanup failed');
    });
    await parent.load();
    await expect(parent.unload()).rejects.toThrow('cleanup failed');
    expect(cleanup).toHaveBeenCalledTimes(1);
    await parent.unload().catch(() => undefined);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('removes event, DOM and timer registrations on stop', async () => {
    vi.useFakeTimers();
    const component = new Component(),
      events = new Events(),
      callback = vi.fn();
    const button = document.createElement('button');
    component.registerEvent(events.on('change', callback));
    component.registerDomEvent(button, 'click', callback);
    component.registerInterval(setInterval(callback, 10));
    await component.load();
    events.trigger('change');
    button.click();
    vi.advanceTimersByTime(10);
    expect(callback).toHaveBeenCalledTimes(3);
    await component.unload();
    events.trigger('change');
    button.click();
    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('preserves subscriber order after one fails; refs are owner-scoped', async () => {
    const errors: unknown[] = [];
    class TestEvents extends Events {
      protected override onError(error: unknown) {
        errors.push(error);
      }
    }
    const a = new TestEvents(),
      b = new TestEvents(),
      calls: number[] = [];
    a.on('event', () => {
      calls.push(1);
      throw new Error('listener');
    });
    const ref = a.on('event', () => {
      calls.push(2);
    });
    b.offref(ref);
    a.trigger('event');
    expect(calls).toEqual([1, 2]);
    expect(errors).toHaveLength(1);
    a.offref(ref);
    a.trigger('event');
    expect(calls).toEqual([1, 2, 1]);
  });
});

describe('plugin data and view ownership', () => {
  it('addresses only declared assets and directories without query or traversal escapes', () => {
    const resources = createPluginResources('file:///installed/example/main.js', [
      'assets/icon.svg',
      'skills/one/SKILL.md',
      'assets/my icon.svg',
    ]);
    expect(resources.url('skills/')).toBe('file:///installed/example/skills/');
    expect(resources.url('assets/my icon.svg')).toBe('file:///installed/example/assets/my%20icon.svg');
    for (const path of [
      '../secret',
      '/secret',
      'assets/../secret',
      'assets/icon.svg?copy',
      'assets/icon.svg#fragment',
      'data:payload',
      'unknown/',
    ])
      expect(() => resources.url(path)).toThrow('not declared');
  });
  it('namespaces commands and removes each registration exactly once', async () => {
    const host = app(),
      stop = vi.fn(),
      register = vi.spyOn(host, 'addCommand').mockReturnValue(stop);
    const plugin = new Plugin(host, manifest);
    expect(plugin.addCommand({ id: 'do-work', name: 'Work' }).id).toBe(manifest.id + ':do-work');
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ id: manifest.id + ':do-work' }));
    expect(() => plugin.addCommand({ id: 'do-work', name: 'Duplicate' })).toThrow('duplicate');
    plugin.removeCommand('do-work');
    await plugin.unload();
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it('rejects stale concurrent saves rather than overwriting another view instance', async () => {
    const host = app(),
      first = new Plugin(host, manifest),
      second = new Plugin(host, manifest);
    await first.loadData();
    await second.loadData();
    await first.saveData({ enabled: false, count: 0, text: '', unknown: 'preserved' });
    await expect(second.saveData({ enabled: true })).rejects.toThrow('data_conflict');
    expect(await second.loadData()).toEqual({ enabled: false, count: 0, text: '', unknown: 'preserved' });
  });

  it('allows arbitrary custom settings without any host control registration', async () => {
    const host = app(),
      plugin = new Plugin(host, manifest),
      cleanup = vi.fn();
    class Tab extends PluginSettingTab {
      override display() {
        const setting = this.addChild(new Setting(this.containerEl).setName('Custom'));
        const custom = document.createElement('canvas');
        setting.controlEl.append(custom);
        this.register(cleanup);
      }
    }
    const tab = new Tab(host, plugin);
    plugin.addSettingTab(tab);
    await plugin.load();
    await tab.show();
    expect(tab.containerEl.querySelector('canvas')).not.toBeNull();
    await plugin.unload();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('renders existing false/zero/empty data without automatic default writes', async () => {
    const host = app(),
      plugin = new Plugin(host, manifest);
    plugin.settings = { enabled: false, count: 0, text: '', invalid: 'old' };
    const save = vi.spyOn(plugin, 'saveData');
    class Tab extends PluginSettingTab {
      override display() {
        const data = plugin.settings as Record<string, unknown>;
        this.addChild(new Setting(this.containerEl).setName('Enabled')).addToggle((control) =>
          control.setValue(Boolean(data.enabled)),
        );
        this.addChild(new Setting(this.containerEl).setName('Count')).addText((control) => {
          control.inputEl.type = 'number';
          control.setValue(String(data.count ?? 42));
        });
        this.addChild(new Setting(this.containerEl).setName('Text')).addText((control) =>
          control.setValue(String(data.text ?? 'default')),
        );
      }
    }
    const tab = new Tab(host, plugin);
    await tab.show();
    expect((tab.containerEl.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(false);
    expect((tab.containerEl.querySelector('input[type=number]') as HTMLInputElement).value).toBe('0');
    expect((tab.containerEl.querySelector('input[type=text]') as HTMLInputElement).value).toBe('');
    expect(save).not.toHaveBeenCalled();
    await tab.hide();
  });

  it('stops private service methods and aborts work when its owning instance unloads', async () => {
    const service = new PluginService({} as import('@motus-ai/seed-sdk').PluginServices, manifest);
    let observed: AbortSignal | undefined;
    service.registerMethod('custom', (_args, signal) => {
      observed = signal;
      return 'ok';
    });
    await service.load();
    expect(await service.call('custom', {})).toBe('ok');
    await service.unload();
    expect(observed?.aborted).toBe(true);
    await expect(service.call('custom', {})).rejects.toThrow('not running');
  });

  it('binds code-registered functions to the service lifetime and rejects late registrations', async () => {
    const cleanup = vi.fn(),
      registerCapability = vi.fn(() => cleanup);
    const service = new PluginService(
      { registerCapability } as unknown as import('@motus-ai/seed-sdk').PluginServices,
      manifest,
    );
    const definition = { id: 'probe', version: 1, methods: [{ name: 'read_probe', risk: 'read' as const }] };
    service.addCapability(definition, { invoke: async () => 'ok' });
    await service.load();
    await service.unload();
    await service.unload();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(() => service.addCapability(definition, { invoke: async () => 'late' })).toThrow('stopped');
    expect(registerCapability).toHaveBeenCalledTimes(1);
  });

  it('removes the old manifest-only registry without dropping capability event streams', async () => {
    const register = vi.fn(),
      list = vi.fn(async () => []),
      invoke = vi.fn(async () => null);
    const stream = vi.fn(async function* (_input: unknown) {
      yield { event: 'streamed' };
    });
    const service = new PluginService(
      {
        capabilities: { register, list, invoke, stream },
      } as unknown as import('@motus-ai/seed-sdk').PluginServices,
      manifest,
    );
    expect(service.app.capabilities).not.toHaveProperty('register');
    expect(service.app).not.toHaveProperty('configuration');
    expect(service.app).not.toHaveProperty('management');
    const input = { capability: 'probe', method: 'observe', arguments: {}, request_id: 'event-stream' };
    const events = [];
    for await (const event of service.app.capabilities.stream!(input)) events.push(event);
    expect(events).toEqual([{ event: 'streamed' }]);
    expect(stream).toHaveBeenCalledExactlyOnceWith(input);
  });

  it('preserves plugin cancellation errors and combines request cancellation with service unload', async () => {
    let handler!: import('@motus-ai/seed-sdk').SeedCapabilityHandler;
    const service = new PluginService(
      {
        registerCapability: (
          _definition: import('@motus-ai/seed-sdk').CapabilityDefinition,
          registered: import('@motus-ai/seed-sdk').SeedCapabilityHandler,
        ) => {
          handler = registered;
          return () => undefined;
        },
      } as unknown as import('@motus-ai/seed-sdk').PluginServices,
      manifest,
    );
    let observed: AbortSignal | undefined;
    service.addCapability(
      { id: 'probe', version: 1, methods: [{ name: 'read_probe', risk: 'read' }] },
      {
        invoke: async (_method, invocation) => {
          observed = invocation.signal;
          if (observed?.aborted) throw new SeedPluginError('probe_cancelled', 'Cancelled by the plugin.');
          return 'ok';
        },
      },
    );
    await service.load();
    await expect(
      handler.invoke('read_probe', { request_id: 'cancelled', arguments: {}, signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: 'probe_cancelled' });
    const request = new AbortController();
    await handler.invoke('read_probe', { request_id: 'active', arguments: {}, signal: request.signal });
    expect(observed?.aborted).toBe(false);
    await service.unload();
    expect(observed?.aborted).toBe(true);
    expect(request.signal.aborted).toBe(false);
    await expect(handler.invoke('read_probe', { request_id: 'late', arguments: {} })).rejects.toThrow('unloaded');
  });

  it('limits private view calls to its own registered methods and propagates cancellation', async () => {
    const registerCapability = vi.fn(() => vi.fn());
    const service = new PluginService(
      { registerCapability } as unknown as import('@motus-ai/seed-sdk').PluginServices,
      manifest,
    );
    let observed: AbortSignal | undefined;
    service.addCapability(
      { id: 'probe', version: 1, methods: [{ name: 'read', risk: 'read' }] },
      {
        invoke: async (_method, invocation) => {
          observed = invocation.signal;
          return invocation.arguments;
        },
      },
    );
    expect(() => service.registerMethod('capability.invoke', () => null)).toThrow('Invalid');
    await service.load();
    await expect(
      service.call('capability.invoke', { capability: 'other', method: 'read', arguments: {} }),
    ).rejects.toThrow('Unknown owned');
    await expect(
      service.call('capability.invoke', { capability: 'probe', method: 'write', arguments: {} }),
    ).rejects.toThrow('Unknown owned');
    await expect(
      service.call('capability.invoke', { capability: 'probe', method: 'read', arguments: [] }),
    ).rejects.toThrow('must be an object');
    const controller = new AbortController();
    expect(
      await service.call(
        'capability.invoke',
        { capability: 'probe', method: 'read', arguments: { valid: true } },
        controller.signal,
      ),
    ).toEqual({ valid: true });
    controller.abort();
    expect(observed?.aborted).toBe(true);
    await service.unload();
    await expect(
      service.call('capability.invoke', { capability: 'probe', method: 'read', arguments: {} }),
    ).rejects.toThrow('not running');
  });
});
