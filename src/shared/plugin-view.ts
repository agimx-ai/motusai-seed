import type { PluginManifest, RpcMessage } from '@motus-ai/seed-sdk';

/** Lifecycle and service messages only. Layout and scrolling never cross IPC. */
export type PluginViewEvent = { token: string } & (
  | { type: 'message'; message: RpcMessage }
  | { type: 'appearance'; appearance: Pick<PluginViewConfiguration, 'locale' | 'theme'> }
  | { type: 'stop' }
);

export type PluginViewConfiguration = {
  generation: string;
  manifest: PluginManifest;
  entryUrl: string;
  resources?: string[];
  styleUrl?: string;
  locale: string;
  theme: 'light' | 'dark';
};
