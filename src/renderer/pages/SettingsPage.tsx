import { Monitor, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SeedSnapshot } from '../../shared/contracts'
import { ActionButton } from '../components/ActionButton'
import { SegmentedControl, type SegmentedControlOption } from '../components/SegmentedControl'
import { SelectControl, type SelectControlOption } from '../components/SelectControl'
import { SettingsRow } from '../components/SettingsControls'
import { ToggleSwitch } from '../components/ToggleSwitch'
import type { ResolvedTheme, ThemePreference } from '../hooks/use-theme'
import { useSeedI18n, type SeedLanguagePreference } from '../i18n'

type SettingsPageProps = {
  snapshot: SeedSnapshot
  themePreference: ThemePreference
  resolvedTheme: ResolvedTheme
  onThemeChange: (preference: ThemePreference) => void
  onPreventSystemSleepChange: () => void
  onLaunchAtLoginChange: () => void
  onCheckForUpdates: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
}

function formatRuntimePlatform(platform: NodeJS.Platform, architecture: NodeJS.Architecture) {
  const platformName = platform === 'win32'
    ? 'Windows'
    : platform === 'darwin'
      ? 'macOS'
      : platform === 'linux'
        ? 'Linux'
        : platform
  const architectureName = architecture === 'ia32' ? 'x86' : architecture
  return `${platformName} ${architectureName}`
}

export function SettingsPage({ snapshot, themePreference, resolvedTheme, onThemeChange, onPreventSystemSleepChange, onLaunchAtLoginChange, onCheckForUpdates, onDownloadUpdate, onInstallUpdate }: SettingsPageProps) {
  const { t } = useTranslation()
  const { languagePreference, setLanguagePreference } = useSeedI18n()
  const themeOptions: Array<SegmentedControlOption<ThemePreference>> = [
    { value: 'light', label: t('settings.themeLight'), icon: <Sun size={16} strokeWidth={1.8} /> },
    { value: 'dark', label: t('settings.themeDark'), icon: <Moon size={16} strokeWidth={1.8} /> },
    { value: 'system', label: t('settings.themeSystem'), icon: <Monitor size={16} strokeWidth={1.8} /> },
  ]
  const languageOptions: Array<SelectControlOption<SeedLanguagePreference>> = [
    { value: 'system', label: t('settings.languageSystem') },
    { value: 'zh-CN', label: t('settings.languageZhCN') },
    { value: 'en-US', label: t('settings.languageEnUS') },
  ]
  const update = snapshot.update
  const updatePercent = Math.round(update.percent || 0)
  const updateDescription = update.status === 'disabled'
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
                : t('settings.updateAutomatic')
  const updateButton = update.status === 'available' || (update.status === 'error' && update.availableVersion)
    ? <ActionButton tone="primary" onClick={onDownloadUpdate}>{t(snapshot.platform === 'darwin' ? 'settings.downloadNewVersion' : 'settings.downloadUpdate')}</ActionButton>
    : update.status === 'downloading'
      ? <ActionButton busy>{t('settings.downloadingUpdate', { percent: updatePercent })}</ActionButton>
      : update.status === 'downloaded'
        ? <ActionButton tone="primary" onClick={onInstallUpdate}>{t('settings.restartToUpdate')}</ActionButton>
        : <ActionButton busy={update.status === 'checking'} disabled={update.status === 'disabled'} onClick={onCheckForUpdates}>
            {update.status === 'checking' ? t('settings.checkingUpdate') : t('settings.checkForUpdates')}
          </ActionButton>

  return <section className="mx-auto w-full max-w-[730px] animate-[rise_.25s_ease_both]">
    <h1 className="mb-8 mt-0 text-[24px] font-medium tracking-[-.02em]">{t('settings.title')}</h1>
    <section className="mb-12">
      <h2 className="mb-4 text-[16px] font-medium">{t('settings.connectionAndPermissions')}</h2>
      <div className="rounded-[14px] border border-border bg-card px-5">
        <SettingsRow title={t('settings.launchAtLogin')} description={t('settings.launchAtLoginDescription', { appName: snapshot.appName })} action={<ToggleSwitch checked={snapshot.launchAtLogin} onClick={onLaunchAtLoginChange} label={t('settings.launchAtLogin')} />} />
        <SettingsRow title={t('settings.preventSleep')} description={t('settings.preventSleepDescription', { appName: snapshot.appName })} action={<ToggleSwitch checked={snapshot.preventSystemSleep} onClick={onPreventSystemSleepChange} label={t('settings.preventSleep')} />} />
      </div>
    </section>
    <section>
      <h2 className="mb-4 text-[16px] font-medium">{t('settings.general')}</h2>
      <div className="rounded-[14px] border border-border bg-card px-5">
        <SettingsRow title={t('settings.theme')} description={t('settings.currentTheme', { theme: resolvedTheme === 'dark' ? t('settings.themeDark') : t('settings.themeLight') })} action={<SegmentedControl value={themePreference} options={themeOptions} onValueChange={onThemeChange} label={t('settings.theme')} />} />
        <SettingsRow title={t('settings.language')} description={t('settings.languageDescription')} action={<SelectControl label={t('settings.language')} value={languagePreference} options={languageOptions} onValueChange={setLanguagePreference} />} />
        <SettingsRow
          title={t('settings.version')}
          description={`${snapshot.appName} ${snapshot.appVersion} · ${formatRuntimePlatform(snapshot.platform, snapshot.architecture)} · ${updateDescription}`}
          action={updateButton}
        />
      </div>
    </section>
  </section>
}
