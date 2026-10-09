import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { SeedCatalogPage } from '../shared/contracts'
import { resolveSeedLocalizedText } from '../shared/plugin-manifest'
import { AppHeader } from './layouts/AppHeader'
import { ProfileEditDialog } from './components/ProfileEditDialog'
import { ClientReleaseNotesDialog } from './components/ClientReleaseNotesDialog'
import { useClientReleaseNotes } from './hooks/use-client-release-notes'
import { Sidebar } from './layouts/Sidebar'
import { AppLogo } from './components/AppBrand'
import { ShimmerIcon } from './components/Shimmer'
import { SidebarToggleButton } from './components/SidebarToggleButton'
import { Toaster } from './components/ui/sonner'
import { WindowChrome } from './components/WindowChrome'
import { useSeed } from './hooks/use-seed'
import { useTheme } from './hooks/use-theme'
import type { View } from './lib/display'
import { ActivityActions, ActivityPage } from './pages/ActivityPage'
import { LoginPage } from './pages/LoginPage'
import { OverviewPage } from './pages/OverviewPage'
import { PluginsPage } from './pages/PluginsPage'
import { SettingsPage } from './pages/SettingsPage'
import { PluginSettingsPage } from './pages/PluginSettingsPage'
import { UsagePage } from './pages/UsagePage'
import { countAvailablePluginUpdates, getAvailablePluginUpdates, updatePluginsSequentially } from './features/plugins/plugin-updates'
import { pluginDataCleanupFeedback } from './features/plugins/plugin-data-cleanup-feedback'
import { userFacingErrorMessage } from './lib/errors'
import { useSeedI18n } from './i18n'

const previewStartupScreen = false
const minimumStartupDurationMs = 1_200
const sidebarWidth = 224

export default function App() {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const { snapshot, busy, run, logUploadProgress, cancelLogUpload, pluginInstallProgress, cancelPluginInstall } = useSeed()
  const themePreference = snapshot?.themePreference ?? 'system'
  const presentationThemePreference = !snapshot?.user ? 'system' : themePreference
  const { resolvedTheme } = useTheme(presentationThemePreference)
  const [view, setView] = useState<View>('overview')
  const [profileEditing, setProfileEditing] = useState(false)
  const [pluginQuery, setPluginQuery] = useState('')
  const [pluginSearchResults, setPluginSearchResults] = useState<{ query: string; page: SeedCatalogPage; error?: string }>()
  const [pluginSearchLoading, setPluginSearchLoading] = useState(false)
  const currentPluginQuery = useRef('')
  currentPluginQuery.current = pluginQuery.trim()
  const [selectedPluginId, setSelectedPluginId] = useState('')
  const [updatingAllPlugins, setUpdatingAllPlugins] = useState(false)
  const updateAllInFlight = useRef(false)
  const [minimumStartupElapsed, setMinimumStartupElapsed] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const pluginSearchRef = useRef<HTMLInputElement>(null)
  const handledNavigationId = useRef('')
  const knownLocalClientScopes = useRef<Set<string> | null>(null)
  const isMac = window.motusWindow.platform === 'darwin'
  const releaseNotes = useClientReleaseNotes(Boolean(minimumStartupElapsed && snapshot?.startup.status === 'ready'))
  const releaseNotesDialog = releaseNotes.notes && <ClientReleaseNotesDialog
    notes={releaseNotes.notes} appName={snapshot?.appName || ''} busy={releaseNotes.busy}
    onClose={() => void releaseNotes.close()}
  />

  useEffect(() => {
    const timer = window.setTimeout(() => setMinimumStartupElapsed(true), minimumStartupDurationMs)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const request = snapshot?.navigationRequest
    if (!request || request.id === handledNavigationId.current) return
    handledNavigationId.current = request.id
    if (request.destination === 'plugins') {
      setView('plugins')
      setSelectedPluginId(request.pluginId || '')
      setPluginQuery(request.pluginId ? '' : request.query || '')
      if (!request.pluginId) window.setTimeout(() => pluginSearchRef.current?.focus(), 0)
    }
  }, [snapshot?.navigationRequest])

  useEffect(() => {
    const query = pluginQuery.trim()
    if (!query || !window.motusSeed) {
      setPluginSearchResults(undefined)
      setPluginSearchLoading(false)
      return
    }
    let active = true
    setPluginSearchLoading(true)
    const timer = window.setTimeout(() => {
      void window.motusSeed.searchPluginCatalog(query).then((plugins) => {
        if (active) setPluginSearchResults({ query, page: plugins })
      }).catch((reason) => {
        if (active) setPluginSearchResults({ query, page: { items: [] }, error: userFacingErrorMessage(reason) })
      }).finally(() => {
        if (active) setPluginSearchLoading(false)
      })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [pluginQuery])

  useEffect(() => {
    if (!snapshot) return
    const current = new Set(snapshot.localClients.flatMap((client) => client.pluginIds.map((pluginId) => `${client.id}\u0000${pluginId}`)))
    const previous = knownLocalClientScopes.current
    if (previous) {
      for (const client of snapshot.localClients) {
        for (const pluginId of client.pluginIds) {
          const key = `${client.id}\u0000${pluginId}`
          if (previous.has(key)) continue
          const plugin = snapshot.plugins.find((candidate) => candidate.id === pluginId)
          const pluginName = plugin ? resolveSeedLocalizedText(plugin.name, locale) : pluginId
          toast.info(t('notifications.localClientUsingPlugin', { client: client.displayName, plugin: pluginName }), {
            id: `local-client-using-${client.id}-${pluginId}`,
          })
        }
      }
    }
    knownLocalClientScopes.current = current
  }, [locale, snapshot, t])

  const globalToaster = <Toaster
    theme={resolvedTheme}
    contentInsetLeft={snapshot?.startup.status === 'ready' && snapshot.user && !sidebarCollapsed ? sidebarWidth : 0}
  />
  if (previewStartupScreen || !minimumStartupElapsed || !snapshot || snapshot.startup.status === 'initializing') return <>
    <main className="relative grid h-full animate-[fade_.3s_ease_both] place-content-center justify-items-center bg-[var(--startup-surface)] text-foreground">
      <WindowChrome />
      <div className="animate-[seedWake_.8s_cubic-bezier(.2,.8,.2,1)_both]">
        <ShimmerIcon
          baseClassName="opacity-55"
          delay={0}
          overlayClassName="brightness-0 invert opacity-90"
        >
          <AppLogo />
        </ShimmerIcon>
      </div>
    </main>
    {globalToaster}
  </>

  if (!snapshot.user) return <>
    <LoginPage
      appName={snapshot.appName}
      status={snapshot.auth.status}
      error={snapshot.auth.error}
      busy={Boolean(busy)}
      cancelling={busy === 'cancel-sign-in'}
      onSignIn={() => void run('sign-in', (api) => api.signIn())}
      onCancel={() => void run('cancel-sign-in', (api) => api.cancelSignIn())}
    />
    {globalToaster}
    {releaseNotesDialog}
  </>

  const plugins = snapshot.plugins ?? []
  const searchQuery = pluginQuery.trim()
  const currentSearch = pluginSearchResults?.query === searchQuery ? pluginSearchResults : undefined
  const catalogPlugins = searchQuery ? currentSearch?.page.items ?? [] : snapshot.catalogPlugins ?? []
  const catalogLoading = searchQuery
    ? !currentSearch || (pluginSearchLoading && !currentSearch.page.items.length)
    : snapshot.pluginCatalogStatus === 'loading'
  const catalogError = searchQuery ? currentSearch?.error : snapshot.pluginCatalogError
  const pluginUpdateCount = countAvailablePluginUpdates(plugins, snapshot.catalogPlugins ?? [])
  const updateAllPlugins = async () => {
    if (updateAllInFlight.current || busy || Object.values(pluginInstallProgress).some((progress) => progress.phase !== 'completed')) return
    updateAllInFlight.current = true
    setUpdatingAllPlugins(true)
    try {
      const result = await run('plugin-update-all', async (api) => {
        const catalog = await api.refreshPluginCatalog()
        const current = await api.snapshot()
        const updates = getAvailablePluginUpdates(current.plugins, catalog)
        return updatePluginsSequentially(updates, (id, version) => api.installPlugin(id, version))
      })
      if (!result) return
      const summary = t('plugins.bulkUpdateResult', {
        updated: result.updated,
        failed: result.failed.length,
        cancelled: result.cancelled,
      })
      if (result.failed.length) {
        toast.error(summary, {
          id: 'seed-plugin-update-all-result',
          description: result.failed.map(({ plugin, reason }) => `${resolveSeedLocalizedText(plugin.name, locale)}: ${userFacingErrorMessage(reason)}`).join('\n'),
        })
      } else if (result.cancelled) {
        toast.info(summary, { id: 'seed-plugin-update-all-result' })
      } else if (result.updated) {
        toast.success(t('plugins.bulkUpdateComplete', { count: result.updated }), { id: 'seed-plugin-update-all-result' })
      } else {
        toast.info(t('plugins.updateNotificationEmpty'), { id: 'seed-plugin-update-all-result' })
      }
    } finally {
      updateAllInFlight.current = false
      setUpdatingAllPlugins(false)
    }
  }
  const selectedPlugin = plugins.find((plugin) => plugin.id === selectedPluginId)
    ?? catalogPlugins.find((plugin) => plugin.id === selectedPluginId)
  const refreshPlugins = async (announce: boolean) => {
    const refreshed = await run(
      'plugin-catalog-refresh',
      (api) => api.refreshPluginCatalog(),
      announce ? t('notifications.catalogRefreshed') : undefined,
    )
    const query = pluginQuery.trim()
    if (!refreshed || !query || !window.motusSeed) return
    setPluginSearchLoading(true)
    try {
      const page = await window.motusSeed.searchPluginCatalog(query)
      if (currentPluginQuery.current === query) setPluginSearchResults({ query, page })
    } catch (reason) {
      if (currentPluginQuery.current === query) setPluginSearchResults({ query, page: { items: [] }, error: userFacingErrorMessage(reason) })
    } finally {
      if (currentPluginQuery.current === query) setPluginSearchLoading(false)
    }
  }
  const loadMoreCatalog = async () => {
    if (!window.motusSeed) return
    const query = pluginQuery.trim()
    if (!query) {
      await run('plugin-catalog-load-more', (api) => api.loadMorePluginCatalog())
      return
    }
    const cursor = currentSearch?.page.nextCursor
    if (!cursor || pluginSearchLoading) return
    setPluginSearchLoading(true)
    try {
      const page = await window.motusSeed.searchPluginCatalog(query, cursor)
      if (currentPluginQuery.current !== query) return
      setPluginSearchResults((current) => current?.query === query ? ({ query, page: {
        items: [...current.page.items, ...page.items],
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      } }) : current)
    } catch (reason) {
      if (currentPluginQuery.current === query) toast.error(userFacingErrorMessage(reason), { id: 'seed-plugin-search-more-error' })
    } finally {
      if (currentPluginQuery.current === query) setPluginSearchLoading(false)
    }
  }
  const backToPlugins = () => {
    setSelectedPluginId('')
  }
  const navigate = (nextView: View) => {
    setView(nextView)
    if (nextView !== 'plugins') return
    setSelectedPluginId('')
  }

  return <>
    <div
      className="relative grid h-full text-foreground transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none"
      style={{ gridTemplateColumns: sidebarCollapsed ? '0 minmax(0,1fr)' : `${sidebarWidth}px minmax(0,1fr)` }}
    >
      <WindowChrome />
      {(isMac || sidebarCollapsed) && <SidebarToggleButton
        className={`absolute z-[70] [-webkit-app-region:no-drag] ${isMac ? 'left-[88px] top-[9px]' : 'left-2 top-[14px]'}`}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
      />}
      <Sidebar
        collapsed={sidebarCollapsed}
        view={view}
        snapshot={snapshot}
        loggingOut={busy === 'logout'}
        pluginUpdateCount={pluginUpdateCount}
        onNavigate={navigate}
        onShowPluginUpdates={() => {
          navigate('plugins')
          setPluginQuery('')
        }}
        onLogout={() => void run('logout', (api) => api.logout())}
        onDownloadUpdate={() => void run('update-download', (api) => api.downloadUpdate())}
        onInstallUpdate={() => void run('update-install', (api) => api.installUpdate())}
        onOpenWebsite={() => void run('open-website', (api) => api.openWebsite())}
        onOpenPersonalWallet={() => void run('open-personal-wallet', (api) => api.openPersonalWallet())}
        onToggle={() => setSidebarCollapsed(true)}
      />
      <section className="col-start-2 grid min-h-0 min-w-0 grid-rows-[58px_minmax(0,1fr)] bg-background">
      <AppHeader
        sidebarCollapsed={sidebarCollapsed}
        view={view}
        selectedPlugin={selectedPlugin}
        refreshing={busy === 'plugin-catalog-refresh'}
        onBackToPlugins={backToPlugins}
        onRefreshPlugins={() => void refreshPlugins(true)}
        onEditProfile={() => setProfileEditing(true)}
        onAddCredits={() => void run('open-personal-wallet', (api) => api.openPersonalWallet())}
        activityActions={view === 'activity' ? <ActivityActions
          uploading={busy === 'upload-logs'}
          uploadProgress={logUploadProgress}
          onClear={() => void run('clear-audit', (api) => api.clearAudit(), t('notifications.activityCleared'))}
          onUploadLogs={(range) => run('upload-logs', (api) => api.uploadLogs(range), t('notifications.logsUploaded'))}
          onCancelUploadLogs={cancelLogUpload}
        /> : undefined}
      />
      <main className={`h-full min-h-0 min-w-0 overflow-auto px-8 pb-16 max-[980px]:px-6 ${view === 'overview' ? 'pt-4' : 'pt-0'}`}>
        {view === 'overview' && <OverviewPage snapshot={snapshot} />}
        {view === 'plugins' && <PluginsPage
          appName={snapshot.appName}
          plugins={plugins}
          catalogPlugins={catalogPlugins}
          installedLoading={snapshot.installedPluginsStatus === 'loading' && snapshot.pluginCatalogStatus !== 'error'}
          installedError={snapshot.installedPluginsStatus === 'error' || (snapshot.installedPluginsStatus === 'loading' && snapshot.pluginCatalogStatus === 'error')}
          catalogLoading={catalogLoading}
          catalogError={catalogError}
          selectedPlugin={selectedPlugin}
          query={pluginQuery}
          searchRef={pluginSearchRef}
          busy={busy}
          updateCount={pluginUpdateCount}
          updatesBusy={updatingAllPlugins}
          onUpdateAll={() => void updateAllPlugins()}
          installProgress={pluginInstallProgress}
          hasMore={searchQuery ? Boolean(currentSearch?.page.nextCursor) : Boolean(snapshot.catalogNextCursor)}
          loadingMore={pluginQuery.trim() ? pluginSearchLoading : busy === 'plugin-catalog-load-more'}
          configurationStates={snapshot.pluginConfigurations}
          onQueryChange={setPluginQuery}
          onLoadMore={() => void loadMoreCatalog()}
          onSelectPlugin={setSelectedPluginId}
          onInstall={(id, version) => void run(`plugin-install-${id}`, (api) => api.installPlugin(id, version), t('notifications.pluginInstalled'))}
          onCancelInstall={(id) => void cancelPluginInstall(id)}
          onUninstall={(id) => void run(`plugin-uninstall-${id}`, (api) => api.uninstallPlugin(id), t('notifications.pluginUninstalled'))}
          onUpdateConfiguration={(input) => run(`plugin-config-${input.pluginId}`, (api) => api.updatePluginConfiguration(input), t('plugins.configurationSaved'))}
          onQueryConfigurationOptions={window.motusSeed.queryPluginConfigurationOptions}
          onQueryConfigurationProfileStatuses={window.motusSeed.queryPluginConfigurationProfileStatuses}
          onReconnectConfigurationProfile={window.motusSeed.reconnectPluginConfigurationProfile}
          onQueryManagementView={window.motusSeed.queryPluginManagementView}
          onInvokeManagementAction={window.motusSeed.invokePluginManagementAction}
        />}
        {view === 'activity' && <ActivityPage entries={snapshot.audit} appName={snapshot.appName} />}
        {view === 'plugin-settings' && <PluginSettingsPage
          catalog={snapshot.catalogPlugins}
          busy={Boolean(busy)}
          onListOrphanedPluginData={() => run('plugin-data-scan', (api) => api.listOrphanedPluginData())}
          onResetOrphanedPluginData={async (ids) => {
            const result = await run('plugin-data-reset', (api) => api.resetOrphanedPluginData(ids))
            if (!result) return false
            const feedback = pluginDataCleanupFeedback(result)
            toast[feedback.tone](t(feedback.key), { id: 'seed-plugin-data-reset-result' })
            return true
          }}
        />}
        {view === 'settings' && <SettingsPage
          snapshot={snapshot}
          themePreference={themePreference}
          resolvedTheme={resolvedTheme}
          onThemeChange={(preference) => void run('theme-preference', (api) => api.setThemePreference(preference), t('notifications.settingUpdated'))}
          onPreventSystemSleepChange={() => void run('prevent-system-sleep', (api) => api.setPreventSystemSleep(!snapshot.preventSystemSleep), t('notifications.settingUpdated'))}
          onLaunchAtLoginChange={() => void run('login-item', (api) => api.setLaunchAtLogin(!snapshot.launchAtLogin), t('notifications.settingUpdated'))}
          onCheckForUpdates={() => void run('update-check', (api) => api.checkForUpdates(), t('settings.updateCurrent'))}
          onDownloadUpdate={() => void run('update-download', (api) => api.downloadUpdate())}
          onInstallUpdate={() => void run('update-install', (api) => api.installUpdate())}
        />}
        {view === 'usage' && <UsagePage
          plugins={plugins}
          user={snapshot.user}
        />}
      </main>
      </section>
    </div>
    {globalToaster}
    {profileEditing && <ProfileEditDialog user={snapshot.user} onClose={() => setProfileEditing(false)} />}
    {releaseNotesDialog}
  </>
}
