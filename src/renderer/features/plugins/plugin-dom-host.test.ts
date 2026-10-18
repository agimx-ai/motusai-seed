// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Plugin, PluginSettingTab } from '@motus-ai/seed-sdk';
import type { PluginViewEvent } from '../../../shared/plugin-view';
import { mountPluginDom } from './plugin-dom-host';

const state = vi.hoisted(() => ({ load: vi.fn(), unload: vi.fn(), display: vi.fn(), hide: vi.fn(), copy: vi.fn() }));
vi.mock('../../../shared/plugin-bundle', async (original) => {
  const actual = await original<typeof import('../../../shared/plugin-bundle')>();
  return { ...actual, loadPluginBundle: async () => ({ seedPluginBundleVersion: 2, loadView: () => TestPlugin }) };
});
class TestTab extends PluginSettingTab {
  display() {
    state.display();
    state.copy.mockImplementation(() => this.app.clipboard?.writeText('Plugin-owned clipboard text'));
    this.containerEl.textContent = 'Plugin-owned content';
    this.register(state.hide);
  }
}
class TestPlugin extends Plugin {
  onload() {
    state.load();
    this.register(state.unload);
    this.addSettingTab(new TestTab(this.app, this));
  }
}
const listeners = new Set<(event: PluginViewEvent) => void>();
const releases: Array<() => void> = [];
let token = '';
function fixture(id: string, styleUrl?: string) {
  const container = document.createElement('section');
  document.body.append(container);
  const configuration = {
    generation: id,
    entryUrl: 'seed-plugin://' + id + '/main.js',
    manifest: { id, name: 'Test', version: '1.0.0', minAppVersion: '0.2.15', author: 'Test', description: 'Test' },
    locale: 'en-US',
    theme: 'light' as const,
    ...(styleUrl ? { styleUrl } : {}),
  };
  window.motusSeed = {
    mountPluginView: vi.fn(async (input) => {
      token = input.token;
      return structuredClone(configuration);
    }),
    unmountPluginView: vi.fn(async () => {}),
    sendPluginViewMessage: vi.fn(async () => {}),
    onPluginViewEvent: (listener: (event: PluginViewEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as any;
  window.motusWindow = { getPathForFile: vi.fn(), copyText: vi.fn(async () => {}) } as any;
  const error = vi.fn();
  return {
    container,
    error,
    configuration,
    show: () => {
      const release = mountPluginDom(id, container, error);
      releases.push(release);
      return release;
    },
  };
}
afterEach(async () => {
  for (const listener of [...listeners]) listener({ token, type: 'stop' });
  releases.splice(0).forEach((release) => release());
  await vi.waitFor(() => expect(listeners.size).toBe(0));
  await vi.waitFor(() => expect(state.unload).toHaveBeenCalledTimes(state.load.mock.calls.length));
  document.body.replaceChildren();
  vi.clearAllMocks();
});
describe('trusted frontend DOM mounting', () => {
  it('provides generic write-only clipboard access and fences it after runtime withdrawal', async () => {
    const { container, show } = fixture('com.example.clipboard');
    show();
    await vi.waitFor(() => expect(container.textContent).toContain('Plugin-owned content'));
    await state.copy();
    expect(window.motusWindow.copyText).toHaveBeenCalledExactlyOnceWith('Plugin-owned clipboard text');
    for (const listener of listeners) listener({ token, type: 'stop' });
    await expect(state.copy()).rejects.toThrow('Plugin DOM runtime stopped');
    expect(window.motusWindow.copyText).toHaveBeenCalledTimes(1);
  });
  it('mounts into the real document with natural height and no frame, observer or wheel forwarding', async () => {
    const { container, error, show } = fixture('com.example.dom');
    show();
    await vi.waitFor(() => expect(container.textContent).toContain('Plugin-owned content'));
    expect(error).not.toHaveBeenCalled();
    expect(container.querySelector('[data-plugin-view-owner]')?.ownerDocument).toBe(document);
    expect(container.querySelector('iframe, webview')).toBeNull();
    expect(container.style.height).toBe('');
    expect(window.motusSeed.mountPluginView).toHaveBeenCalledWith({
      pluginId: 'com.example.dom',
      token: expect.any(String),
    });
    expect(window.motusSeed.sendPluginViewMessage).not.toHaveBeenCalled();
  });
  it('hides the view without unloading its controller and reuses it on return', async () => {
    const { container, show } = fixture('com.example.navigation');
    const hide = show();
    await vi.waitFor(() => expect(state.display).toHaveBeenCalledTimes(1));
    hide();
    await vi.waitFor(() => expect(state.hide).toHaveBeenCalledTimes(1));
    expect(container.children).toHaveLength(0);
    expect(state.unload).not.toHaveBeenCalled();
    show();
    await vi.waitFor(() => expect(state.display).toHaveBeenCalledTimes(2));
    expect(state.load).toHaveBeenCalledTimes(1);
    for (const listener of listeners) listener({ token, type: 'stop' });
    await vi.waitFor(() => expect(state.unload).toHaveBeenCalledTimes(1));
    expect(container.children).toHaveLength(0);
  });
  it('fences stale async mounting after navigation and does not reinsert detached content', async () => {
    const { container, error, show } = fixture('com.example.race');
    let finish!: (value: unknown) => void;
    const mounted = (window.motusSeed.mountPluginView as any).getMockImplementation();
    (window.motusSeed.mountPluginView as any).mockImplementationOnce(
      (input: any) =>
        new Promise((resolve) => {
          token = input.token;
          finish = async () => resolve(await mounted(input));
        }),
    );
    const hide = show();
    hide();
    finish(undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(container.children).toHaveLength(0);
    expect(state.display).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    show();
    await vi.waitFor(() => expect(state.display).toHaveBeenCalledTimes(1));
  });
  it('cancels pending stylesheet loading and removes resources when its generation is withdrawn', async () => {
    const { container, error, show } = fixture('com.example.styles', 'seed-plugin://styles/styles.css');
    show();
    await vi.waitFor(() =>
      expect(document.querySelector('link[href="seed-plugin://styles/styles.css"]')).not.toBeNull(),
    );
    for (const listener of listeners) listener({ token, type: 'stop' });
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(document.querySelector('link[href="seed-plugin://styles/styles.css"]')).toBeNull();
    expect(container.children).toHaveLength(0);
    expect(state.load).not.toHaveBeenCalled();
  });
  it('replaces a withdrawn hidden generation without requiring a manual reopen', async () => {
    const { container, error, configuration, show } = fixture('com.example.reload');
    const hide = show();
    await vi.waitFor(() => expect(state.display).toHaveBeenCalledTimes(1));
    hide();
    await vi.waitFor(() => expect(state.hide).toHaveBeenCalledTimes(1));
    configuration.generation = 'new-generation';
    configuration.entryUrl = 'seed-plugin://new-generation/main.js';
    show();
    await vi.waitFor(() => expect(state.load).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(container.textContent).toContain('Plugin-owned content'));
    expect(state.unload).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });
});
