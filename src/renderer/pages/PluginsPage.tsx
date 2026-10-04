import { PackageCheck, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState, type RefObject } from 'react'
import type { PluginConfigurationOption, PluginConfigurationProfileStatus, PluginConfigurationState, QueryPluginConfigurationOptionsInput, QueryPluginConfigurationProfileStatusesInput, ReconnectPluginConfigurationProfileInput, SeedCatalogPlugin, SeedInstalledPlugin, UpdatePluginConfigurationInput } from '../../shared/contracts'
import { resolveSeedLocalizedText, type SeedLocalizedText } from '../../shared/plugin-manifest'
import { useTranslation } from 'react-i18next'
import { ActionButton } from '../components/ActionButton'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SearchInput } from '../components/SearchInput'
import { InfiniteScrollTrigger } from '../components/InfiniteScrollTrigger'
import { Tooltip } from '../components/Tooltip'
import { MarkdownContent } from '../components/MarkdownContent'
import { resourceCardGridClass } from '../components/ResourceCard'
import { CatalogPluginCard, CatalogPluginMark, McpMark, OfficialMark, PluginMark, PluginVersionTransition } from '../features/plugins/PluginCards'
import { pluginMcpTools } from '../features/plugins/mcp-tools'
import { isCatalogPluginInstallable } from '../features/plugins/plugin-updates'
import { PluginConfigurationPanel } from '../features/plugins/PluginConfigurationPanel'
import { PluginConfigurationCatalogList, PluginConfigurationOptionList } from '../features/plugins/PluginConfigurationOptionList'
import { PluginConfigurationSourceGroup } from '../features/plugins/PluginConfigurationSourceGroup'
import { PluginDetailPresentation } from '../features/plugins/PluginDetailPresentation'
import { PluginManagementView } from '../features/plugins/PluginManagementView'
import { useSeedI18n } from '../i18n'

function searchableText(value: SeedLocalizedText) {
  return `${value.en_US} ${value.zh_Hans}`
}

const configurationRenderers = {
  'seed.form': PluginConfigurationPanel,
  'seed.profiles': PluginConfigurationPanel,
  'seed.option-list': PluginConfigurationOptionList,
  'seed.catalog-list': PluginConfigurationCatalogList,
} as const

type PluginsPageProps = {
  appName: string
  plugins: SeedInstalledPlugin[]
  catalogPlugins: SeedCatalogPlugin[]
  selectedPlugin?: SeedInstalledPlugin | SeedCatalogPlugin
  query: string
  searchRef: RefObject<HTMLInputElement | null>
  busy: string
  hasMore: boolean
  loadingMore: boolean
  updateHighlightRevision: number
  configurationStates: Record<string, PluginConfigurationState>
  onQueryChange: (query: string) => void
  onLoadMore: () => void
  onSelectPlugin: (id: string) => void
  onInstall: (id: string, version: string) => void
  onUninstall: (id: string) => void
  onUpdateConfiguration: (input: UpdatePluginConfigurationInput) => Promise<void>
  onQueryConfigurationOptions: (input: QueryPluginConfigurationOptionsInput) => Promise<PluginConfigurationOption[]>
  onQueryConfigurationProfileStatuses: (input: QueryPluginConfigurationProfileStatusesInput) => Promise<PluginConfigurationProfileStatus[]>
  onReconnectConfigurationProfile: (input: ReconnectPluginConfigurationProfileInput) => Promise<void>
  onQueryManagementView: (input: { pluginId: string; viewId: string; sourceId?: string; arguments?: Record<string, unknown> }) => Promise<unknown>
  onInvokeManagementAction: (input: { pluginId: string; viewId: string; actionId: string; arguments: Record<string, unknown> }) => Promise<unknown>
}

export function PluginsPage({ appName, plugins, catalogPlugins, selectedPlugin, query, searchRef, busy, hasMore, loadingMore, updateHighlightRevision, configurationStates, onQueryChange, onLoadMore, onSelectPlugin, onInstall, onUninstall, onUpdateConfiguration, onQueryConfigurationOptions, onQueryConfigurationProfileStatuses, onReconnectConfigurationProfile, onQueryManagementView, onInvokeManagementAction }: PluginsPageProps) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const [confirmation, setConfirmation] = useState<
    | { kind: 'install'; plugin: SeedCatalogPlugin; version: string; updating: boolean; currentVersion?: string }
    | { kind: 'uninstall'; plugin: SeedInstalledPlugin }
  >()
  const [sourceFilter, setSourceFilter] = useState<'all' | 'public' | 'organization'>('all')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const installedById = new Map(plugins.map((plugin) => [plugin.id, plugin]))
  const pluginNamesById = new Map<string, string>([
    ...catalogPlugins.map((plugin) => [plugin.id, resolveSeedLocalizedText(plugin.name, locale)] as const),
    ...plugins.map((plugin) => [plugin.id, resolveSeedLocalizedText(plugin.name, locale)] as const),
  ])
  const matches = (plugin: SeedInstalledPlugin | SeedCatalogPlugin) => !normalizedQuery || [
    searchableText(plugin.name),
    plugin.id,
    plugin.publisher,
    searchableText(plugin.description),
    ...plugin.labels.map((label) => t(`plugins.labels.${label}`)),
  ].join(' ').toLocaleLowerCase().includes(normalizedQuery)
  const installedPlugins = plugins.filter(matches)
  const organizationName = catalogPlugins.find((plugin) => plugin.visibility === 'organization' && plugin.organization)?.organization?.name
  const hasOrganizationPlugins = Boolean(organizationName)
  const sourcePlugins = catalogPlugins.filter((plugin) => sourceFilter === 'all' || plugin.visibility === sourceFilter)
  useEffect(() => {
    if (sourceFilter === 'organization' && !hasOrganizationPlugins) {
      setSourceFilter('all')
    }
  }, [hasOrganizationPlugins, sourceFilter])
  const visiblePlugins = sourcePlugins.filter(matches)
  const confirmationPackageSha256 = confirmation?.kind === 'install'
    ? confirmation.plugin.versions.find((version) => version.version === confirmation.version)?.packageSha256 ?? confirmation.plugin.packageSha256
    : ''
  const selectedInstalledPlugin = selectedPlugin && 'source' in selectedPlugin ? selectedPlugin : undefined
  const selectedCatalogPlugin = selectedPlugin
    ? catalogPlugins.find((plugin) => plugin.id === selectedPlugin.id)
      ?? (!('source' in selectedPlugin) ? selectedPlugin : undefined)
    : undefined
  const selectedLatestRelease = selectedCatalogPlugin?.versions.find((version) => version.version === selectedCatalogPlugin.latestVersion)
  const selectedCatalogInstallable = selectedCatalogPlugin ? isCatalogPluginInstallable(selectedCatalogPlugin) : false
  const selectedVersion = selectedInstalledPlugin?.version ?? selectedCatalogPlugin?.latestVersion
  const selectedUpdateAvailable = Boolean(
    selectedInstalledPlugin
    && selectedCatalogPlugin
    && selectedInstalledPlugin.version !== selectedCatalogPlugin.latestVersion
    && selectedCatalogInstallable,
  )

  const confirmationDialog = confirmation && <ConfirmDialog
    open
    title={confirmation.kind === 'install'
      ? t(confirmation.updating ? 'plugins.confirmUpdateTitle' : 'plugins.confirmInstallTitle', {
        name: resolveSeedLocalizedText(confirmation.plugin.name, locale),
      })
      : t('plugins.confirmUninstallTitle', { name: resolveSeedLocalizedText(confirmation.plugin.name, locale) })}
    description={confirmation.kind === 'install' ? t('plugins.confirmInstallDescription') : t('plugins.confirmUninstallDescription')}
    confirmLabel={confirmation.kind === 'install'
      ? t(confirmation.updating ? 'plugins.update' : 'plugins.install')
      : t('plugins.uninstall')}
    cancelLabel={t('common.cancel')}
    tone={confirmation.kind === 'install' ? 'primary' : 'danger'}
    onCancel={() => setConfirmation(undefined)}
    onConfirm={() => {
      if (confirmation.kind === 'install') onInstall(confirmation.plugin.id, confirmation.version)
      else onUninstall(confirmation.plugin.id)
      setConfirmation(undefined)
    }}
  >
    {confirmation.kind === 'install' && <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
      <dt className="text-muted-foreground">{t('plugins.publisher')}</dt>
      <dd className="m-0 truncate text-foreground">{confirmation.plugin.publisher}</dd>
      <dt className="text-muted-foreground">{t('plugins.version')}</dt>
      <dd className="m-0 text-foreground">{confirmation.updating && confirmation.currentVersion
        ? <PluginVersionTransition currentVersion={confirmation.currentVersion} targetVersion={confirmation.version} large />
        : confirmation.version}</dd>
      <dt className="text-muted-foreground">{t('plugins.integrity')}</dt>
      <dd className="m-0 min-w-0">
        <Tooltip content={confirmationPackageSha256}>
          <code className="block min-w-0 break-all font-mono text-[11px] leading-5 text-foreground">{confirmationPackageSha256}</code>
        </Tooltip>
      </dd>
    </dl>}
  </ConfirmDialog>

  if (selectedPlugin) return <><section className="mx-auto flex min-h-full w-full max-w-[730px] flex-col animate-[rise_.25s_ease_both]">
    <div className="sticky top-0 z-10 grid shrink-0 grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-4 bg-background pb-6 pt-4">
      {selectedInstalledPlugin
        ? <PluginMark plugin={selectedInstalledPlugin} large />
        : selectedCatalogPlugin ? <CatalogPluginMark plugin={selectedCatalogPlugin} large /> : null}
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <h2 className="m-0 text-[20px] font-medium">{resolveSeedLocalizedText(selectedPlugin.name, locale)}</h2>
          {selectedPlugin.publisherType === 'official' && <OfficialMark appName={appName} />}
          {selectedInstalledPlugin && pluginMcpTools(selectedInstalledPlugin).length > 0 && <McpMark />}
          {selectedCatalogPlugin?.visibility === 'organization' && selectedCatalogPlugin.organization && <span className="max-w-[140px] truncate rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-medium text-info">
            {t('plugins.organizationName', { name: selectedCatalogPlugin.organization.name })}
          </span>}
          {selectedVersion && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">{selectedVersion}</span>}
          {selectedPlugin.labels.map((label) => <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" key={label}>{t(`plugins.labels.${label}`)}</span>)}
        </div>
        <p className="mb-0 mt-1.5 max-w-[600px] text-[13px] text-muted-foreground">{resolveSeedLocalizedText(selectedPlugin.description, locale)}</p>
      </div>
      <div className="flex items-center gap-2">
        {selectedInstalledPlugin ? <>
          {selectedUpdateAvailable && selectedCatalogPlugin && <ActionButton
            tone="info"
            icon={<RefreshCw size={14} />}
            busy={busy === `plugin-install-${selectedCatalogPlugin.id}`}
            onClick={() => setConfirmation({
              kind: 'install',
              plugin: selectedCatalogPlugin,
              version: selectedCatalogPlugin.latestVersion,
              updating: true,
              currentVersion: selectedInstalledPlugin.version,
            })}
          >
            {busy === `plugin-install-${selectedCatalogPlugin.id}` ? t('plugins.updating') : t('plugins.update')}
          </ActionButton>}
          <ActionButton tone="danger" icon={<Trash2 size={14} />} busy={busy === `plugin-uninstall-${selectedInstalledPlugin.id}`} onClick={() => setConfirmation({ kind: 'uninstall', plugin: selectedInstalledPlugin })}>{busy === `plugin-uninstall-${selectedInstalledPlugin.id}` ? t('plugins.uninstalling') : t('plugins.uninstall')}</ActionButton>
        </> : selectedCatalogPlugin ? <ActionButton
          busy={busy === `plugin-install-${selectedCatalogPlugin.id}`}
          disabled={!selectedCatalogInstallable}
          onClick={() => setConfirmation({ kind: 'install', plugin: selectedCatalogPlugin, version: selectedCatalogPlugin.latestVersion, updating: false })}
        >{busy === `plugin-install-${selectedCatalogPlugin.id}` ? t('plugins.installing') : selectedCatalogInstallable ? t('plugins.install') : t('plugins.incompatible')}</ActionButton> : null}
      </div>
    </div>
    {selectedInstalledPlugin?.status === 'incompatible' && <section className="rounded-[14px] border border-border px-4 py-3">
      <strong className="block text-[14px] font-medium text-foreground">{t('plugins.installedVersionIncompatible')}</strong>
      <p className="mb-0 mt-1 text-[12px] leading-5 text-muted-foreground">{selectedInstalledPlugin.incompatibilityReason || t('plugins.installedVersionIncompatibleDescription')}</p>
    </section>}
    {!selectedInstalledPlugin && selectedCatalogPlugin && !selectedCatalogPlugin.compatible && <p className="m-0 text-[12px] text-muted-foreground">{selectedCatalogPlugin.minSeedVersion
      ? t('plugins.requiresSeedVersion', { version: selectedCatalogPlugin.minSeedVersion })
      : t('plugins.missingSeedVersion')}</p>}
    {!selectedInstalledPlugin && selectedCatalogPlugin?.readme && <section className="mt-2 rounded-[16px] border border-border bg-muted/20 px-6 py-5">
      <MarkdownContent>{resolveSeedLocalizedText(selectedCatalogPlugin.readme, locale)}</MarkdownContent>
    </section>}
    {selectedInstalledPlugin && pluginMcpTools(selectedInstalledPlugin).length > 0 && <section className="mt-2 rounded-[14px] border border-border px-4 py-3">
      <h3 className="m-0 text-[14px] font-medium">{t('plugins.mcpTools')}</h3>
      <p className="mb-0 mt-1 text-[12px] text-muted-foreground">{pluginMcpTools(selectedInstalledPlugin).join(' · ')}</p>
    </section>}
    {selectedInstalledPlugin?.detailPresentation && <PluginDetailPresentation presentation={selectedInstalledPlugin.detailPresentation} />}
    {selectedInstalledPlugin?.configurations.map((configuration) => {
      const sourceGroup = configuration.profiles.defaultGroup && configuration.sourcePresentation
        ? selectedInstalledPlugin.configurations.filter((candidate) => (
          candidate.renderer === 'seed.profiles' || candidate.renderer === 'seed.option-list' || candidate.renderer === 'seed.catalog-list'
        )
          && candidate.profiles.defaultGroup === configuration.profiles.defaultGroup
          && candidate.sourcePresentation)
        : []
      if (sourceGroup.length > 1) {
        if (sourceGroup[0].id !== configuration.id) return null
        const sources = sourceGroup.flatMap((candidate) => {
          const state = configurationStates[`${selectedInstalledPlugin.id}:${candidate.id}`]
          return state ? [{ configuration: candidate, state }] : []
        })
        return sources.length === sourceGroup.length ? <PluginConfigurationSourceGroup
          key={`source-group:${configuration.profiles.defaultGroup}`}
          pluginId={selectedInstalledPlugin.id}
          sources={sources}
          pluginNames={pluginNamesById}
          busy={busy === `plugin-config-${selectedInstalledPlugin.id}`}
          onSave={onUpdateConfiguration}
          onQueryOptions={onQueryConfigurationOptions}
          onQueryProfileStatuses={onQueryConfigurationProfileStatuses}
          onReconnectProfile={onReconnectConfigurationProfile}
        /> : null
      }
      const Renderer = configurationRenderers[configuration.renderer as keyof typeof configurationRenderers]
      const configurationKey = `${selectedInstalledPlugin.id}:${configuration.id}`
      const configurationState = configurationStates[configurationKey]
      if (Renderer) return configurationState ? <Renderer
        key={configurationKey}
        pluginId={selectedInstalledPlugin.id}
        configuration={configuration}
        state={configurationState}
        pluginNames={pluginNamesById}
        busy={busy === `plugin-config-${selectedInstalledPlugin.id}`}
        onSave={onUpdateConfiguration}
        onQueryOptions={onQueryConfigurationOptions}
        onQueryProfileStatuses={onQueryConfigurationProfileStatuses}
        onReconnectProfile={onReconnectConfigurationProfile}
      /> : null
      return <section className="mt-8 rounded-[14px] border border-border px-4 py-3" key={configurationKey}>
        <strong className="block text-[14px] font-medium text-foreground">{resolveSeedLocalizedText(configuration.title, locale)}</strong>
        <p className="mb-0 mt-1 text-[12px] text-muted-foreground">{t('plugins.unsupportedRenderer', { renderer: configuration.renderer })}</p>
      </section>
    })}
    {selectedInstalledPlugin?.managementViews.filter((view) => (view.renderer === 'seed.collection' || view.renderer === 'seed.panel') && view.source).map((view) => <PluginManagementView
      key={view.id}
      pluginId={selectedInstalledPlugin.id}
      view={view}
      query={onQueryManagementView}
      invoke={onInvokeManagementAction}
    />)}
    {selectedLatestRelease?.releaseNotes && <section className="mt-8">
      <div>
        <h3 className="m-0 text-[17px] font-medium">{t('plugins.releaseNotes')}</h3>
        <p className="mb-0 mt-1 text-[12px] leading-5 text-muted-foreground">{t('plugins.releaseNotesDescription')}</p>
      </div>
      <p className="mb-0 mt-3 whitespace-pre-wrap text-[13px] leading-6 text-muted-foreground">{selectedLatestRelease.releaseNotes}</p>
    </section>}
  </section>{confirmationDialog}</>

  return <><section className="mx-auto w-full max-w-[730px] [--plugin-search-sticky-height:60px] animate-[rise_.25s_ease_both]">
    <div className="sticky top-0 z-20 flex h-[var(--plugin-search-sticky-height)] items-start bg-background pt-4">
      <SearchInput
        ref={searchRef}
        clearLabel={t('common.clearSearch')}
        label={t('plugins.search')}
        onValueChange={onQueryChange}
        placeholder={t('plugins.search')}
        value={query}
      />
    </div>
    {installedPlugins.length > 0 && <section className="mb-7 mt-4">
      <div className="pb-2 pl-2"><h3 className="m-0 text-[17px] font-medium">{t('plugins.installedSection')}</h3></div>
      <div className="flex min-h-[52px] flex-wrap items-center gap-3 px-2 py-2">
        {installedPlugins.map((plugin) => {
          const name = resolveSeedLocalizedText(plugin.name, locale)
          return (
            <Tooltip content={name} key={plugin.id}>
              <button className="rounded-xl transition hover:-translate-y-0.5" onClick={() => onSelectPlugin(plugin.id)} aria-label={name}>
                <PluginMark plugin={plugin} />
              </button>
            </Tooltip>
          )
        })}
      </div>
    </section>}
    <section>
      <div className="px-1">
        <h3 className="m-0 text-[17px] font-medium">{t('plugins.availableSection')}</h3>
        {hasOrganizationPlugins && <div className="mt-4 flex flex-wrap items-center gap-1" aria-label={t('plugins.sourceFilter')}>
          {(['all', 'public', 'organization'] as const).map((source) => <button
            className={`h-7 rounded-full px-3 text-[12px] transition-colors ${sourceFilter === source ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            key={source}
            type="button"
            aria-pressed={sourceFilter === source}
            onClick={() => setSourceFilter(source)}
          >{source === 'organization'
              ? t('plugins.organizationName', { name: organizationName })
              : t(`plugins.sources.${source}`)}</button>)}
        </div>}
      </div>
    <div>
      {visiblePlugins.length
        ? <div className={resourceCardGridClass()}>
            {visiblePlugins.map((plugin) => {
              return <CatalogPluginCard
                key={plugin.id}
                plugin={plugin}
                appName={appName}
                installedPlugin={installedById.get(plugin.id)}
                installing={busy === `plugin-install-${plugin.id}`}
                updateHighlightRevision={updateHighlightRevision}
                onInstall={() => setConfirmation({
                  kind: 'install',
                  plugin,
                  version: plugin.latestVersion,
                  updating: installedById.has(plugin.id),
                  currentVersion: installedById.get(plugin.id)?.version,
                })}
                onOpen={() => onSelectPlugin(plugin.id)}
              />
            })}
          </div>
        : <div className="flex min-h-[240px] flex-col items-center justify-center text-center text-muted-foreground">
            <PackageCheck size={27} />
            <strong className="mb-1.5 mt-3 text-[14px] font-medium text-foreground">{t('plugins.noMatches')}</strong>
            <p className="m-0 text-[12px]">{t('plugins.searchHint')}</p>
          </div>}
    </div>
    <InfiniteScrollTrigger
      hasMore={hasMore}
      label={t('common.loadingMore')}
      loading={loadingMore}
      onLoadMore={onLoadMore}
    />
    </section>
  </section>{confirmationDialog}</>
}
