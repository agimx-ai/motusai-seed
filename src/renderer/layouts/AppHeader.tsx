import { ChevronRight, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { SeedCatalogPlugin, SeedInstalledPlugin } from '../../shared/contracts'
import { resolveSeedLocalizedText } from '../../shared/plugin-manifest'
import { Tooltip } from '../components/Tooltip'
import { useSeedI18n } from '../i18n'
import type { View } from '../lib/display'

type AppHeaderProps = {
  sidebarCollapsed: boolean
  view: View
  selectedPlugin?: SeedInstalledPlugin | SeedCatalogPlugin
  refreshing: boolean
  onBackToPlugins: () => void
  onRefreshPlugins: () => void
  activityActions?: ReactNode
}

export function AppHeader({ sidebarCollapsed, view, selectedPlugin, refreshing, onBackToPlugins, onRefreshPlugins, activityActions }: AppHeaderProps) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const isWindows = window.motusWindow.platform === 'win32'
  const isMac = window.motusWindow.platform === 'darwin'
  const title = view === 'plugins' ? t('nav.plugins') : view === 'activity' ? t('nav.activity') : ''
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
  )

  return <header className={`seed-app-header flex items-center${isWindows ? '' : ' justify-between'}${isMac ? ' seed-app-header--mac' : ''}${isMac && sidebarCollapsed ? ' seed-app-header--sidebar-collapsed' : ''}${isWindows && sidebarCollapsed ? ' seed-app-header--windows-collapsed' : ''}`}>
    {view === 'settings' || view === 'usage' || view === 'overview' ? <span /> : view === 'plugins' && selectedPlugin ? <nav className="flex items-center gap-2 text-[14px] font-normal leading-none" aria-label={t('plugins.breadcrumb')}>
      <button className="-ml-2 inline-flex h-9 items-center rounded-lg px-2 text-inherit text-muted-foreground transition hover:bg-muted hover:text-foreground" onClick={onBackToPlugins}>{t('nav.plugins')}</button>
      <ChevronRight size={16} className="text-muted-foreground" aria-hidden="true" />
      <span className="text-foreground">{resolveSeedLocalizedText(selectedPlugin.name, locale)}</span>
    </nav> : isWindows ? <div className="flex items-center gap-1">
      <h1 className="m-0 text-[16px] font-medium">{title}</h1>
      {view === 'plugins' ? refreshButton : null}
      {view === 'activity' ? activityActions : null}
    </div> : <h1 className="m-0 text-[16px] font-medium">{title}</h1>}
    {!isWindows && view === 'plugins' && !selectedPlugin ? refreshButton : !isWindows && view === 'activity' ? activityActions : !isWindows ? <span /> : null}
  </header>
}
