import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { SeedCatalogPage } from '../shared/contracts'
import { resolveSeedLocalizedText } from '../shared/plugin-manifest'
import { AppHeader } from './layouts/AppHeader'
import { ProfileEditDialog } from './components/ProfileEditDialog'
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
import { UsagePage } from './pages/UsagePage'
import { PluginCapabilityAuthDialog } from './features/plugins/PluginCapabilityAuthDialog'
import { countAvailablePluginUpdates } from './features/plugins/plugin-updates'
import { useSeedI18n } from './i18n'

const previewStartupScreen = false
const minimumStartupDurationMs = 1_200
const sidebarWidth = 224

export default function App() {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const { snapshot, busy, run, logUploadProgress, cancelLogUpload } = useSeed()
  const themePreference = snapshot?.themePreference ?? 'system'
  const presentationThemePreference = !snapshot?.user ? 'system' : themePreference
  const { resolvedTheme } = useTheme(presentationThemePreference)
  const [view, setView] = useState<View>('overview')
  const [profileEditing, setProfileEditing] = useState(false)
  const [pluginQuery, setPluginQuery] = useState('')
  const [pluginSearchResults, setPluginSearchResults] = useState<SeedCatalogPage>()
  const [pluginSearchLoading, setPluginSearchLoading] = useState(false)
  const [selectedPluginId, setSelectedPluginId] = useState('')
  const [pluginUpdateHighlightRevision, setPluginUpdateHighlightRevision] = useState(0)
  const [minimumStartupElapsed, setMinimumStartupElapsed] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const pluginSearchRef = useRef<HTMLInputElement>(null)
  const handledNavigationId = useRef('')
  const knownLocalClientScopes = useRef<Set<string> | null>(null)
  const isMac = window.motusWindow.platform === 'darwin'

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
    const timer = window.setTimeout(() => {
      setPluginSearchLoading(true)
      void window.motusSeed.searchPluginCatalog(query).then((plugins) => {
        if (active) setPluginSearchResults(plugins)
      }).catch(() => {
        if (active) setPluginSearchResults({ items: [] })
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
  const capabilityAuthRequest = snapshot?.pluginCapabilityApprovalRequest
  const capabilityConsumer = snapshot?.plugins.find((plugin) => plugin.id === capabilityAuthRequest?.consumerPluginId)
  const capabilityProvider = snapshot?.plugins.find((plugin) => plugin.id === capabilityAuthRequest?.providerPluginId)
  const capabilityAuthDialog = <PluginCapabilityAuthDialog
    request={capabilityAuthRequest}
    consumerName={capabilityConsumer ? resolveSeedLocalizedText(capabilityConsumer.name, locale) : capabilityAuthRequest?.consumerPluginId || ''}
    providerName={capabilityProvider ? resolveSeedLocalizedText(capabilityProvider.name, locale) : capabilityAuthRequest?.providerPluginId || ''}
    busy={busy === 'plugin-capability-authorization'}
    onRespond={(allowed) => {
      if (!capabilityAuthRequest) return
      void run('plugin-capability-authorization', (api) => api.respondPluginCapabilityApproval(capabilityAuthRequest.id, allowed))
    }}
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
          <AppLogo appearance="system" />
        </ShimmerIcon>
      </div>
    </main>
    {globalToaster}
    {capabilityAuthDialog}
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
    {capabilityAuthDialog}
  </>

  const plugins = snapshot.plugins ?? []
  const catalogPlugins = pluginQuery.trim() ? pluginSearchResults?.items ?? [] : snapshot.catalogPlugins ?? []
  const pluginUpdateCount = countAvailablePluginUpdates(plugins, snapshot.catalogPlugins ?? [])
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
    try {
      setPluginSearchResults(await window.motusSeed.searchPluginCatalog(query))
    } catch {
      setPluginSearchResults({ items: [] })
    }
  }
  const loadMoreCatalog = async () => {
    if (!window.motusSeed) return
    const query = pluginQuery.trim()
    if (!query) {
      await run('plugin-catalog-load-more', (api) => api.loadMorePluginCatalog())
      return
    }
    const cursor = pluginSearchResults?.nextCursor
    if (!cursor || pluginSearchLoading) return
    setPluginSearchLoading(true)
    try {
      const page = await window.motusSeed.searchPluginCatalog(query, cursor)
      setPluginSearchResults((current) => ({
        items: [...(current?.items ?? []), ...page.items],
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      }))
    } finally {
      setPluginSearchLoading(false)
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
          setPluginUpdateHighlightRevision((revision) => revision + 1)
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
          pluginCapabilityGrants={snapshot.pluginCapabilityGrants.filter((grant) => selectedPlugin && (grant.consumerPluginId === selectedPlugin.id || grant.providerPluginId === selectedPlugin.id))}
          selectedPlugin={selectedPlugin}
          query={pluginQuery}
          searchRef={pluginSearchRef}
          busy={busy}
          hasMore={pluginQuery.trim() ? Boolean(pluginSearchResults?.nextCursor) : Boolean(snapshot.catalogNextCursor)}
          loadingMore={pluginQuery.trim() ? pluginSearchLoading : busy === 'plugin-catalog-load-more'}
          updateHighlightRevision={pluginUpdateHighlightRevision}
          configurationStates={snapshot.pluginConfigurations}
          onQueryChange={setPluginQuery}
          onLoadMore={() => void loadMoreCatalog()}
          onSelectPlugin={setSelectedPluginId}
          onInstall={(id, version) => void run(`plugin-install-${id}`, (api) => api.installPlugin(id, version), t('notifications.pluginInstalled'))}
          onUninstall={(id) => void run(`plugin-uninstall-${id}`, (api) => api.uninstallPlugin(id), t('notifications.pluginUninstalled'))}
          onUpdateConfiguration={(input) => run(`plugin-config-${input.pluginId}`, (api) => api.updatePluginConfiguration(input), t('plugins.configurationSaved'))}
          onQueryConfigurationOptions={window.motusSeed.queryPluginConfigurationOptions}
          onQueryConfigurationProfileStatuses={window.motusSeed.queryPluginConfigurationProfileStatuses}
          onReconnectConfigurationProfile={window.motusSeed.reconnectPluginConfigurationProfile}
          onQueryManagementView={window.motusSeed.queryPluginManagementView}
          onInvokeManagementAction={window.motusSeed.invokePluginManagementAction}
          onRevokePluginCapabilityGrant={(id) => void run(`plugin-capability-revoke-${id}`, (api) => api.revokePluginCapabilityGrant(id))}
        />}
        {view === 'activity' && <ActivityPage entries={snapshot.audit} appName={snapshot.appName} />}
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
    {capabilityAuthDialog}
    {profileEditing && <ProfileEditDialog user={snapshot.user} onClose={() => setProfileEditing(false)} />}
  </>
}
