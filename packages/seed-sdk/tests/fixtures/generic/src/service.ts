import { platform } from 'node:os';
import { PluginService } from '@motus-ai/seed-sdk';

export default class ExampleService extends PluginService {
  override onload() {
    this.registerMethod('status', () => platform());
  }
}
