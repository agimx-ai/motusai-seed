// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Plugin, PluginSettingTab, View } from '@motus-ai/seed-sdk';
import { PluginViewController } from './plugin-view-controller';
import { pluginSidebar } from './plugin-sidebar';
import type { PluginBreadcrumbState } from './plugin-navigation';
import type { PluginNavigationHandle } from '@motus-ai/seed-sdk';

const manifest = {
  id: 'com.example.custom',
  name: 'Custom',
  version: '1.0.0',
  minAppVersion: '0.2.15',
  description: 'Fixture',
  author: 'Example',
};
function fixture() {
  const surface = {
    toolbar: document.createElement('nav'),
    content: document.createElement('main'),
    status: document.createElement('footer'),
  };
  const report = vi.fn();
  const navigation = vi.fn<(state: PluginBreadcrumbState | undefined) => void>();
  const controller = new PluginViewController(
    surface,
    {
      data: {
        load: async () => ({ revision: 0, data: null }),
        save: async (data, revision) => ({ revision: revision + 1, data }),
      },
      service: { call: vi.fn() },
    },
    { locale: 'en-US', theme: 'light' },
    report,
    navigation,
  );
  return { surface, report, controller, navigation };
}

describe('plugin view controller lifecycle', () => {
  it('opens only its own settings with scoped parameters and clears them on a normal visit', async () => {
    const { controller, surface } = fixture();
    const route = vi.fn();
    const unsubscribe = pluginSidebar.onOpenSettings(route);
    class Tab extends PluginSettingTab {
      display() { this.containerEl.textContent = this.pageParams?.item ?? 'root'; }
    }
    class Example extends Plugin {
      onload() { this.addSettingTab(new Tab(this.app, this)); }
    }
    try {
      await controller.start(Example, manifest);
      const openSettings = controller.app.navigation!.openSettings!;
      expect(openSettings({ item: 'detail' })).toBe(false);
      await controller.show();
      expect(() => openSettings({ invalidKey: 'detail' })).toThrow('Invalid plugin page parameters.');
      const params = { item: 'detail' };
      expect(openSettings(params)).toBe(true);
      params.item = 'changed';
      expect(route).toHaveBeenCalledExactlyOnceWith(manifest.id, { params: { item: 'detail' } });
      await controller.show(route.mock.calls[0][1]);
      expect(surface.content.textContent).toBe('detail');
      await controller.hide();
      await controller.show();
      expect(surface.content.textContent).toBe('root');
    } finally {
      unsubscribe();
      await controller.stop();
    }
  });

  it('registers navigation before display and opens plugin-owned views with route state', async () => {
    const { controller, surface } = fixture();
    const close = vi.fn();
    class Page extends View {
      private room = '';
      getViewType() { return 'room'; }
      getDisplayText() { return 'Room'; }
      async setState(state: Record<string, unknown>) { this.room = String(state.room); }
      async onOpen() { this.containerEl.textContent = this.room; }
      async onClose() { close(); }
    }
    class Example extends Plugin {
      onload() {
        this.registerView('room', (host) => new Page(this.app, host));
        this.addNavigationItem({ id: 'room-one', title: 'One', parent: { host: 'activity' }, view: 'room', params: { room: 'one' } });
      }
    }
    await controller.start(Example, manifest);
    expect(surface.content.textContent).toBe('');
    await controller.show({ view: 'room', params: { room: 'one' } });
    expect(surface.content.textContent).toBe('one');
    await controller.show({ view: 'room', params: { room: 'two' } });
    expect(close).toHaveBeenCalledOnce();
    expect(surface.content.textContent).toBe('two');
    await controller.hide();
    await controller.show({ view: 'room', params: { room: 'two' } });
    expect(surface.content.textContent).toBe('two');
    await controller.stop();
    expect(() => controller.app.sidebar!.register({ id: 'late', title: 'Late' })).toThrow('stopped');
  });
  it('clears page navigation on settings redisplay, view switching, hide and stop', async () => {
    const { controller, surface, navigation } = fixture();
    const handles: PluginNavigationHandle[] = [];
    let tab!: Tab;
    class Tab extends PluginSettingTab {
      display() {
        const handle = this.app.navigation!.create({ signal: this.signal, onNavigate: vi.fn() });
        this.register(handle.dispose);
        handle.setPath([{ id: 'settings-detail', label: 'Settings detail' }]);
        handles.push(handle);
      }
    }
    class Extra extends View {
      getViewType() { return 'extra'; }
      getDisplayText() { return 'Extra'; }
      async onOpen() {
        const handle = this.app.navigation!.create({ signal: this.signal, onNavigate: vi.fn() });
        handle.setPath([{ id: 'view-detail', label: 'View detail' }]);
        handles.push(handle);
      }
    }
    class Custom extends Plugin {
      onload() {
        this.addSettingTab(tab = new Tab(this.app, this));
        this.registerView('extra', (host) => new Extra(this.app, host));
      }
    }
    await controller.start(Custom, manifest);
    expect(() => controller.app.navigation!.create({ signal: new AbortController().signal, onNavigate: vi.fn() })).toThrow('visible page');
    await controller.show();
    await tab.update();
    expect(() => handles[0].setPath([])).toThrow('no longer active');
    surface.toolbar.querySelectorAll('button')[1].click();
    await vi.waitFor(() => expect(handles).toHaveLength(3));
    expect(navigation.mock.lastCall?.[0]?.path[0].id).toBe('view-detail');
    expect(() => handles[1].setPath([])).toThrow('no longer active');
    await controller.hide();
    expect(navigation).toHaveBeenLastCalledWith(undefined);
    expect(() => handles[2].setPath([])).toThrow('no longer active');
    await controller.show();
    await controller.stop();
    expect(navigation).toHaveBeenLastCalledWith(undefined);
    expect(() => handles[3].setPath([])).toThrow('no longer active');
  });
  it('omits redundant navigation for one settings page while preserving view choices and commands', async () => {
    const { controller, surface } = fixture();
    let plugin!: Custom;
    class Tab extends PluginSettingTab {
      display() {
        this.containerEl.textContent = 'Settings';
      }
    }
    class ExtraView extends View {
      getViewType() {
        return 'extra';
      }
      getDisplayText() {
        return 'Extra';
      }
    }
    class Custom extends Plugin {
      onload() {
        plugin = this;
        this.addSettingTab(new Tab(this.app, this));
      }
    }
    await controller.start(Custom, manifest);
    await controller.show();
    expect(surface.content.textContent).toBe('Settings');
    expect(surface.toolbar.hidden).toBe(true);
    expect(surface.toolbar.querySelector('button')!.hidden).toBe(true);
    const disposeSidebarView = controller.app.registerView('sidebar-room', (host) => new ExtraView(controller.app, host), { toolbar: false });
    expect(surface.toolbar.hidden).toBe(true);
    await controller.show({ view: 'sidebar-room' });
    expect(surface.toolbar.hidden).toBe(true);
    await controller.show();
    expect(surface.toolbar.hidden).toBe(true);
    const disposeView = controller.app.registerView('extra', (host) => new ExtraView(controller.app, host));
    expect(surface.toolbar.hidden).toBe(false);
    expect([...surface.toolbar.querySelectorAll('button')].every((button) => !button.hidden)).toBe(true);
    await disposeView();
    expect(surface.toolbar.hidden).toBe(true);
    await disposeSidebarView();
    plugin.addCommand({ id: 'run', name: 'Run', callback: vi.fn() });
    expect(surface.toolbar.hidden).toBe(false);
    expect(
      [...surface.toolbar.querySelectorAll('button')]
        .filter((button) => !button.hidden)
        .map((button) => button.textContent),
    ).toEqual(['Run']);
    await controller.stop();
    expect(surface.toolbar.children).toHaveLength(0);
  });
  it('renders toolbar icons and removes their DOM and listeners when unloaded', async () => {
    const { controller, surface } = fixture();
    const click = vi.fn();
    class Custom extends Plugin {
      onload() {
        this.addRibbonIcon('terminal', 'Open terminal', click);
      }
    }
    await controller.start(Custom, manifest);
    await vi.waitFor(() => expect(surface.toolbar.querySelector('svg')).not.toBeNull());
    const button = surface.toolbar.querySelector('button')!;
    expect(button.textContent).toBe('Open terminal');
    button.click();
    expect(click).toHaveBeenCalledTimes(1);
    await controller.stop();
    expect(surface.toolbar.childElementCount).toBe(0);
    button.click();
    expect(click).toHaveBeenCalledTimes(1);
  });
  it('loads the controller before showing view, hides only display resources, and never auto-executes commands', async () => {
    const { controller, surface } = fixture();
    const load = vi.fn(),
      unload = vi.fn(),
      display = vi.fn(),
      hide = vi.fn(),
      execute = vi.fn();
    class Tab extends PluginSettingTab {
      display() {
        display();
        this.containerEl.textContent = 'Custom DOM';
        this.register(hide);
      }
    }
    class Custom extends Plugin {
      onload() {
        load();
        this.register(unload);
        this.addSettingTab(new Tab(this.app, this));
        this.addCommand({ id: 'action', name: 'Run', callback: execute });
      }
    }
    await controller.start(Custom, manifest);
    expect(load).toHaveBeenCalledTimes(1);
    expect(display).not.toHaveBeenCalled();
    await controller.show();
    await controller.show();
    expect(display).toHaveBeenCalledTimes(1);
    expect(surface.content.textContent).toBe('Custom DOM');
    expect(execute).not.toHaveBeenCalled();
    await controller.hide();
    expect(hide).toHaveBeenCalledTimes(1);
    expect(unload).not.toHaveBeenCalled();
    await controller.show();
    expect(display).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(1);
    await controller.stop();
    await controller.stop();
    expect(unload).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledTimes(2);
    expect(surface.toolbar.children).toHaveLength(0);
  });

  it('does not invoke a command when a command-only surface opens', async () => {
    const { controller } = fixture(),
      execute = vi.fn();
    class Custom extends Plugin {
      onload() {
        this.addCommand({ id: 'delete', name: 'Delete', callback: execute });
      }
    }
    await controller.start(Custom, manifest);
    await controller.show();
    expect(execute).not.toHaveBeenCalled();
    await controller.stop();
  });

  it('unloads a newly created view on navigation, failed onOpen and plugin stop', async () => {
    const { controller, surface, report } = fixture(),
      close = vi.fn();
    let shouldFail = false;
    class CustomView extends View {
      getViewType() {
        return 'custom';
      }
      getDisplayText() {
        return 'Custom View';
      }
      async onOpen() {
        if (shouldFail) throw new Error('view failed');
        this.containerEl.textContent = 'View content';
      }
      async onClose() {
        close();
      }
    }
    class Custom extends Plugin {
      onload() {
        this.registerView('custom', (host) => new CustomView(this.app, host));
      }
    }
    await controller.start(Custom, manifest);
    await controller.show();
    surface.toolbar.querySelector('button')!.click();
    await vi.waitFor(() => expect(surface.content.textContent).toBe('View content'));
    await controller.hide();
    expect(close).toHaveBeenCalledTimes(1);
    shouldFail = true;
    surface.toolbar.querySelector('button')!.click();
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'view failed' })));
    expect(close).toHaveBeenCalledTimes(2);
    expect(surface.content.children).toHaveLength(0);
    await controller.stop();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('drains an in-flight display and fences queued navigation when stopped', async () => {
    const { controller, surface } = fixture(),
      cleanup = vi.fn();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const displaying = new Promise<void>((resolve) => {
      entered = resolve;
    });
    class Tab extends PluginSettingTab {
      async display() {
        entered();
        await gate;
        this.containerEl.textContent = 'late';
        this.register(cleanup);
      }
    }
    class Custom extends Plugin {
      onload() {
        this.addSettingTab(new Tab(this.app, this));
      }
    }
    await controller.start(Custom, manifest);
    const showing = controller.show();
    await displaying;
    const stopping = controller.stop();
    release();
    await showing;
    await stopping;
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(surface.content.children).toHaveLength(0);
    expect(() => controller.show()).toThrow('stopped');
  });

  it('cleans partial initialization and propagates appearance only to the owning app', async () => {
    const a = fixture(),
      b = fixture(),
      cleanup = vi.fn();
    class Failed extends Plugin {
      onload() {
        this.addStatusBarItem().textContent = 'partial';
        this.register(cleanup);
        throw new Error('initialization failed');
      }
    }
    await expect(a.controller.start(Failed, manifest)).rejects.toThrow('initialization failed');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(a.surface.status.children).toHaveLength(0);
    a.controller.setAppearance({ locale: 'zh-Hans', theme: 'dark' });
    expect(a.controller.app.theme).toBe('dark');
    expect(b.controller.app.theme).toBe('light');
    await b.controller.stop();
  });
});
