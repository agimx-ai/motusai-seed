import { ChevronRight, Pencil, Plus, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Fragment, type ReactNode } from 'react';
import type { SeedCatalogPlugin, SeedInstalledPlugin } from '../../shared/contracts';
import { resolveSeedLocalizedText } from '../../shared/plugin-manifest';
import { ActionButton, Tooltip } from '@motus-ai/seed-sdk/react';
import { useSeedI18n } from '../i18n';
import type { View } from '../lib/display';
import type { PluginHeaderNavigation } from '../features/plugins/plugin-navigation';

type AppHeaderProps = {
  sidebarCollapsed: boolean;
  view: View;
  selectedPlugin?: SeedInstalledPlugin | SeedCatalogPlugin;
  pluginNavigation?: PluginHeaderNavigation;
  refreshing: boolean;
  onBackToPlugins: () => void;
  onRefreshPlugins: () => void;
  onEditProfile: () => void;
  onAddCredits: () => void;
  activityActions?: ReactNode;
};

export function AppHeader({
  sidebarCollapsed,
  view,
  selectedPlugin,
  pluginNavigation,
  refreshing,
  onBackToPlugins,
  onRefreshPlugins,
  onEditProfile,
  onAddCredits,
  activityActions,
}: AppHeaderProps) {
  const { t } = useTranslation();
  const { locale } = useSeedI18n();
  const navigation = pluginNavigation?.pluginId === selectedPlugin?.id ? pluginNavigation : undefined;
  const breadcrumbs = [
    { id: null, label: selectedPlugin ? resolveSeedLocalizedText(selectedPlugin.name, locale) : '' },
    ...(navigation?.path ?? []),
  ];
  const isWindows = window.motusWindow.platform === 'win32';
  const isMac = window.motusWindow.platform === 'darwin';
  const title =
    view === 'plugins' || view === 'plugin-settings'
      ? t('nav.plugins')
      : view === 'activity'
        ? t('nav.activity')
        : view === 'usage'
          ? t('nav.profile')
          : view === 'settings'
            ? t('nav.general')
            : '';
  const profileButton = (
    <ActionButton icon={<Pencil />} onClick={onEditProfile} tone="ghost" type="button">
      {t('profile.editButton')}
    </ActionButton>
  );
  const refreshButton = (
    <Tooltip content={t('plugins.refresh')}>
      <button
        className={`grid place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground ${isWindows ? 'h-8 w-8' : 'h-9 w-9'}`}
        disabled={refreshing}
        onClick={onRefreshPlugins}
        aria-label={t('plugins.refresh')}
      >
        <RotateCw size={18} className={refreshing ? 'animate-spin' : ''} />
      </button>
    </Tooltip>
  );
  const profileActions = (
    <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
      <ActionButton icon={<Plus />} tone="ghost" onClick={onAddCredits} type="button">
        {t('nav.addCredits')}
      </ActionButton>
      {profileButton}
    </div>
  );
  const actions =
    view === 'plugins' && !selectedPlugin
      ? refreshButton
      : view === 'activity'
        ? activityActions
        : view === 'usage'
          ? profileActions
          : null;

  return (
    <header
      className={`seed-app-header flex min-w-0 items-center${isWindows ? '' : ' justify-between'}${isMac ? ' seed-app-header--mac' : ''}${isMac && sidebarCollapsed ? ' seed-app-header--sidebar-collapsed' : ''}${isWindows && sidebarCollapsed ? ' seed-app-header--windows-collapsed' : ''}`}
    >
      {view === 'overview' ? (
        <span />
      ) : view === 'plugins' && selectedPlugin ? (
        <nav
          className="seed-header-breadcrumbs flex min-w-0 items-center gap-2 whitespace-nowrap text-[14px] font-normal leading-none [-webkit-app-region:no-drag]"
          aria-label={t('plugins.breadcrumb')}
          aria-busy={navigation?.busy || undefined}
        >
          <button
            className="-ml-2 inline-flex h-9 shrink-0 items-center rounded-lg px-2 text-[16px] font-medium text-foreground transition"
            type="button"
            onClick={onBackToPlugins}
          >
            {t('nav.plugins')}
          </button>
          {breadcrumbs.map((item, index) => (
            <Fragment key={item.id === null ? 'root' : `item:${item.id}`}>
              <ChevronRight size={16} className="min-w-0 text-muted-foreground" aria-hidden="true" />
              {index === breadcrumbs.length - 1 ? (
                <span className="seed-header-breadcrumb seed-header-breadcrumb--tail min-w-0 truncate text-foreground" aria-current="page" title={item.label}>{item.label}</span>
              ) : (
                <button
                  type="button"
                  className={`seed-header-breadcrumb seed-header-breadcrumb--${index < breadcrumbs.length - 2 ? 'middle' : 'tail'} -mx-2 inline-flex h-9 min-w-0 items-center rounded-lg px-2 text-muted-foreground transition hover:text-foreground disabled:cursor-wait`}
                  disabled={navigation?.busy}
                  onClick={() => void navigation?.navigate(item.id)}
                  aria-label={item.label}
                >
                  <span className="truncate">{item.label}</span>
                </button>
              )}
            </Fragment>
          ))}
        </nav>
      ) : isWindows ? (
        <div className={`flex items-center ${view === 'usage' ? 'gap-2' : 'gap-1'}`}>
          <h1 className="m-0 text-[16px] font-medium">{title}</h1>
          {actions}
        </div>
      ) : (
        <h1 className="m-0 text-[16px] font-medium">{title}</h1>
      )}
      {!isWindows && (actions || <span />)}
    </header>
  );
}
