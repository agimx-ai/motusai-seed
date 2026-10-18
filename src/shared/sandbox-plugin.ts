import type { PluginManifest, SeedInvocation } from '@motus-ai/seed-sdk';

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
