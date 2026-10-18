import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { PluginSettingTab } from '../dom';
import { ComponentProvider } from './style-scope';
import { I18nextProvider } from 'react-i18next';

/** Optional React adapter. The plugin provides ordinary JSX, not a host form declaration. */
export abstract class ReactSettingTab extends PluginSettingTab {
  private root?: Root;
  abstract render(): ReactNode;
  override onload(): void {
    this.registerEvent(this.app.events.on('appearance-change', () => this.renderRoot()));
  }
  private renderRoot(): void {
    this.root?.render(
      <I18nextProvider i18n={this.app.i18n}>
        <ComponentProvider pluginId={this.plugin.manifest.id}>
          {this.render()}
        </ComponentProvider>
      </I18nextProvider>,
    );
  }
  override display(): void {
    const root = (this.root = createRoot(this.containerEl));
    this.register(() => {
      root.unmount();
      if (this.root === root) this.root = undefined;
    });
    this.renderRoot();
  }
}
