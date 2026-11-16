import { useCallback, useEffect, useRef, useState } from 'react';
import type { ObsidianPluginBatchResult, ObsidianPluginStatus } from '../../../shared/obsidian-plugin';

export function useObsidianIntegration(enabled: boolean) {
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<ObsidianPluginStatus | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [result, setResult] = useState<ObsidianPluginBatchResult | null>(null);
  const requestId = useRef(0);
  const installing = useRef(false);

  const refreshStatus = useCallback(async (force = false) => {
    const api = window.motusSeed;
    const id = ++requestId.current;
    setChecking(true);
    try {
      const next = await api.obsidianPluginStatus(force);
      if (requestId.current !== id) return;
      setStatus(next);
      if (next.state === 'install') {
        if (next.updateAvailable !== undefined) setUpdateAvailable(next.updateAvailable);
      } else if (next.state !== 'error' || next.error === 'invalidVaults') {
        setUpdateAvailable(next.state === 'update');
      }
    } catch {
      if (requestId.current === id) setStatus({ state: 'error', error: 'vaultsUnavailable' });
    } finally {
      if (requestId.current === id) setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !window.motusSeed?.obsidianPluginStatus) return;
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
  }, [enabled, refreshStatus]);

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
    } catch {
      setResult({ ok: false, error: 'downloadFailed' });
    } finally {
      installing.current = false;
      await refreshStatus();
      setBusy(false);
    }
  }

  return { busy, checking, status, result, updateAvailable, runAction };
}

export type ObsidianIntegration = ReturnType<typeof useObsidianIntegration>;
