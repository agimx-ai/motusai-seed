import * as sdk from '@motus-ai/seed-sdk';
import * as sdkReact from '@motus-ai/seed-sdk/react';
import * as react from 'react';
import * as jsx from 'react/jsx-runtime';
import * as jsxDev from 'react/jsx-dev-runtime';
import * as reactDOM from 'react-dom';
import * as reactDOMClient from 'react-dom/client';
import { loadPluginBundle, pluginViewConstructor } from '../../../shared/plugin-bundle';
import type { PluginViewConfiguration } from '../../../shared/plugin-view';
import { PluginViewController } from './plugin-view-controller';
import { userFacingErrorMessage } from '../../lib/errors';
import type { PluginHeaderNavigation } from './plugin-navigation';
import type { PluginPageTarget } from './plugin-sidebar';

const sessions = new Map<string, PluginDomHost>();
const modules = {
  '@motus-ai/seed-sdk': sdk,
  '@motus-ai/seed-sdk/react': sdkReact,
  react,
  'react/jsx-runtime': jsx,
  'react/jsx-dev-runtime': jsxDev,
  'react-dom': reactDOM,
  'react-dom/client': reactDOMClient,
};

type ViewLease = {
  withdrawn(): void;
  loading(value: boolean): void;
  navigation(value: PluginHeaderNavigation | undefined): void;
};
type BackgroundLease = { withdrawn(): void };

/** Trusted frontends share the product document; only private services use RPC. */
class PluginDomHost {
  readonly token = crypto.randomUUID();
  readonly element = document.createElement('div');
  private controller?: PluginViewController;
  private peer?: sdk.PluginRpcPeer;
  private style?: HTMLLinkElement;
  private generation?: string;
  private initializing?: Promise<void>;
  private releaseEvents?: () => void;
  private lease?: ViewLease;
  private backgroundLease?: BackgroundLease;
  private stopped = false;
  private readonly lifetime = new AbortController();

  constructor(readonly pluginId: string) {
    this.element.dataset.pluginViewOwner = pluginId;
    this.element.className = 'seed-plugin-content';
  }

  private initialize(configuration: PluginViewConfiguration): Promise<void> {
    if (this.initializing) return this.initializing;
    this.generation = configuration.generation;
    this.initializing = (async () => {
      const toolbar = document.createElement('nav');
      toolbar.className = 'seed-plugin-toolbar';
      toolbar.setAttribute('aria-label', 'Plugin actions');
      const content = document.createElement('div');
      content.className = 'seed-plugin-body';
      const status = document.createElement('footer');
      status.className = 'seed-plugin-status';
      this.element.append(toolbar, content, status);
      const peer = (this.peer = new sdk.PluginRpcPeer(
        configuration.generation,
        (message) => {
          if (this.stopped) return;
          void window.motusSeed.sendPluginViewMessage(this.token, message).catch(() => {
            // A withdrawn/reloaded generation cannot complete any outstanding frontend calls.
            void this.stop();
          });
        },
        async (method, args) => {
          if (method !== 'view.event') throw new Error('Unknown plugin view control operation.');
          this.controller?.app.events.trigger(String(args.name), args.data);
          return null;
        },
      ));
      this.releaseEvents = window.motusSeed.onPluginViewEvent((event) => {
        if (this.stopped || event.token !== this.token) return;
        if (event.type === 'message') void peer.receive(event.message);
        else if (event.type === 'stop') {
          const lease = this.lease;
          const background = this.backgroundLease;
          lease?.loading(true);
          void this.stop().then(() => {
            lease?.withdrawn();
            background?.withdrawn();
          });
        } else void this.controller?.setAppearance(event.appearance).catch((error) => sdk.toast.error(userFacingErrorMessage(error)));
      });
      if (configuration.styleUrl) {
        const style = (this.style = document.createElement('link'));
        style.rel = 'stylesheet';
        style.href = configuration.styleUrl;
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: unknown) => {
            clearTimeout(timeout);
            this.lifetime.signal.removeEventListener('abort', abort);
            style.onload = style.onerror = null;
            if (error) reject(error);
            else resolve();
          };
          const abort = () => finish(this.lifetime.signal.reason);
          const timeout = setTimeout(() => finish(new Error('Plugin stylesheet loading timed out.')), 30000);
          this.lifetime.signal.addEventListener('abort', abort, { once: true });
          style.onload = () => finish();
          style.onerror = () => finish(new Error('Plugin stylesheet failed to load.'));
          document.head.append(style);
        });
      }
      this.assertActive();
      const controller = (this.controller = new PluginViewController(
        { toolbar, content, status },
        {
          resources: sdk.createPluginResources(configuration.entryUrl, configuration.resources ?? []),
          reloadService: () => peer.call('runtime.reload'),
          files: {
            pick: (options) => peer.call('files.pick', options ?? {}),
            path: (file) => window.motusWindow.getPathForFile(file),
          },
          clipboard: {
            writeText: async (text) => {
              this.assertActive();
              await window.motusWindow.copyText(text);
            },
          },
          data: {
            load: () => peer.call('data.load'),
            save: (data, revision) => peer.call('data.save', { data, revision }),
          },
          service: { call: (method, args, signal) => peer.call('service.' + method, args, signal) },
        },
        configuration,
        undefined,
        (state) => this.lease?.navigation(state ? { ...state, pluginId: this.pluginId } : undefined),
      ));
      const bundle = await loadPluginBundle(configuration.entryUrl);
      this.assertActive();
      await controller.start(pluginViewConstructor(bundle, modules, configuration.entryUrl), configuration.manifest);
      this.assertActive();
    })();
    return this.initializing;
  }

  private assertActive() {
    if (this.stopped) throw new Error('Plugin DOM runtime stopped.');
  }

  async prepare(lease: BackgroundLease) {
    this.backgroundLease = lease;
    try {
      const configuration = await window.motusSeed.mountPluginView({ pluginId: this.pluginId, token: this.token, background: true });
      if (!configuration || this.backgroundLease !== lease || this.stopped) return true;
      if (this.generation && configuration.generation !== this.generation) {
        await this.stop();
        return false;
      }
      await this.initialize(configuration);
      return true;
    } catch (error) {
      const withdrawn = this.stopped;
      await this.stop();
      if (withdrawn) return true;
      throw error;
    }
  }

  release(lease: BackgroundLease) {
    if (this.backgroundLease !== lease) return;
    this.backgroundLease = undefined;
    void this.stop();
  }

  async show(container: HTMLElement, lease: ViewLease, target?: PluginPageTarget) {
    this.lease = lease;
    lease.loading(true);
    const configuration = await window.motusSeed.mountPluginView({ pluginId: this.pluginId, token: this.token });
    if (!configuration || this.lease !== lease || this.stopped) return true;
    if (this.generation && configuration.generation !== this.generation) {
      await this.stop();
      return false;
    }
    try {
      await this.initialize(configuration);
    } catch (error) {
      const withdrawn = this.stopped;
      await this.stop();
      if (withdrawn) return true;
      throw error;
    }
    if (this.lease !== lease || this.stopped) return true;
    container.append(this.element);
    try {
      await this.controller!.setAppearance(configuration);
      if (this.lease !== lease || this.stopped) return true;
      await this.controller!.show(target);
    } catch (error) {
      if (this.lease !== lease || this.stopped) return true;
      this.hide(lease);
      throw error;
    }
    if (this.lease === lease && !this.stopped) lease.loading(false);
    return true;
  }

  hide(lease: ViewLease) {
    if (this.lease !== lease || this.stopped) return;
    lease.navigation(undefined);
    this.lease = undefined;
    this.element.remove();
    void window.motusSeed.unmountPluginView(this.token);
    void this.controller?.hide().catch((error) => sdk.toast.error(userFacingErrorMessage(error)));
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.lease?.navigation(undefined);
    this.lifetime.abort(new Error('Plugin DOM runtime stopped.'));
    this.lease = undefined;
    this.backgroundLease = undefined;
    void window.motusSeed.unmountPluginView(this.token, true);
    this.releaseEvents?.();
    this.peer?.close();
    this.style?.remove();
    this.element.remove();
    if (sessions.get(this.pluginId) === this) sessions.delete(this.pluginId);
    await this.controller?.stop().catch((error) => sdk.toast.error(userFacingErrorMessage(error)));
  }
}

export function mountPluginDom(
  pluginId: string,
  container: HTMLElement,
  onError: (error: unknown) => void,
  onLoadingChange?: (loading: boolean) => void,
  onNavigationChange?: (navigation: PluginHeaderNavigation | undefined) => void,
  target?: PluginPageTarget,
) {
  let host = sessions.get(pluginId) ?? new PluginDomHost(pluginId);
  sessions.set(pluginId, host);
  let active = true;
  const lease: ViewLease = {
    navigation(value) {
      if (active) onNavigationChange?.(value);
    },
    loading(value) {
      if (active) onLoadingChange?.(value);
    },
    withdrawn() {
      if (!active) return;
      host = sessions.get(pluginId) ?? new PluginDomHost(pluginId);
      sessions.set(pluginId, host);
      start();
    },
  };
  const show = async () => {
    // A hidden page may have missed withdrawal before subscribing. Replace that generation,
    // rather than asking the user to reopen or attempting to reuse its unloaded controller.
    for (let attempt = 0; active && attempt < 2; attempt++) {
      if (await host.show(container, lease, target)) return;
      if (!active) return;
      host = new PluginDomHost(pluginId);
      sessions.set(pluginId, host);
    }
    if (active) throw new Error('Plugin changed while its page was opening.');
  };
  const start = () => {
    void show().catch((error) => {
      if (active) {
        lease.loading(false);
        onError(error);
      }
    });
  };
  start();
  return () => {
    lease.navigation(undefined);
    active = false;
    host.hide(lease);
  };
}

/** Load registrations once for an enabled plugin, without opening its page. */
export function retainPluginDom(pluginId: string, onError: (error: unknown) => void) {
  let active = true;
  let host: PluginDomHost;
  const lease: BackgroundLease = { withdrawn: () => { if (active) start(); } };
  const start = () => {
    host = sessions.get(pluginId) ?? new PluginDomHost(pluginId);
    sessions.set(pluginId, host);
    void host.prepare(lease).then((current) => {
      if (active && !current) start();
    }).catch((error) => { if (active) onError(error); });
  };
  start();
  return () => {
    active = false;
    host.release(lease);
  };
}
