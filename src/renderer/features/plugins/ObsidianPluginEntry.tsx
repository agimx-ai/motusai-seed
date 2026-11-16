import obsidianIcon from '@lobehub/icons-static-svg/icons/obsidian-color.svg';
import { ActionButton } from '@motus-ai/seed-sdk/react';
import { LoaderCircle } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ObsidianPluginBatchResult } from '../../../shared/obsidian-plugin';

export function ObsidianPluginEntry() {
  const { t } = useTranslation();
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ObsidianPluginBatchResult | null>(null);

  async function install() {
    setBusy(true);
    setResult(null);
    try {
      setResult(await window.motusSeed.installObsidianPlugin());
    } catch {
      setResult({ ok: false, error: 'downloadFailed' });
    } finally {
      setBusy(false);
    }
  }

  const vaults = result?.ok ? result.vaults : [];
  const counts = { installed: 0, updated: 0, current: 0, failed: 0 };
  for (const vault of vaults) counts[vault.status] += 1;
  const needsEnable = vaults.some((vault) => vault.status !== 'failed' && vault.status !== 'current' && vault.activation === 'enable');
  const needsReload = vaults.some((vault) => vault.status !== 'failed' && vault.status !== 'current' && vault.activation === 'reload');

  return (
    <section aria-labelledby={headingId} className="mb-7 mt-4">
      <h3 id={headingId} className="mb-2 px-2 text-[16px] font-medium">{t('obsidianPlugin.section')}</h3>
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
        <ActionButton tone="primary" busy={busy} onClick={() => void install()}>
          {busy && <LoaderCircle size={14} className="animate-spin seed-reduced-motion:animate-none" aria-hidden="true" />}
          {t('obsidianPlugin.installAll')}
        </ActionButton>
        {busy && <p role="status" className="col-span-full m-0 text-[12px] text-muted-foreground">{t('obsidianPlugin.installing')}</p>}
        {result && (
          <div className="col-span-full space-y-1 text-[12px] leading-5 text-muted-foreground">
            {!result.ok ? (
              <p role="alert" className="m-0 text-destructive">{t(`obsidianPlugin.errors.${result.error}`)}</p>
            ) : vaults.length === 0 ? (
              <p role="status" className="m-0">{t('obsidianPlugin.noVaults')}</p>
            ) : (
              <>
                <p role="status" className="m-0 tabular-nums">{t('obsidianPlugin.result', counts)}</p>
                {needsEnable && <p className="m-0">{t('obsidianPlugin.activation.enable')}</p>}
                {needsReload && <p className="m-0">{t('obsidianPlugin.activation.reload')}</p>}
                <details>
                  <summary className="w-fit cursor-pointer rounded text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                    {t('obsidianPlugin.details')}
                  </summary>
                  <ul className="m-0 list-none divide-y divide-border p-0">
                    {[...vaults].sort((a, b) => a.name.localeCompare(b.name)).map((vault) => (
                      <li key={vault.path} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1">
                        <span title={vault.path} className="min-w-0 break-all text-foreground">{vault.name || vault.path}</span>
                        {vault.status === 'failed' ? (
                          <span className="text-destructive">{t(`obsidianPlugin.errors.${vault.error}`)}</span>
                        ) : (
                          <span>{t(`obsidianPlugin.status.${vault.status}`, { version: vault.version })}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
