import type { CapsPluginDescriptor } from '../../../shared/contracts'

type PluginConfiguration = {
  configuration_id: string
  plugins: Array<{ package_id: string; version: string; broker_token: string; entry_url: string; capabilities: CapsPluginDescriptor[] }>
}

type PluginInvocation = {
  request_id: string
  package_id: string
  capability: string
  method: string
  invocation: import('@motusai/seed-sdk').SeedInvocation
}

declare global {
  interface Window {
    seedPluginRuntime: {
      ready(): void
      configured(configuration_id: string, ok: boolean, error?: string): void
      result(request_id: string, ok: boolean, result?: unknown, error?: string, error_code?: string, error_params?: Record<string, string | number | boolean>): void
      invokeBroker(broker_token: string, service: string, arguments_value: Record<string, unknown>): Promise<unknown>
      onConfigure(listener: (message: PluginConfiguration) => void): void
      onInvoke(listener: (message: PluginInvocation) => void): void
    }
  }
}

export {}
