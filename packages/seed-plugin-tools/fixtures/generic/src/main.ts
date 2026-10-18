import { Plugin, PluginSettingTab, Setting } from '@motus-ai/seed-sdk';

class Settings extends PluginSettingTab {
  override display() {
    this.addChild(new Setting(this.containerEl).setName('Custom view')).addButton((button) =>
      button.setButtonText('Read service status').onClick(async () => {
        this.containerEl.dataset.result = await this.app.service.call<string>('status');
      }),
    );
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', 'Plugin-owned custom control');
    this.containerEl.append(canvas);
    this.register(() => canvas.remove());
  }
}

export default class ExamplePlugin extends Plugin {
  override async onload() {
    this.settings = await this.loadData();
    this.addSettingTab(new Settings(this.app, this));
  }
}
