import { ThemedIcon } from '@motus-ai/seed-sdk/react';
import { useTranslation } from 'react-i18next';
import obsidianIcon from '../../assets/obsidian-integration.svg';
import obsidianDarkIcon from '../../assets/obsidian-integration-dark.svg';
import { PluginActionButton } from './PluginActionButton';
import { PluginVersionTransition } from './PluginCards';
import type { ObsidianIntegration } from './use-obsidian-integration';

export function ObsidianIntegrationCard({ busy, checking, status, result, runAction }: ObsidianIntegration) {
  const { t } = useTranslation();
  const state = status?.state;
  const firstVersion = status?.installedVersions?.[0];
  const lastVersion = status?.installedVersions?.at(-1);
  const targetVersion = status?.targetVersion;
  const versionLabel = firstVersion && lastVersion && (
    firstVersion === lastVersion ? `v${firstVersion}` : `v${firstVersion}–v${lastVersion}`
  );
  const action = (!checking || busy) && (state === 'install' || state === 'update') ? state : 'details';
  const label = busy || action !== 'details'
    ? undefined
    : t(`obsidianPlugin.button.${checking || !state ? 'checking' : state}`);
  const statusMessage = status?.state === 'error'
    ? t(`obsidianPlugin.errors.${status.error}`)
    : status?.state === 'noVaults' ? t('obsidianPlugin.noVaults') : null;

  const vaults = result?.ok ? result.vaults : [];
  const resultErrors = result && !result.ok ? [result.error]
    : [...new Set(vaults.flatMap((vault) => vault.status === 'failed' ? [vault.error] : []))];
  const needsEnable = vaults.some((vault) => vault.status !== 'failed' && vault.status !== 'current' && vault.activation === 'enable');
  const needsReload = vaults.some((vault) => vault.status !== 'failed' && vault.status !== 'current' && vault.activation === 'reload');

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-[14px] border border-border bg-card py-2.5 pl-[7px] pr-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-plugin-icon-border bg-card">
          <ThemedIcon iconDataUrl={obsidianIcon} iconDarkDataUrl={obsidianDarkIcon} className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[14px] font-medium leading-5">
            <span>MotusAI for Obsidian</span>
            {firstVersion && targetVersion ? (
              <span className="min-w-0 break-all">
                <PluginVersionTransition currentVersion={`v${firstVersion}`} targetVersion={`v${targetVersion}`} large />
              </span>
            ) : versionLabel && (
              <span className="break-all text-[12px] font-normal tabular-nums text-muted-foreground">{versionLabel}</span>
            )}
          </div>
          <div className="text-[12px] leading-5 text-muted-foreground">{t('obsidianPlugin.summary')}</div>
        </div>
      </div>
      <PluginActionButton
        action={action}
        label={label}
        busy={busy}
        disabled={checking || state === 'current'}
        onStart={() => void runAction()}
      />
      {!checking && !busy && !result && statusMessage && (
        <p role={state === 'error' ? 'alert' : 'status'} className="col-span-full m-0 text-[12px] text-muted-foreground">
          {statusMessage}
        </p>
      )}
      {result?.ok && vaults.length === 0 && (
        <p role="status" className="col-span-full m-0 text-[12px] text-muted-foreground">{t('obsidianPlugin.noVaults')}</p>
      )}
      {resultErrors.length > 0 && (
        <div role="alert" className="col-span-full space-y-1 text-[12px] leading-5 text-destructive">
          {resultErrors.map((error) => <p key={error} className="m-0">{t(`obsidianPlugin.errors.${error}`)}</p>)}
        </div>
      )}
      {needsEnable && <p className="col-span-full m-0 text-[12px] text-muted-foreground">{t('obsidianPlugin.activation.enable')}</p>}
      {needsReload && <p className="col-span-full m-0 text-[12px] text-muted-foreground">{t('obsidianPlugin.activation.reload')}</p>}
    </div>
  );
}
