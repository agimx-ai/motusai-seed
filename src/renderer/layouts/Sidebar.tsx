import { ArrowLeft, Bell, Blocks, CircleGauge, CircleHelp, History, LoaderCircle, LogOut, Settings, Sprout, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SeedSnapshot } from '../../shared/contracts'
import { NavItem } from '../components/NavItem'
import { UserAvatar } from '../components/UserAvatar'
import { SidebarToggleButton } from '../components/SidebarToggleButton'
import { Tooltip } from '../components/Tooltip'
import { cx, type View } from '../lib/display'

const accountMenuSurfaceClass = 'seed-account-menu absolute bottom-[50px] left-3 right-3 origin-bottom overflow-hidden rounded-[12px] border p-1'

type SidebarProps = {
  collapsed: boolean
  view: View
  snapshot: SeedSnapshot
  loggingOut: boolean
  pluginUpdateCount: number
  onNavigate: (view: View) => void
  onShowPluginUpdates: () => void
  onLogout: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
  onOpenWebsite: () => void
  onOpenPersonalWallet: () => void
  onToggle: () => void
}

export function Sidebar({
  collapsed,
  view,
  snapshot,
  loggingOut,
  pluginUpdateCount,
  onNavigate,
  onShowPluginUpdates,
  onLogout,
  onDownloadUpdate,
  onInstallUpdate,
  onOpenWebsite,
  onOpenPersonalWallet,
  onToggle,
}: SidebarProps) {
  const { t } = useTranslation()
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [personalWallet, setPersonalWallet] = useState<{ userId: string; available: number | null; unavailable: boolean } | null>(null)
  const [dismissedLowCredits, setDismissedLowCredits] = useState<{ userId: string; balance: number } | null>(null)
  const accountButtonRef = useRef<HTMLButtonElement>(null)
  const accountMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (collapsed) setAccountMenuOpen(false)
  }, [collapsed])

  const userId = snapshot.user?.id
  const currentWallet = personalWallet?.userId === userId ? personalWallet : null
  const personalBalance = currentWallet?.available ?? null
  const walletUnavailable = currentWallet?.unavailable ?? false
  const showLowCredits = !accountMenuOpen && userId && personalBalance !== null && personalBalance < 20
    && (dismissedLowCredits?.userId !== userId || dismissedLowCredits.balance !== personalBalance)

  useEffect(() => {
    if (personalBalance !== null && personalBalance >= 20) setDismissedLowCredits(null)
  }, [personalBalance])

  useEffect(() => {
    if (!userId) return
    let active = true
    let requestNumber = 0
    const refreshWallet = () => {
      const request = ++requestNumber
      void window.motusSeed.personalCreditWallet().then((wallet) => {
        if (active && request === requestNumber) setPersonalWallet({ userId, available: wallet.available, unavailable: false })
      }).catch(() => {
        if (active && request === requestNumber) setPersonalWallet({ userId, available: null, unavailable: true })
      })
    }
    const refreshWhenVisible = () => {
      if (!document.hidden) refreshWallet()
    }
    refreshWallet()
    const interval = window.setInterval(refreshWhenVisible, 60_000)
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [accountMenuOpen, userId])

  useEffect(() => {
    if (!accountMenuOpen) return

    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node
      if (!accountButtonRef.current?.contains(target) && !accountMenuRef.current?.contains(target)) setAccountMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setAccountMenuOpen(false)
      accountButtonRef.current?.focus()
    }
    const closeOnWindowBlur = () => setAccountMenuOpen(false)

    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('blur', closeOnWindowBlur)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', closeOnWindowBlur)
    }
  }, [accountMenuOpen])

  const navigate = (nextView: View) => {
    setAccountMenuOpen(false)
    onNavigate(nextView)
  }
  const displayName = snapshot.user ? snapshot.user.displayName : snapshot.appName
  const avatar = snapshot.user?.avatarDataUrl

  return <aside
    className={cx(
      'seed-sidebar relative z-20 min-h-0 min-w-0 overflow-hidden border-r text-sidebar-foreground transition-[border-color] duration-200 ease-out motion-reduce:transition-none',
      collapsed ? 'border-transparent' : 'border-border',
    )}
    aria-hidden={collapsed}
    inert={collapsed}
  >
    <div className="flex h-full w-[224px] min-h-0 shrink-0 flex-col px-4 pb-0">
      <div className="mb-4 flex min-h-6 items-center gap-1 px-1">
        <Tooltip content={snapshot.appName}>
          <div className="min-w-0 flex-1 truncate font-display text-[16px] font-semibold leading-6 tracking-[-.015em]">{snapshot.appName}</div>
        </Tooltip>
        <div className="-mr-3 flex shrink-0 items-center gap-1">
          <Tooltip content={t(pluginUpdateCount > 0 ? 'plugins.updateNotification' : 'plugins.updateNotificationEmpty', { count: pluginUpdateCount })}>
            <button
              className={cx(
                'relative grid h-6 w-6 shrink-0 place-items-center rounded-lg transition-colors focus-visible:outline-none',
                pluginUpdateCount > 0
                  ? 'bg-info-soft text-info hover:bg-info-hover'
                  : 'text-muted-foreground hover:bg-[var(--sidebar-item-active)] hover:text-foreground',
              )}
              type="button"
              onClick={onShowPluginUpdates}
              aria-label={t(pluginUpdateCount > 0 ? 'plugins.updateNotification' : 'plugins.updateNotificationEmpty', { count: pluginUpdateCount })}
            >
              <Bell size={14} strokeWidth={1.8} />
              {pluginUpdateCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-[10px] min-w-[10px] place-items-center rounded-full bg-info px-[2px] text-[7px] font-semibold leading-none text-white" aria-hidden="true">
                  {pluginUpdateCount > 9 ? '9+' : pluginUpdateCount}
                </span>
              )}
            </button>
          </Tooltip>
          {window.motusWindow.platform !== 'darwin' && <SidebarToggleButton className="h-6 w-6" collapsed={false} onToggle={onToggle} />}
        </div>
      </div>
      {view === 'settings' || view === 'usage' ? <>
        <div className="mb-4"><NavItem active={false} icon={<ArrowLeft size={17} strokeWidth={1.8} />} label={t('nav.backToApp')} onClick={() => navigate('overview')} /></div>
        <span className="mb-2 px-1 text-[12px] font-medium text-muted-foreground">{t('nav.personal')}</span>
        <nav className="grid gap-0.5">
          <NavItem active={view === 'settings'} icon={<Settings size={17} strokeWidth={1.8} />} label={t('nav.general')} onClick={() => navigate('settings')} />
          <NavItem active={view === 'usage'} icon={<UserRound size={17} strokeWidth={1.8} />} label={t('nav.profile')} onClick={() => navigate('usage')} />
        </nav>
      </> : <>
        <nav className="grid gap-0.5">
          <NavItem active={view === 'overview'} icon={<Sprout size={17} strokeWidth={1.8} />} label={t('nav.overview')} onClick={() => navigate('overview')} />
          <NavItem active={view === 'plugins'} icon={<Blocks size={17} strokeWidth={1.8} />} label={t('nav.plugins')} onClick={() => navigate('plugins')} />
          <NavItem active={view === 'activity'} icon={<History size={17} strokeWidth={1.8} />} label={t('nav.activity')} onClick={() => navigate('activity')} />
        </nav>
        <div className="relative -mx-4 mt-auto border-t border-border">
          {showLowCredits && <div className={accountMenuSurfaceClass}>
            <div className="px-2 py-2 text-foreground">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[12px] font-medium leading-4" role="status" aria-live="polite">{t('nav.lowCreditsTitle', { count: personalBalance.toLocaleString() })}</span>
                <button className="-mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-[var(--sidebar-item-active)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" type="button" aria-label={t('nav.dismissLowCredits')} onClick={() => setDismissedLowCredits({ userId, balance: personalBalance })}>
                  <X size={13} strokeWidth={1.8} />
                </button>
              </div>
              <p className="m-0 mt-0.5 text-[11px] leading-[15px] text-muted-foreground">{t('nav.lowCreditsDescription')}</p>
              <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[var(--sidebar-menu-divider)]" role="meter" aria-label={t('nav.lowCreditsMeter')} aria-valuemin={0} aria-valuemax={20} aria-valuenow={Math.max(0, personalBalance)}>
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, personalBalance) / 20 * 100}%` }} />
              </div>
              <div className="mt-2">
                <button className="w-full rounded-full bg-accent px-3 py-1 text-[11px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" type="button" onClick={onOpenPersonalWallet}>{t('nav.addCredits')}</button>
              </div>
            </div>
          </div>}
          {accountMenuOpen && <div ref={accountMenuRef} id="account-menu" className={`${accountMenuSurfaceClass} animate-[rise_.12s_ease-out_both]`} role="menu">
            <div className="border-b border-[var(--sidebar-menu-divider)] pb-1">
              <button className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[11px] text-foreground transition-colors hover:bg-[var(--sidebar-item-active)] focus-visible:bg-[var(--sidebar-item-active)] focus-visible:outline-none" type="button" role="menuitem" aria-label={`${displayName} · ${t('nav.profile')}`} onClick={() => navigate('usage')}>
                <UserAvatar className="grid h-5 w-5 place-items-center overflow-hidden rounded-full bg-[#8d9899] text-[8px] text-white dark:bg-[#718086]" imageUrl={avatar} name={displayName} />
                <span className="truncate">{displayName}</span>
              </button>
            </div>
            <div className="py-1">
              <button className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] text-foreground transition hover:bg-[var(--sidebar-item-active)]" type="button" role="menuitem" onClick={() => navigate('usage')}>
                <CircleGauge size={12} />
                <span className="min-w-0 flex-1 truncate">{t('nav.usage')}</span>
                <span className="shrink-0 text-[11px] leading-none text-muted-foreground">{walletUnavailable ? t('nav.creditsUnavailable') : t('nav.creditsRemaining', { count: personalBalance === null ? '—' : personalBalance.toLocaleString() })}</span>
              </button>
              <button className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] text-foreground transition hover:bg-[var(--sidebar-item-active)]" onClick={() => navigate('settings')}><Settings size={12} />{t('nav.settings')}</button>
              <button className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] text-foreground transition hover:bg-[var(--sidebar-item-active)] disabled:cursor-default disabled:opacity-50" type="button" role="menuitem" disabled={loggingOut} onClick={onLogout}>
                {loggingOut ? <LoaderCircle className="animate-spin" size={12} /> : <LogOut size={12} />}
                {t(loggingOut ? 'nav.loggingOut' : 'nav.logout')}
              </button>
            </div>
          </div>}
          <div className="grid h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2">
            <button
              ref={accountButtonRef}
              className={cx(
                'grid h-8 min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-2.5 rounded-[10px] px-2 text-left transition-colors hover:bg-[var(--sidebar-item-active)] focus-visible:bg-[var(--sidebar-item-active)] focus-visible:outline-none',
                accountMenuOpen && 'bg-[var(--sidebar-item-active)]',
              )}
              onClick={() => setAccountMenuOpen((open) => !open)}
              aria-expanded={accountMenuOpen}
              aria-controls="account-menu"
              aria-haspopup="menu"
            >
              <UserAvatar className="grid h-6 w-6 place-items-center overflow-hidden rounded-full bg-[#8d9899] text-[9px] font-medium text-white dark:bg-[#718086]" imageUrl={avatar} name={displayName} />
              <strong className="block truncate text-[13px] font-normal">{displayName}</strong>
            </button>
            <UpdateControl
              snapshot={snapshot}
              onDownload={onDownloadUpdate}
              onInstall={onInstallUpdate}
              onWebsite={() => {
                setAccountMenuOpen(false)
                onOpenWebsite()
              }}
            />
          </div>
        </div>
      </>}
    </div>
  </aside>
}

function UpdateControl({
  snapshot,
  onDownload,
  onInstall,
  onWebsite,
}: {
  snapshot: SeedSnapshot
  onDownload: () => void
  onInstall: () => void
  onWebsite: () => void
}) {
  const { t } = useTranslation()
  const update = snapshot.update
  const retryable = update.status === 'error' && Boolean(update.availableVersion)
  if (update.status === 'available' || retryable) {
    const title = t('settings.updateAvailableDescription', { version: update.availableVersion })
    const label = snapshot.platform === 'darwin' ? t('nav.downloadNewVersion') : t('nav.update')
    return (
      <Tooltip content={title}>
        <button className="h-[22px] rounded-full bg-[#3095ec] px-2.5 text-[10px] font-medium text-white shadow-[0_1px_2px_rgba(25,118,210,.18)] transition hover:bg-[#2588df] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3095ec]/40" type="button" onClick={onDownload} aria-label={title}>
          {label}
        </button>
      </Tooltip>
    )
  }
  if (update.status === 'downloading') {
    const percent = Math.round(update.percent || 0)
    const title = t('settings.downloadingUpdate', { percent })
    return (
      <Tooltip content={title}>
        <span className="grid h-[22px] min-w-9 place-items-center rounded-full bg-[#3095ec] px-2 text-[10px] font-medium tabular-nums text-white shadow-[0_1px_2px_rgba(25,118,210,.18)]" role="status" aria-label={title}>
          {percent}%
        </span>
      </Tooltip>
    )
  }
  if (update.status === 'downloaded') {
    const title = t('settings.updateReadyDescription', { version: update.availableVersion })
    return (
      <Tooltip content={title}>
        <button className="h-[22px] rounded-full bg-[#3095ec] px-2.5 text-[10px] font-medium text-white shadow-[0_1px_2px_rgba(25,118,210,.18)] transition hover:bg-[#2588df] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3095ec]/40" type="button" onClick={onInstall} aria-label={title}>
          {t('settings.restartToUpdate')}
        </button>
      </Tooltip>
    )
  }
  return (
    <Tooltip content={t('common.help')}>
      <button className="grid h-8 w-8 place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-[var(--sidebar-item-active)] hover:text-foreground focus-visible:bg-[var(--sidebar-item-active)] focus-visible:text-foreground focus-visible:outline-none" type="button" onClick={onWebsite} aria-label={t('common.help')}>
        <CircleHelp size={16} />
      </button>
    </Tooltip>
  )
}
