/** Local feedback for the SDK's development CLI: client/build metadata and error summaries. */
export const pluginDevelopmentStatusFile = '.seed-development.json';

export type PluginDevelopmentStatus = {
  schemaVersion: 1;
  sessionId: string;
  pid: number;
  appVersion: string;
  updatedAt: number;
  enabled: boolean;
  plugins: Record<
    string,
    {
      manifestDigest?: string;
      state: 'loading' | 'loaded' | 'failed' | 'superseded';
      message?: string;
    }
  >;
};
