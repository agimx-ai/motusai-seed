import { Plugin, PluginSettingTab, Setting } from '@motus-ai/seed-sdk';

class Settings extends PluginSettingTab {
  display() {
    this.addChild(new Setting(this.containerEl).setName('Sandbox service')).addButton((button) =>
      button.setButtonText('Read status').onClick(async () => {
        this.containerEl.dataset.result = await this.app.service.call<string>('status');
      }),
    );
  }
}
export default class SandboxPlugin extends Plugin {
  onload() {
    this.addSettingTab(new Settings(this.app, this));
  }
}
