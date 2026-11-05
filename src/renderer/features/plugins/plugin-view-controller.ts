import {
  createPluginI18n,
  pluginTranslationLocale,
  Events,
  toast,
  type App,
  type Plugin,
  type PluginManifest,
  type PluginSettingTab,
  type PluginViewOptions,
  type View,
  type ViewHost,
} from '@motus-ai/seed-sdk';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { icons } from 'lucide-react';
import { PluginNavigationController, type PluginBreadcrumbState } from './plugin-navigation';
import { userFacingErrorMessage } from '../../lib/errors';
import { pluginSidebar, type PluginPageTarget } from './plugin-sidebar';

type Surface = { toolbar: HTMLElement; content: HTMLElement; status: HTMLElement };
type Active = { key: object; hide(): Promise<void> };

/** Owns DOM view registrations. Hiding a page never stops the plugin controller or service. */
export class PluginViewController {
  readonly app: App;
  private plugin?: Plugin;
  private readonly tabs: PluginSettingTab[] = [];
  private readonly views = new Map<string, { creator: (host: ViewHost) => View; layout: PluginViewOptions['layout'] }>();
  private readonly viewButtons = new Map<string, HTMLButtonElement>();
  private active?: Active;
  private navigation = Promise.resolve();
  private stopping = false;
  private stoppingWork?: Promise<void>;
  private visible = false;
  private sidebar?: ReturnType<typeof pluginSidebar.attach>;
  private pageTarget?: string;
  private readonly tabButtons = new Map<PluginSettingTab, HTMLButtonElement>();
  private readonly breadcrumbs: PluginNavigationController;

  private refreshTabNavigation() {
    // A sole settings page is already the active page, not an extra navigation choice.
    const showTabs = this.tabs.length + this.viewButtons.size > 1;
    for (const button of this.tabButtons.values()) button.hidden = !showTabs;
    this.surface.toolbar.hidden = ![...this.surface.toolbar.children].some((child) => !(child as HTMLElement).hidden);
  }

  constructor(
    private readonly surface: Surface,
    services: Pick<App, 'data' | 'service' | 'resources' | 'files' | 'clipboard' | 'reloadService'>,
    appearance: Pick<App, 'locale' | 'theme' | 'installationId'>,
    private readonly report: (error: unknown) => void = (error) => {
      toast.error(userFacingErrorMessage(error));
    },
    onNavigationChange: (state: PluginBreadcrumbState | undefined) => void = () => {},
  ) {
    this.breadcrumbs = new PluginNavigationController(
      () => this.visible && !!this.active && !this.stopping,
      onNavigationChange,
      this.report,
    );
    const action = (title: string, callback: () => void) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'seed-button';
      button.textContent = title;
      button.addEventListener('click', callback);
      surface.toolbar.append(button);
      surface.toolbar.hidden = false;
      return {
        element: button,
        dispose: () => {
          button.removeEventListener('click', callback);
          button.remove();
          this.refreshTabNavigation();
        },
      };
    };
    this.app = {
      sidebar: {
        supportsHost: (host) => this.sidebar?.api.supportsHost?.(host) ?? false,
        register: (item) => {
          this.assertActive();
          if (!this.sidebar) throw new Error('Plugin has not started.');
          return this.sidebar.api.register(item);
        },
        open: (id) => {
          this.assertActive();
          if (!this.sidebar) return Promise.resolve(false);
          return this.sidebar.api.open(id);
        },
      },
      navigation: {
        ...this.breadcrumbs.api,
        openSettings: (params) => this.visible && !!this.tabs.length && this.sidebar?.openSettings(params) === true,
      },
      ...appearance,
      ...services,
      events: new Events(),
      i18n: createPluginI18n(undefined, appearance.locale),
      addSettingTab: (tab) => {
        this.assertActive();
        this.tabs.push(tab);
        const item = action(tab.plugin.manifest.name, () => this.schedule(() => this.openTab(tab)));
        this.tabButtons.set(tab, item.element);
        this.refreshTabNavigation();
        return () => {
          const index = this.tabs.indexOf(tab);
          if (index >= 0) this.tabs.splice(index, 1);
          this.tabButtons.delete(tab);
          item.dispose();
        };
      },
      registerView: (type, creator, options) => {
        this.assertActive();
        if (this.views.has(type)) throw new Error('Duplicate view type: ' + type);
        this.views.set(type, { creator, layout: options?.layout });
        const item = options?.toolbar === false ? undefined : action(type, () => this.schedule(() => this.openView(type)));
        if (item) this.viewButtons.set(type, item.element);
        this.refreshTabNavigation();
        return async () => {
          this.views.delete(type);
          this.viewButtons.delete(type);
          item?.dispose();
          if (this.active?.key === creator) await this.closeActive();
        };
      },
      addCommand: (command) => {
        this.assertActive();
        const item = action(command.name, () => {
          try {
            if (command.checkCallback) command.checkCallback(false);
            else if (command.callback) void Promise.resolve(command.callback()).catch(this.report);
          } catch (error) {
            this.report(error);
          }
          refresh();
        });
        const refresh = () => {
          item.element.disabled = command.checkCallback ? command.checkCallback(true) === false : false;
        };
        refresh();
        const ref = this.app.events.on('commands-change', refresh);
        return () => {
          this.app.events.offref(ref);
          item.dispose();
        };
      },
      addToolbarItem: (icon, title, callback) => {
        this.assertActive();
        const name = icon.replace(/(^|-)([a-z])/g, (_match, _dash, letter: string) => letter.toUpperCase());
        const Icon = icons[name as keyof typeof icons];
        if (!Icon) throw new Error('Unknown toolbar icon: ' + icon);
        const item = action(title, callback);
        item.element.title = title;
        const container = document.createElement('span');
        container.setAttribute('aria-hidden', 'true');
        item.element.prepend(container);
        const root = createRoot(container);
        root.render(createElement(Icon, { size: 14, focusable: false }));
        return {
          element: item.element,
          dispose: () => {
            root.unmount();
            item.dispose();
          },
        };
      },
      addStatusBarItem: () => {
        this.assertActive();
        const element = document.createElement('span');
        surface.status.append(element);
        return { element, dispose: () => element.remove() };
      },
    };
  }

  private assertActive() {
    if (this.stopping) throw new Error('Plugin view controller stopped.');
  }
  private schedule(work: () => Promise<void>) {
    void this.enqueue(work).catch(this.report);
  }
  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.navigation
      .catch(() => undefined)
      .then(async () => {
        if (!this.stopping) await work();
      });
    this.navigation = next;
    return next;
  }
  private async closeActive() {
    this.pageTarget = undefined;
    this.breadcrumbs.clear();
    const active = this.active;
    this.active = undefined;
    try {
      await active?.hide();
    } finally {
      this.surface.content.replaceChildren();
    }
  }

  private async openView(type: string, page?: PluginPageTarget) {
    const registration = this.views.get(type);
    if (!registration) throw new Error('Plugin page is not registered: ' + type);
    const { creator, layout } = registration;
    const params = page?.params;
    const edgeToEdge = !!page && layout === 'edge-to-edge';
    const target = JSON.stringify([type, params ?? {}, edgeToEdge]);
    if (this.active?.key === creator && this.pageTarget === target) return;
    await this.closeActive();
    const containerEl = document.createElement('section');
    if (edgeToEdge) containerEl.dataset.pluginViewLayout = 'edge-to-edge';
    this.surface.content.append(containerEl);
    let view: View | undefined;
    const close = async () => {
      if (this.active?.key === creator) this.breadcrumbs.clear();
      try {
        await view?.unload();
      } finally {
        containerEl.remove();
        if (this.active?.key === creator) { this.active = undefined; this.pageTarget = undefined; }
      }
    };
    try {
      const button = this.viewButtons.get(type);
      view = creator({ containerEl, close, setTitle: (title) => { if (button) button.textContent = title; } });
      if (button) button.textContent = view.getDisplayText();
      this.active = { key: creator, hide: close };
      this.pageTarget = target;
      if (params) await view.setState({ ...params });
      await view.load();
    } catch (error) {
      await close();
      throw error;
    }
  }
  private async openTab(tab: PluginSettingTab, params?: Readonly<Record<string, string>>) {
    if (this.active?.key === tab && !params) return;
    await this.closeActive();
    this.active = { key: tab, hide: () => tab.hide() };
    this.surface.content.append(tab.containerEl);
    try {
      await tab.show(params);
    } catch (error) {
      await this.closeActive();
      throw error;
    }
  }

  async start(Constructor: new (app: App, manifest: PluginManifest) => Plugin, manifest: PluginManifest) {
    this.assertActive();
    if (this.plugin) throw new Error('Plugin view controller already started.');
    this.app.i18n = createPluginI18n(manifest.translations, this.app.locale);
    const resources = this.app.resources;
    this.sidebar = pluginSidebar.attach(manifest.id, resources?.url.bind(resources));
    const plugin = (this.plugin = new Constructor(this.app, manifest));
    try {
      await plugin.load();
      this.assertActive();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  show(target?: PluginPageTarget): Promise<void> {
    this.assertActive();
    return this.enqueue(async () => {
      if (this.visible && !target) return;
      this.visible = true;
      try {
        if (target?.view) await this.openView(target.view, target);
        else if (this.tabs[0]) await this.openTab(this.tabs[0], target?.params);
      } catch (error) {
        this.visible = false;
        throw error;
      }
    });
  }

  hide(): Promise<void> {
    this.breadcrumbs.clear();
    return this.enqueue(async () => {
      this.visible = false;
      await this.closeActive();
    });
  }

  async setAppearance(value: Pick<App, 'locale' | 'theme'>) {
    this.app.locale = value.locale;
    this.app.theme = value.theme;
    const bundle = this.plugin?.manifest.translations ?? { defaultLocale: 'en-US', resources: { 'en-US': {} } };
    await this.app.i18n.changeLanguage(pluginTranslationLocale(value.locale, bundle));
    if (this.stopping) return;
    this.app.events.trigger('appearance-change', value);
  }

  stop(): Promise<void> {
    if (this.stoppingWork) return this.stoppingWork;
    this.stopping = true;
    this.sidebar?.dispose();
    this.breadcrumbs.clear();
    this.stoppingWork = (async () => {
      await this.navigation.catch(this.report);
      try {
        await this.closeActive();
      } finally {
        try {
          await this.plugin?.unload();
        } finally {
          this.surface.content.replaceChildren();
          this.surface.toolbar.replaceChildren();
          this.surface.status.replaceChildren();
        }
      }
    })();
    return this.stoppingWork;
  }
}
