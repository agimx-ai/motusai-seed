import { ChevronRight, Pencil, Plus, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { SeedCatalogPlugin, SeedInstalledPlugin } from '../../shared/contracts'
import { resolveSeedLocalizedText } from '../../shared/plugin-manifest'
import { Tooltip } from '../components/Tooltip'
import { ActionButton } from '../components/ActionButton'
import { useSeedI18n } from '../i18n'
import type { View } from '../lib/display'

type AppHeaderProps = {
  sidebarCollapsed: boolean
  view: View
  selectedPlugin?: SeedInstalledPlugin | SeedCatalogPlugin
  refreshing: boolean
  onBackToPlugins: () => void
  onRefreshPlugins: () => void
  onEditProfile: () => void
  onAddCredits: () => void
  activityActions?: ReactNode
}

export function AppHeader({ sidebarCollapsed, view, selectedPlugin, refreshing, onBackToPlugins, onRefreshPlugins, onEditProfile, onAddCredits, activityActions }: AppHeaderProps) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const isWindows = window.motusWindow.platform === 'win32'
  const isMac = window.motusWindow.platform === 'darwin'
  const title = view === 'plugins' ? t('nav.plugins') : view === 'activity' ? t('nav.activity') : view === 'usage' ? t('nav.profile') : view === 'settings' ? t('nav.general') : ''
  const profileButton = <ActionButton
    icon={<Pencil />}
    onClick={onEditProfile}
    tone="ghost"
    type="button"
  >{t('profile.editButton')}</ActionButton>
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
  const profileActions = <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
    <ActionButton icon={<Plus />} tone="ghost" onClick={onAddCredits} type="button">{t('nav.addCredits')}</ActionButton>
    {profileButton}
  </div>
  const actions = view === 'plugins' && !selectedPlugin ? refreshButton
    : view === 'activity' ? activityActions
      : view === 'usage' ? profileActions
        : null

  return <header className={`seed-app-header flex items-center${isWindows ? '' : ' justify-between'}${isMac ? ' seed-app-header--mac' : ''}${isMac && sidebarCollapsed ? ' seed-app-header--sidebar-collapsed' : ''}${isWindows && sidebarCollapsed ? ' seed-app-header--windows-collapsed' : ''}`}>
    {view === 'overview' ? <span /> : view === 'plugins' && selectedPlugin ? <nav className="flex items-center gap-2 text-[14px] font-normal leading-none" aria-label={t('plugins.breadcrumb')}>
      <button className="-ml-2 inline-flex h-9 items-center rounded-lg px-2 text-inherit text-muted-foreground transition hover:bg-muted hover:text-foreground" onClick={onBackToPlugins}>{t('nav.plugins')}</button>
      <ChevronRight size={16} className="text-muted-foreground" aria-hidden="true" />
      <span className="text-foreground">{resolveSeedLocalizedText(selectedPlugin.name, locale)}</span>
    </nav> : isWindows ? <div className={`flex items-center ${view === 'usage' ? 'gap-2' : 'gap-1'}`}>
      <h1 className="m-0 text-[16px] font-medium">{title}</h1>
      {actions}
    </div> : <h1 className="m-0 text-[16px] font-medium">{title}</h1>}
    {!isWindows && (actions || <span />)}
  </header>
}
