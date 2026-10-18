import type { SandboxPluginConfiguration, SandboxPluginInvocation } from '../../../shared/sandbox-plugin';

declare global {
  interface Window {
    seedPluginRuntime: {
      ready(): void;
      configured(configuration_id: string, ok: boolean, error?: string): void;
      result(
        request_id: string,
        ok: boolean,
        result?: unknown,
        error?: string,
        error_code?: string,
        error_params?: Record<string, string | number | boolean>,
      ): void;
      invokeBroker(broker_token: string, service: string, arguments_value: Record<string, unknown>): Promise<unknown>;
      onConfigure(listener: (message: SandboxPluginConfiguration) => void): void;
      onInvoke(listener: (message: SandboxPluginInvocation) => void): void;
      onCancel(listener: (requestId: string) => void): void;
      onLocale(listener: (locale: string) => void): void;
    };
  }
}

export {};
