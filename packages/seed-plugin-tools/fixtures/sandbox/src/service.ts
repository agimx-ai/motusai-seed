import { PluginService } from '@motus-ai/seed-sdk';

export default class SandboxService extends PluginService {
  onload() {
    this.registerMethod('status', () => {
      if (typeof process !== 'undefined' || typeof globalThis.require !== 'undefined')
        throw new Error('Sandbox service exposed Node.');
      return 'sandbox';
    });
    this.registerMethod(
      'wait',
      (_args, signal) =>
        new Promise((resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(signal.reason);
            },
            { once: true },
          );
          const timer = setTimeout(resolve, 60_000);
          signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
        }),
    );
  }
}
