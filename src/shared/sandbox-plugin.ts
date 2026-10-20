import type { PluginManifest, SeedInvocation, SeedBillingReceipt } from '@motus-ai/seed-sdk';

/** Electron invoke/contextBridge do not preserve custom Error fields. */
export type SandboxBrokerResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string; code: string; params?: Record<string, string | number | boolean>; billing?: SeedBillingReceipt };

export type SandboxPluginConfiguration = {
  configuration_id: string;
  plugins: Array<{
    package_id: string;
    version: string;
    broker_token: string;
    entry_url: string;
    api_version: 2;
    sdk_manifest?: PluginManifest;
    locale?: string;
    resources?: string[];
  }>;
};
export type SandboxPluginInvocation = { request_id: string; package_id: string } & (
  | { operation?: 'capability'; capability: string; method: string; invocation: Omit<SeedInvocation, 'signal'> }
  | { operation: 'service'; method: string; arguments: Record<string, unknown> }
);
