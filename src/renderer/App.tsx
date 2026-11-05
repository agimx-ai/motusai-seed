import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@motus-ai/seed-sdk';
import type { SeedCatalogPage } from '../shared/contracts';
import { resolveSeedLocalizedText } from '../shared/plugin-manifest';
import { AppHeader } from './layouts/AppHeader';
import { ProfileEditDialog } from './components/ProfileEditDialog';
import { AnnouncementDialog } from './components/AnnouncementDialog';
import { Sidebar } from './layouts/Sidebar';
import { AppLogo } from './components/AppBrand';
import { ShimmerIcon } from './components/Shimmer';
import { SidebarToggleButton } from './components/SidebarToggleButton';
import { clampSidebarWidth, defaultSidebarWidth, SidebarResizeHandle } from './components/SidebarResizeHandle';
import { Toaster } from '@motus-ai/seed-sdk/react';
import { WindowChrome } from './components/WindowChrome';
import { useSeed } from './hooks/use-seed';
import { useReducedMotionPreference } from './hooks/use-reduced-motion';
import { useTheme } from './hooks/use-theme';
import type { View } from './lib/display';
import { ActivityActions, ActivityPage } from './pages/ActivityPage';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { PluginsPage } from './pages/PluginsPage';
import { SettingsPage } from './pages/SettingsPage';
import { PluginSettingsPage } from './pages/PluginSettingsPage';
import { UsagePage } from './pages/UsagePage';
import { countAvailablePluginUpdates } from '../shared/plugin-updates';
import { pluginDataCleanupFeedback } from './features/plugins/plugin-data-cleanup-feedback';
import type { PluginHeaderNavigation } from './features/plugins/plugin-navigation';
import { userFacingErrorMessage } from './lib/errors';
import { useSeedI18n } from './i18n';
import { usePluginFrontends } from './features/plugins/use-plugin-frontends';
import { pluginSidebar, type PluginSettingsTarget, type PluginSidebarRoute } from './features/plugins/plugin-sidebar';
import { PluginViewSurface } from './features/plugins/PluginViewSurface';

const previewStartupScreen = false;
const minimumStartupDurationMs = 1_200;
const sidebarWidthStorageKey = 'seed.sidebarWidth';

export default function App() {
  const { t } = useTranslation();
  const { locale } = useSeedI18n();
  const { snapshot, busy, run, logUploadProgress, cancelLogUpload, pluginInstallProgress, cancelPluginInstall } =
    useSeed();
  const themePreference = snapshot?.themePreference ?? 'system';
  const presentationThemePreference = !snapshot?.user ? 'system' : themePreference;
  const { resolvedTheme } = useTheme(presentationThemePreference);
  const { reducedMotionPreference, setReducedMotionPreference } = useReducedMotionPreference();
  const [view, setView] = useState<View>('overview');
  const [profileEditing, setProfileEditing] = useState(false);
  const [pluginQuery, setPluginQuery] = useState('');
  const [pluginSearchResults, setPluginSearchResults] = useState<{
    query: string;
    page: SeedCatalogPage;
    error?: string;
  }>();
  const [pluginSearchLoading, setPluginSearchLoading] = useState(false);
  const currentPluginQuery = useRef('');
  currentPluginQuery.current = pluginQuery.trim();
  const [selectedPluginId, setSelectedPluginId] = useState('');
  const [pluginSettingsTarget, setPluginSettingsTarget] = useState<PluginSettingsTarget>();
  const [pluginNavigation, setPluginNavigation] = useState<PluginHeaderNavigation>();
  const [pluginRoute, setPluginRoute] = useState<PluginSidebarRoute>();
  const navigationEntries = useSyncExternalStore(pluginSidebar.subscribe, pluginSidebar.snapshot);
  usePluginFrontends(snapshot);
  useEffect(() => pluginSidebar.onOpen((route) => {
    setPluginRoute(route);
    setPluginNavigation(undefined);
    setView('plugin-view');
  }), []);
  useEffect(() => pluginSidebar.onOpenSettings((pluginId, target) => {
    setPluginSettingsTarget(target);
    setPluginNavigation(undefined);
    setSelectedPluginId(pluginId);
    setPluginQuery('');
    setView('plugins');
  }), []);
  const currentNavigationEntry = navigationEntries.find((entry) => entry.key === pluginRoute?.key);
  const routePluginEnabled = snapshot?.plugins.some((plugin) => plugin.id === pluginRoute?.pluginId && plugin.enabled && plugin.status === 'ready');
  useEffect(() => {
    if (view === 'plugin-view' && pluginRoute && !routePluginEnabled) {
      setPluginRoute(undefined);
      setView('overview');
    }
  }, [view, pluginRoute, routePluginEnabled]);
  useEffect(() => pluginSidebar.onRemove((key) => {
    if (view === 'plugin-view' && key === pluginRoute?.key) {
      setPluginRoute(undefined);
      setView('overview');
    }
  }), [view, pluginRoute?.key]);
  const updatingAllPlugins = snapshot?.pluginUpdates?.running ?? false;
  const [minimumStartupElapsed, setMinimumStartupElapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem(sidebarWidthStorageKey) ?? defaultSidebarWidth);
      return Number.isFinite(saved) ? clampSidebarWidth(saved) : defaultSidebarWidth;
    } catch {
      return defaultSidebarWidth;
    }
  });
  const pluginSearchRef = useRef<HTMLInputElement>(null);
  const handledNavigationId = useRef('');
  const knownLocalClientScopes = useRef<Set<string> | null>(null);
  const isMac = window.motusWindow.platform === 'darwin';

  useEffect(() => {
    if (resizingSidebar) return;
    try {
      window.localStorage.setItem(sidebarWidthStorageKey, String(sidebarWidth));
    } catch {
      // The current session can still resize the sidebar when storage is unavailable.
    }
  }, [resizingSidebar, sidebarWidth]);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinimumStartupElapsed(true), minimumStartupDurationMs);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const request = snapshot?.navigationRequest;
    if (!request || request.id === handledNavigationId.current) return;
    handledNavigationId.current = request.id;
    if (request.destination === 'plugins') {
      setPluginSettingsTarget(undefined);
      setView('plugins');
      setSelectedPluginId(request.pluginId || '');
      setPluginQuery(request.query || '');
      if (!request.pluginId) window.setTimeout(() => pluginSearchRef.current?.focus(), 0);
    }
  }, [snapshot?.navigationRequest]);

  useEffect(() => {
    const query = pluginQuery.trim();
    if (!query || !window.motusSeed) {
      setPluginSearchResults(undefined);
      setPluginSearchLoading(false);
      return;
    }
    let active = true;
    setPluginSearchLoading(true);
    const timer = window.setTimeout(() => {
      void window.motusSeed
        .searchPluginCatalog(query)
        .then((plugins) => {
          if (active) setPluginSearchResults({ query, page: plugins });
        })
        .catch((reason) => {
          if (active) setPluginSearchResults({ query, page: { items: [] }, error: userFacingErrorMessage(reason) });
        })
        .finally(() => {
          if (active) setPluginSearchLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [pluginQuery]);

  useEffect(() => {
    if (!snapshot) return;
    const current = new Set(
      snapshot.localClients.flatMap((client) => client.pluginIds.map((pluginId) => `${client.id}\u0000${pluginId}`)),
    );
    const previous = knownLocalClientScopes.current;
    if (previous) {
      for (const client of snapshot.localClients) {
        for (const pluginId of client.pluginIds) {
          const key = `${client.id}\u0000${pluginId}`;
          if (previous.has(key)) continue;
          const plugin = snapshot.plugins.find((candidate) => candidate.id === pluginId);
          const pluginName = plugin ? resolveSeedLocalizedText(plugin.name, locale) : pluginId;
          toast.info(t('notifications.localClientUsingPlugin', { client: client.displayName, plugin: pluginName }), {
            id: `local-client-using-${client.id}-${pluginId}`,
          });
        }
      }
    }
    knownLocalClientScopes.current = current;
  }, [locale, snapshot, t]);

  const globalToaster = (
    <Toaster
      theme={resolvedTheme}
      contentInsetLeft={snapshot?.startup.status === 'ready' && snapshot.user && !sidebarCollapsed ? sidebarWidth : 0}
    />
  );
  if (previewStartupScreen || !minimumStartupElapsed || !snapshot || snapshot.startup.status === 'initializing')
    return (
      <>
        <main className="relative grid h-full seed-full-motion:animate-[fade_.3s_ease_both] place-content-center justify-items-center bg-[var(--startup-surface)] text-foreground">
          <WindowChrome />
          <div className="seed-full-motion:animate-[seedWake_.8s_cubic-bezier(.2,.8,.2,1)_both]">
            <ShimmerIcon baseClassName="opacity-55" delay={0} overlayClassName="brightness-0 invert opacity-90">
              <AppLogo />
            </ShimmerIcon>
          </div>
        </main>
        {globalToaster}
      </>
    );

  if (!snapshot.user)
    return (
      <>
        <LoginPage
          appName={snapshot.appName}
          status={snapshot.auth.status}
          error={snapshot.auth.error ? userFacingErrorMessage(snapshot.auth.error) : undefined}
          busy={Boolean(busy)}
          cancelling={busy === 'cancel-sign-in'}
          onSignIn={() => void run('sign-in', (api) => api.signIn())}
          onCancel={() => void run('cancel-sign-in', (api) => api.cancelSignIn())}
        />
        {globalToaster}
      </>
    );

  const catalogById = new Map(snapshot.catalogPlugins.map((plugin) => [plugin.id, plugin]));
  const plugins = snapshot.plugins.map((plugin) => {
    const catalog = catalogById.get(plugin.id);
    if (plugin.status !== 'incompatible' || !catalog) return plugin;
    return {
      ...plugin,
      name: catalog.name,
      iconDataUrl: catalog.iconUrl ?? plugin.iconDataUrl,
      iconDarkDataUrl: catalog.iconUrl ? catalog.iconDarkUrl : plugin.iconDarkDataUrl,
    };
  });
  const searchQuery = pluginQuery.trim();
  const currentSearch = pluginSearchResults?.query === searchQuery ? pluginSearchResults : undefined;
  const catalogPlugins = searchQuery ? (currentSearch?.page.items ?? []) : (snapshot.catalogPlugins ?? []);
  const catalogLoading = searchQuery
    ? !currentSearch || (pluginSearchLoading && !currentSearch.page.items.length)
    : snapshot.pluginCatalogStatus === 'loading';
  const rawCatalogError = searchQuery ? currentSearch?.error : snapshot.pluginCatalogError;
  const catalogError = rawCatalogError ? userFacingErrorMessage(rawCatalogError) : undefined;
  const pluginUpdateCount = countAvailablePluginUpdates(plugins, snapshot.catalogPlugins ?? []);
  const updateAllPlugins = async () => {
    if (
      updatingAllPlugins ||
      busy ||
      Object.values(pluginInstallProgress).some((progress) => progress.phase !== 'completed')
    )
      return;
    await run('plugin-update-all', (api) => api.updateAllPlugins());
  };
  const selectedPlugin =
    plugins.find((plugin) => plugin.id === selectedPluginId) ??
    catalogPlugins.find((plugin) => plugin.id === selectedPluginId);
  const refreshPlugins = async (announce: boolean) => {
    const refreshed = await run(
      'plugin-catalog-refresh',
      (api) => api.refreshPluginCatalog(),
      announce ? t('notifications.catalogRefreshed') : undefined,
    );
    const query = pluginQuery.trim();
    if (!refreshed || !query || !window.motusSeed) return;
    setPluginSearchLoading(true);
    try {
      const page = await window.motusSeed.searchPluginCatalog(query);
      if (currentPluginQuery.current === query) setPluginSearchResults({ query, page });
    } catch (reason) {
      if (currentPluginQuery.current === query)
        setPluginSearchResults({ query, page: { items: [] }, error: userFacingErrorMessage(reason) });
    } finally {
      if (currentPluginQuery.current === query) setPluginSearchLoading(false);
    }
  };
  const loadMoreCatalog = async () => {
    if (!window.motusSeed) return;
    const query = pluginQuery.trim();
    if (!query) {
      await run('plugin-catalog-load-more', (api) => api.loadMorePluginCatalog());
      return;
    }
    const cursor = currentSearch?.page.nextCursor;
    if (!cursor || pluginSearchLoading) return;
    setPluginSearchLoading(true);
    try {
      const page = await window.motusSeed.searchPluginCatalog(query, cursor);
      if (currentPluginQuery.current !== query) return;
      setPluginSearchResults((current) =>
        current?.query === query
          ? {
              query,
              page: {
                items: [...current.page.items, ...page.items],
                ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
              },
            }
          : current,
      );
    } catch (reason) {
      if (currentPluginQuery.current === query)
        toast.error(userFacingErrorMessage(reason), { id: 'seed-plugin-search-more-error' });
    } finally {
      if (currentPluginQuery.current === query) setPluginSearchLoading(false);
    }
  };
  const backToPlugins = () => {
    setPluginSettingsTarget(undefined);
    setSelectedPluginId('');
  };
  const navigate = (nextView: View) => {
    setView(nextView);
    if (nextView !== 'plugins') return;
    setPluginSettingsTarget(undefined);
    setSelectedPluginId('');
  };

  return (
    <>
      <div
        className={`relative grid h-full text-foreground ${resizingSidebar ? 'select-none' : 'transition-[grid-template-columns] duration-200 ease-out seed-reduced-motion:transition-none'}`}
        style={{ gridTemplateColumns: sidebarCollapsed ? '0 minmax(0,1fr)' : `${sidebarWidth}px minmax(0,1fr)` }}
      >
        <WindowChrome />
        {(isMac || sidebarCollapsed) && (
          <SidebarToggleButton
            className={`absolute z-[70] [-webkit-app-region:no-drag] ${isMac ? 'left-[88px] top-[9px]' : 'left-2 top-[14px]'}`}
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
          />
        )}
        <Sidebar
          collapsed={sidebarCollapsed}
          width={sidebarWidth}
          view={view}
          selectedNavigationKey={pluginRoute?.key}
          snapshot={snapshot}
          loggingOut={busy === 'logout'}
          pluginUpdateCount={pluginUpdateCount}
          onNavigate={navigate}
          onOpenPlugin={(entry) => {
            if (!entry.view) return;
            setPluginRoute({ key: entry.key, pluginId: entry.pluginId, title: entry.title, view: entry.view, params: entry.params });
            setPluginNavigation(undefined);
            setView('plugin-view');
          }}
          onShowPluginUpdates={() => {
            navigate('plugins');
            setPluginQuery('');
          }}
          onLogout={() => void run('logout', (api) => api.logout())}
          onDownloadUpdate={() => void run('update-download', (api) => api.downloadUpdate())}
          onInstallUpdate={() => void run('update-install', (api) => api.installUpdate())}
          onOpenPersonalWallet={() => void run('open-personal-wallet', (api) => api.openPersonalWallet())}
          onToggle={() => setSidebarCollapsed(true)}
        />
        {!sidebarCollapsed && <SidebarResizeHandle width={sidebarWidth} onResize={setSidebarWidth} onDragChange={setResizingSidebar} />}
        <section className="seed-page-frame col-start-2 grid min-h-0 min-w-0 grid-rows-[58px_minmax(0,1fr)] bg-background pb-3">
          <AppHeader
            sidebarCollapsed={sidebarCollapsed}
            view={view}
            selectedPlugin={view === 'plugin-view' ? plugins.find((plugin) => plugin.id === pluginRoute?.pluginId) : selectedPlugin}
            pluginNavigation={pluginNavigation}
            pageTitle={currentNavigationEntry?.title ?? pluginRoute?.title}
            refreshing={busy === 'plugin-catalog-refresh'}
            onBackToPlugins={backToPlugins}
            onRefreshPlugins={() => void refreshPlugins(true)}
            onEditProfile={() => setProfileEditing(true)}
            onAddCredits={() => void run('open-personal-wallet', (api) => api.openPersonalWallet())}
            activityActions={
              view === 'activity' ? (
                <ActivityActions
                  uploading={busy === 'upload-logs'}
                  uploadProgress={logUploadProgress}
                  onClear={() => void run('clear-audit', (api) => api.clearAudit(), t('notifications.activityCleared'))}
                  onUploadLogs={(range) =>
                    run('upload-logs', (api) => api.uploadLogs(range), t('notifications.logsUploaded'))
                  }
                  onCancelUploadLogs={cancelLogUpload}
                />
              ) : undefined
            }
          />
          <main
            className={`h-full min-h-0 min-w-0 overflow-auto px-8 max-[980px]:px-6 ${view === 'plugin-view' ? '' : 'pb-16'} ${view === 'overview' ? 'pt-4' : 'pt-0'}`}
          >
            {view === 'overview' && <OverviewPage snapshot={snapshot} />}
            {view === 'plugin-view' && pluginRoute && routePluginEnabled && (
              <PluginViewSurface pluginId={pluginRoute.pluginId} target={pluginRoute} onNavigationChange={setPluginNavigation} />
            )}
            {view === 'plugins' && (
              <PluginsPage
                appName={snapshot.appName}
                plugins={plugins}
                catalogPlugins={catalogPlugins}
                catalogLabels={snapshot.catalogPlugins.flatMap((plugin) => plugin.labels)}
                catalogOrganizations={snapshot.catalogPlugins.flatMap((plugin) =>
                  plugin.visibility === 'organization' && plugin.organization ? [plugin.organization] : [],
                )}
                installedLoading={
                  snapshot.installedPluginsStatus === 'loading' && snapshot.pluginCatalogStatus !== 'error'
                }
                installedError={
                  snapshot.installedPluginsStatus === 'error' ||
                  (snapshot.installedPluginsStatus === 'loading' && snapshot.pluginCatalogStatus === 'error')
                }
                catalogLoading={catalogLoading}
                catalogError={catalogError}
                selectedPlugin={selectedPlugin}
                settingsTarget={pluginSettingsTarget}
                pluginNavigation={pluginNavigation}
                onNavigationChange={setPluginNavigation}
                query={pluginQuery}
                searchRef={pluginSearchRef}
                busy={busy}
                updateCount={pluginUpdateCount}
                updatesBusy={updatingAllPlugins}
                onUpdateAll={() => void updateAllPlugins()}
                installProgress={pluginInstallProgress}
                hasMore={searchQuery ? Boolean(currentSearch?.page.nextCursor) : Boolean(snapshot.catalogNextCursor)}
                loadingMore={pluginQuery.trim() ? pluginSearchLoading : busy === 'plugin-catalog-load-more'}
                onQueryChange={setPluginQuery}
                onLoadMore={() => void loadMoreCatalog()}
                onSelectPlugin={(id) => {
                  setPluginSettingsTarget(undefined);
                  setSelectedPluginId(id);
                }}
                onInstall={(id, version) =>
                  void run(
                    `plugin-install-${id}`,
                    (api) => api.installPlugin(id, version),
                    t('notifications.pluginInstalled'),
                  )
                }
                onCancelInstall={(id) => void cancelPluginInstall(id)}
                onUninstall={(id) =>
                  void run(
                    `plugin-uninstall-${id}`,
                    (api) => api.uninstallPlugin(id),
                    t('notifications.pluginUninstalled'),
                  )
                }
              />
            )}
            {view === 'activity' && <ActivityPage entries={snapshot.audit} appName={snapshot.appName} />}
            {view === 'plugin-settings' && (
              <PluginSettingsPage
                catalog={snapshot.catalogPlugins}
                busy={Boolean(busy)}
                autoUpdatePlugins={snapshot.autoUpdatePlugins}
                pluginDevelopmentEnabled={snapshot.pluginDevelopmentEnabled}
                onPluginDevelopmentChange={() =>
                  void run('plugin-development', (api) =>
                    api.setPluginDevelopmentEnabled(!snapshot.pluginDevelopmentEnabled),
                  )
                }
                onAutoUpdatePluginsChange={() =>
                  void run('plugin-auto-update', (api) => api.setAutoUpdatePlugins(!snapshot.autoUpdatePlugins))
                }
                onListOrphanedPluginData={() => run('plugin-data-scan', (api) => api.listOrphanedPluginData())}
                onResetOrphanedPluginData={async (ids) => {
                  const result = await run('plugin-data-reset', (api) => api.resetOrphanedPluginData(ids));
                  if (!result) return false;
                  const feedback = pluginDataCleanupFeedback(result);
                  toast[feedback.tone](t(feedback.key), { id: 'seed-plugin-data-reset-result' });
                  return true;
                }}
              />
            )}
            {view === 'settings' && (
              <SettingsPage
                snapshot={snapshot}
                themePreference={themePreference}
                reducedMotionPreference={reducedMotionPreference}
                onReducedMotionChange={setReducedMotionPreference}
                resolvedTheme={resolvedTheme}
                notificationsBusy={busy === 'system-notifications'}
                onSystemNotificationsChange={() =>
                  void run('system-notifications', (api) =>
                    api.setSystemNotificationsEnabled(!snapshot.systemNotificationsEnabled),
                  )
                }
                onThemeChange={(preference) =>
                  void run(
                    'theme-preference',
                    (api) => api.setThemePreference(preference),
                    t('notifications.settingUpdated'),
                  )
                }
                onPreventSystemSleepChange={() =>
                  void run(
                    'prevent-system-sleep',
                    (api) => api.setPreventSystemSleep(!snapshot.preventSystemSleep),
                    t('notifications.settingUpdated'),
                  )
                }
                onLaunchAtLoginChange={() =>
                  void run(
                    'login-item',
                    (api) => api.setLaunchAtLogin(!snapshot.launchAtLogin),
                    t('notifications.settingUpdated'),
                  )
                }
                onCheckForUpdates={() =>
                  void run('update-check', (api) => api.checkForUpdates(), t('settings.updateCurrent'))
                }
                onDownloadUpdate={() => void run('update-download', (api) => api.downloadUpdate())}
                onInstallUpdate={() => void run('update-install', (api) => api.installUpdate())}
              />
            )}
            {view === 'usage' && <UsagePage plugins={plugins} user={snapshot.user} />}
          </main>
        </section>
      </div>
      {globalToaster}
      {profileEditing && <ProfileEditDialog user={snapshot.user} onClose={() => setProfileEditing(false)} />}
      {!!snapshot.announcements?.length && !profileEditing && (
        <AnnouncementDialog announcements={snapshot.announcements} locale={locale} />
      )}
    </>
  );
}
