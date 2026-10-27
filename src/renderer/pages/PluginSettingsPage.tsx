import type { SeedCatalogPlugin } from '../../shared/contracts';
import { useTranslation } from 'react-i18next';
import { SettingsRow } from '../components/SettingsControls';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { PluginDataResetSetting } from '../features/plugins/PluginDataResetSetting';

export function PluginSettingsPage({
  catalog,
  busy,
  autoUpdatePlugins,
  onAutoUpdatePluginsChange,
  pluginDevelopmentEnabled,
  onPluginDevelopmentChange,
  onListOrphanedPluginData,
  onResetOrphanedPluginData,
}: {
  catalog: SeedCatalogPlugin[];
  busy: boolean;
  autoUpdatePlugins: boolean;
  onAutoUpdatePluginsChange: () => void;
  pluginDevelopmentEnabled: boolean;
  onPluginDevelopmentChange: () => void;
  onListOrphanedPluginData: () => Promise<string[] | undefined>;
  onResetOrphanedPluginData: (ids: string[]) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  return (
    <section className="mx-auto w-full max-w-[730px] pt-7 animate-[rise_.25s_ease_both]">
      <div className="rounded-[14px] border border-border bg-card px-5">
        <SettingsRow
          title={t('settings.autoUpdatePlugins')}
          description={t('settings.autoUpdatePluginsDescription')}
          action={
            <ToggleSwitch
              checked={autoUpdatePlugins}
              label={t('settings.autoUpdatePlugins')}
              disabled={busy}
              onClick={onAutoUpdatePluginsChange}
            />
          }
        />
        <SettingsRow
          title={t('settings.pluginDevelopment')}
          description={t('settings.pluginDevelopmentDescription')}
          action={
            <ToggleSwitch
              checked={pluginDevelopmentEnabled}
              label={t('settings.pluginDevelopment')}
              disabled={busy}
              onClick={onPluginDevelopmentChange}
            />
          }
        />
        <PluginDataResetSetting
          catalog={catalog}
          disabled={busy}
          onList={onListOrphanedPluginData}
          onReset={onResetOrphanedPluginData}
        />
      </div>
    </section>
  );
}
