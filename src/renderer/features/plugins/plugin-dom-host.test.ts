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
  async display() {
    await state.display();
    state.copy.mockImplementation(() => this.app.clipboard?.writeText('Plugin-owned clipboard text'));
    this.containerEl.textContent = 'Plugin-owned content';
    this.containerEl.dataset.installationId = this.app.installationId;
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
    installationId: 'installation-' + id,
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
  const loading = vi.fn();
  return {
    container,
    error,
    loading,
    configuration,
    show: () => {
      const release = mountPluginDom(id, container, error, loading);
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
  it('keeps loading until the plugin has finished displaying its initial content', async () => {
    const { container, loading, show } = fixture('com.example.loading');
    let finish!: () => void;
    state.display.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    show();
    expect(loading).toHaveBeenLastCalledWith(true);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(loading).not.toHaveBeenCalledWith(false);
    finish();
    await vi.waitFor(() => expect(loading).toHaveBeenLastCalledWith(false));
    expect(container.textContent).toContain('Plugin-owned content');
  });

  it('ends loading on a real mount failure instead of spinning indefinitely', async () => {
    const { error, loading, show } = fixture('com.example.failed');
    const failure = new Error('Backend activation failed');
    vi.mocked(window.motusSeed.mountPluginView).mockRejectedValueOnce(failure);
    show();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(failure));
    expect(loading.mock.calls.map(([value]) => value)).toEqual([true, false]);
  });

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
    expect(container.querySelector('[data-installation-id]')?.getAttribute('data-installation-id')).toBe('installation-com.example.dom');
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
  });
  it('fences stale async mounting after navigation and does not reinsert detached content', async () => {
    const { container, error, loading, show } = fixture('com.example.race');
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
    expect(loading).not.toHaveBeenCalledWith(false);
    show();
    await vi.waitFor(() => expect(state.display).toHaveBeenCalledTimes(1));
  });
  it('replaces withdrawn stylesheet loading immediately without waiting for the old timeout', async () => {
    const { container, configuration, error, loading, show } = fixture('com.example.styles', 'seed-plugin://styles/styles.css');
    show();
    await vi.waitFor(() =>
      expect(document.querySelector('link[href="seed-plugin://styles/styles.css"]')).not.toBeNull(),
    );
    configuration.generation = 'new-styles';
    configuration.styleUrl = 'seed-plugin://new-styles/styles.css';
    for (const listener of [...listeners]) listener({ token, type: 'stop' });
    await vi.waitFor(() => expect(document.querySelector('link[href="seed-plugin://new-styles/styles.css"]')).not.toBeNull());
    expect(loading).not.toHaveBeenCalledWith(false);
    document.querySelector('link[href="seed-plugin://new-styles/styles.css"]')!.dispatchEvent(new Event('load'));
    await vi.waitFor(() => expect(container.textContent).toContain('Plugin-owned content'));
    expect(error).not.toHaveBeenCalled();
    expect(document.querySelector('link[href="seed-plugin://styles/styles.css"]')).toBeNull();
    expect(state.load).toHaveBeenCalledOnce();
    expect(loading).toHaveBeenLastCalledWith(false);
  });

  it('remounts an open page after update without navigation or a changed React revision', async () => {
    const { container, configuration, error, loading, show } = fixture('com.example.visible-update');
    show();
    await vi.waitFor(() => expect(state.display).toHaveBeenCalledOnce());
    const previousToken = token;
    configuration.generation = 'updated-generation';
    configuration.entryUrl = 'seed-plugin://updated-generation/main.js';
    for (const listener of [...listeners]) listener({ token: previousToken, type: 'stop' });
    expect(loading).toHaveBeenLastCalledWith(true);
    await vi.waitFor(() => expect(state.display).toHaveBeenCalledTimes(2));
    expect(container.textContent).toContain('Plugin-owned content');
    expect(token).not.toBe(previousToken);
    expect(state.unload).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(loading).toHaveBeenLastCalledWith(false));
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
