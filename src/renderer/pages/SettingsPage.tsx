import { useTranslation } from 'react-i18next';
import type { SeedDockIconPreference, SeedSnapshot } from '../../shared/contracts';
import {
  ActionButton,
  SelectControl,
  type SelectControlOption,
} from '@motus-ai/seed-sdk/react';
import { SettingsRow } from '../components/SettingsControls';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { ThemePreviewControl } from '../components/ThemePreviewControl';
import { DockIconControl } from '../components/DockIconControl';
import type { ResolvedTheme, ThemePreference } from '../hooks/use-theme';
import { useSeedI18n, type SeedLanguagePreference } from '../i18n';

type SettingsPageProps = {
  snapshot: SeedSnapshot;
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  onThemeChange: (preference: ThemePreference) => void;
  onDockIconChange: (preference: SeedDockIconPreference) => void;
  onPreventSystemSleepChange: () => void;
  onLaunchAtLoginChange: () => void;
  notificationsBusy?: boolean;
  onSystemNotificationsChange: () => void;
  onCheckForUpdates: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
};

function formatRuntimePlatform(platform: NodeJS.Platform, architecture: NodeJS.Architecture) {
  const platformName =
    platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform;
  const architectureName = architecture === 'ia32' ? 'x86' : architecture;
  return `${platformName} ${architectureName}`;
}

export function SettingsPage({
  snapshot,
  themePreference,
  resolvedTheme,
  onThemeChange,
  onDockIconChange,
  onPreventSystemSleepChange,
  onLaunchAtLoginChange,
  notificationsBusy = false,
  onSystemNotificationsChange,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
}: SettingsPageProps) {
  const { t } = useTranslation();
  const { languagePreference, setLanguagePreference } = useSeedI18n();
  const languageOptions: Array<SelectControlOption<SeedLanguagePreference>> = [
    { value: 'system', label: t('settings.languageSystem') },
    { value: 'zh-CN', label: t('settings.languageZhCN') },
    { value: 'en-US', label: t('settings.languageEnUS') },
  ];
  const update = snapshot.update;
  const updatePercent = Math.round(update.percent || 0);
  const updateDescription =
    update.status === 'disabled'
      ? t('settings.updateDisabled')
      : update.status === 'checking'
        ? t('settings.updateChecking')
        : update.status === 'available'
          ? t('settings.updateAvailableDescription', { version: update.availableVersion })
          : update.status === 'downloading'
            ? t('settings.updateDownloadingDescription', { percent: updatePercent })
            : update.status === 'downloaded'
              ? t('settings.updateReadyDescription', { version: update.availableVersion })
              : update.status === 'up-to-date'
                ? t('settings.updateCurrent')
                : update.status === 'error'
                  ? t('settings.updateFailed')
                  : t('settings.updateAutomatic');
  const updateButton =
    update.status === 'available' || (update.status === 'error' && update.availableVersion) ? (
      <ActionButton tone="primary" onClick={onDownloadUpdate}>
        {t(snapshot.platform === 'darwin' ? 'settings.downloadNewVersion' : 'settings.downloadUpdate')}
      </ActionButton>
    ) : update.status === 'downloading' ? (
      <ActionButton busy>{t('settings.downloadingUpdate', { percent: updatePercent })}</ActionButton>
    ) : update.status === 'downloaded' ? (
      <ActionButton tone="primary" onClick={onInstallUpdate}>
        {t('settings.restartToUpdate')}
      </ActionButton>
    ) : (
      <ActionButton
        busy={update.status === 'checking'}
        disabled={update.status === 'disabled'}
        onClick={onCheckForUpdates}
      >
        {update.status === 'checking' ? t('settings.checkingUpdate') : t('settings.checkForUpdates')}
      </ActionButton>
    );

  return (
    <section className="mx-auto w-full max-w-[730px] pt-7 animate-[rise_.25s_ease_both]">
      <section className="mb-12">
        <h2 className="mb-4 text-[14px] font-medium">{t('settings.visualStyle')}</h2>
        <div className="rounded-[16px] border border-border bg-card px-4">
          <div className="flex min-h-[78px] flex-wrap items-center justify-between gap-5 border-b border-border py-2">
            <strong className="text-[13px] font-medium text-foreground">{t('settings.themeMode')}</strong>
            <ThemePreviewControl value={themePreference} resolvedTheme={resolvedTheme} onValueChange={onThemeChange} />
          </div>
          {snapshot.platform === 'darwin' && <SettingsRow
            title={t('settings.dockIcon')}
            action={<DockIconControl value={snapshot.dockIconPreference ?? 'system'} designGeneration={snapshot.dockIconDesignGeneration} onValueChange={onDockIconChange} />}
          />}
          <SettingsRow
            title={t('settings.language')}
            action={
              <SelectControl
                label={t('settings.language')}
                value={languagePreference}
                options={languageOptions}
                onValueChange={setLanguagePreference}
              />
            }
          />
        </div>
      </section>
      <section className="mb-12">
        <h2 className="mb-4 text-[14px] font-medium">{t('settings.system')}</h2>
        <div className="rounded-[14px] border border-border bg-card px-5">
          <SettingsRow
            title={t('settings.launchAtLogin')}
            description={t('settings.launchAtLoginDescription', { appName: snapshot.appName })}
            action={
              <ToggleSwitch
                checked={snapshot.launchAtLogin}
                onClick={onLaunchAtLoginChange}
                label={t('settings.launchAtLogin')}
              />
            }
          />
          <SettingsRow
            title={t('settings.preventSleep')}
            description={t('settings.preventSleepDescription', { appName: snapshot.appName })}
            action={
              <ToggleSwitch
                checked={snapshot.preventSystemSleep}
                onClick={onPreventSystemSleepChange}
                label={t('settings.preventSleep')}
              />
            }
          />
          <SettingsRow
            title={t('settings.systemNotifications')}
            description={t('settings.systemNotificationsDescription')}
            action={
              <ToggleSwitch
                checked={snapshot.systemNotificationsEnabled}
                label={t('settings.systemNotifications')}
                disabled={notificationsBusy}
                onClick={onSystemNotificationsChange}
              />
            }
          />
        </div>
      </section>
      <section>
        <h2 className="mb-4 text-[14px] font-medium">{t('settings.about')}</h2>
        <div className="rounded-[14px] border border-border bg-card px-5">
          <SettingsRow
            title={t('settings.version')}
            description={`${snapshot.appName} ${snapshot.appVersion} · ${formatRuntimePlatform(snapshot.platform, snapshot.architecture)} · ${updateDescription}`}
            action={updateButton}
          />
        </div>
      </section>
    </section>
  );
}
