export type ObsidianPluginActivation = 'active' | 'enable' | 'reload';
export type ObsidianPluginVaultError = 'invalidVault' | 'invalidInstallation' | 'changed' | 'installFailed';

export type ObsidianPluginVaultResult = { path: string; name: string } & (
  | { status: 'installed' | 'updated'; version: string; activation: ObsidianPluginActivation }
  | { status: 'current'; version: string }
  | { status: 'failed'; error: ObsidianPluginVaultError }
);

export type ObsidianPluginBatchResult =
  | { ok: true; vaults: ObsidianPluginVaultResult[] }
  | { ok: false; error: 'vaultsUnavailable' | 'releaseUnavailable' | 'downloadFailed' };

export type ObsidianPluginStatus =
  | { state: 'install' | 'update' | 'current' | 'noVaults' }
  | { state: 'error'; error: 'vaultsUnavailable' | 'releaseUnavailable' | 'invalidVaults' };
