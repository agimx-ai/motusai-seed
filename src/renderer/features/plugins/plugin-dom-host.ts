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
  private lease?: object;
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
        else if (event.type === 'stop') void this.stop();
        else void this.controller?.setAppearance(event.appearance).catch((error) => new sdk.Notice(String(error)));
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

  async show(container: HTMLElement, lease: object) {
    this.lease = lease;
    const configuration = await window.motusSeed.mountPluginView({ pluginId: this.pluginId, token: this.token });
    if (this.lease !== lease || this.stopped) return true;
    if (this.generation && configuration.generation !== this.generation) {
      await this.stop();
      return false;
    }
    try {
      await this.initialize(configuration);
      if (this.lease !== lease || this.stopped) return true;
      container.append(this.element);
      await this.controller!.setAppearance(configuration);
      await this.controller!.show();
      return true;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  hide(lease: object) {
    if (this.lease !== lease || this.stopped) return;
    this.lease = undefined;
    this.element.remove();
    void window.motusSeed.unmountPluginView(this.token);
    void this.controller?.hide().catch((error) => new sdk.Notice(String(error)));
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.lifetime.abort(new Error('Plugin DOM runtime stopped.'));
    this.lease = undefined;
    this.releaseEvents?.();
    this.peer?.close();
    this.style?.remove();
    this.element.remove();
    if (sessions.get(this.pluginId) === this) sessions.delete(this.pluginId);
    await this.controller?.stop().catch((error) => new sdk.Notice(String(error)));
  }
}

export function mountPluginDom(pluginId: string, container: HTMLElement, onError: (error: unknown) => void) {
  let host = sessions.get(pluginId) ?? new PluginDomHost(pluginId);
  sessions.set(pluginId, host);
  const lease = {};
  let active = true;
  const show = async () => {
    // A hidden page may have missed withdrawal before subscribing. Replace that generation,
    // rather than asking the user to reopen or attempting to reuse its unloaded controller.
    for (let attempt = 0; active && attempt < 2; attempt++) {
      if (await host.show(container, lease)) return;
      if (!active) return;
      host = new PluginDomHost(pluginId);
      sessions.set(pluginId, host);
    }
    if (active) throw new Error('Plugin changed while its page was opening.');
  };
  void show().catch((error) => {
    if (active) onError(error);
  });
  return () => {
    active = false;
    host.hide(lease);
  };
}
