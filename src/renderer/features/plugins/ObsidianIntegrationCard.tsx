import obsidianIcon from '@lobehub/icons-static-svg/icons/obsidian-color.svg';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ObsidianPluginBatchResult, ObsidianPluginStatus } from '../../../shared/obsidian-plugin';
import { PluginActionButton } from './PluginActionButton';

export function ObsidianIntegrationCard() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<ObsidianPluginStatus | null>(null);
  const [result, setResult] = useState<ObsidianPluginBatchResult | null>(null);
  const requestId = useRef(0);
  const installing = useRef(false);

  const refreshStatus = useCallback(async (force = false) => {
    const api = window.motusSeed;
    const id = ++requestId.current;
    setChecking(true);
    try {
      const next = await api.obsidianPluginStatus(force);
      if (requestId.current === id) setStatus(next);
    } catch {
      if (requestId.current === id) setStatus({ state: 'error', error: 'vaultsUnavailable' });
    } finally {
      if (requestId.current === id) setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!window.motusSeed?.obsidianPluginStatus) return;
    const onFocus = () => {
      if (!installing.current) void refreshStatus();
    };
    onFocus();
    window.addEventListener('focus', onFocus);
    const unsubscribe = window.motusSeed.subscribe?.((event) => {
      if (event.type === 'obsidian.release.changed') onFocus();
    });
    return () => {
      unsubscribe?.();
      window.removeEventListener('focus', onFocus);
      requestId.current += 1;
    };
  }, [refreshStatus]);

  async function runAction() {
    if (checking || installing.current || !status) return;
    if (status.state === 'error' || status.state === 'noVaults') {
      setResult(null);
      await refreshStatus(true);
      return;
    }
    if (status.state === 'current') return;

    installing.current = true;
    setBusy(true);
    setResult(null);
    try {
      const next = await window.motusSeed.installObsidianPlugin();
      setResult(next);
      if (next.ok) await refreshStatus();
    } catch {
      setResult({ ok: false, error: 'downloadFailed' });
    } finally {
      installing.current = false;
      setBusy(false);
    }
  }

  const state = status?.state;
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
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-[14px] border border-border bg-card px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-muted">
          <img src={obsidianIcon} alt="" className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-medium leading-5">MotusAI for Obsidian</div>
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
