import { ListFilter, PackageCheck } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import type { PluginInstallProgress, SeedCatalogPlugin, SeedInstalledPlugin } from '../../shared/contracts';
import { resolveSeedLocalizedText, type SeedLocalizedText } from '../../shared/plugin-manifest';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SearchInput } from '../components/SearchInput';
import { InfiniteScrollTrigger } from '../components/InfiniteScrollTrigger';
import { MarkdownContent, SelectControl, Tooltip } from '@motus-ai/seed-sdk/react';
import { resourceCardGridClass } from '../components/ResourceCard';
import {
  CatalogPluginCard,
  CatalogPluginMark,
  McpMark,
  OfficialMark,
  PluginDevMark,
  PluginMark,
  PluginVersionTransition,
} from '../features/plugins/PluginCards';
import { PluginActionButton } from '../features/plugins/PluginActionButton';
import { PluginDetailActions } from '../features/plugins/PluginDetailActions';
import { PluginListSkeleton } from '../features/plugins/PluginListSkeleton';
import { pluginMcpTools } from '../features/plugins/mcp-tools';
import { isCatalogPluginInstallable } from '../../shared/plugin-updates';
import { compareSeedVersions } from '../../shared/seed-version';
import { PluginViewSurface } from '../features/plugins/PluginViewSurface';
import type { PluginHeaderNavigation } from '../features/plugins/plugin-navigation';
import { useSeedI18n } from '../i18n';

function searchableText(value: SeedLocalizedText) {
  return `${value.en_US} ${value.zh_Hans}`;
}

type PluginsPageProps = {
  appName: string;
  plugins: SeedInstalledPlugin[];
  catalogPlugins: SeedCatalogPlugin[];
  catalogLabels?: string[];
  catalogOrganizations?: Array<NonNullable<SeedCatalogPlugin['organization']>>;
  installedLoading: boolean;
  installedError?: boolean;
  catalogLoading: boolean;
  catalogError?: string;
  selectedPlugin?: SeedInstalledPlugin | SeedCatalogPlugin;
  pluginNavigation?: PluginHeaderNavigation;
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
  busy: string;
  updateCount: number;
  updatesBusy: boolean;
  onUpdateAll: () => void;
  installProgress: Record<string, PluginInstallProgress>;
  hasMore: boolean;
  loadingMore: boolean;
  onQueryChange: (query: string) => void;
  onLoadMore: () => void;
  onSelectPlugin: (id: string) => void;
  onInstall: (id: string, version: string) => void;
  onCancelInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  onNavigationChange?: (navigation: PluginHeaderNavigation | undefined) => void;
};

export function PluginsPage({
  appName,
  plugins,
  catalogPlugins,
  catalogLabels,
  catalogOrganizations,
  installedLoading,
  installedError,
  catalogLoading,
  catalogError,
  selectedPlugin,
  pluginNavigation,
  query,
  searchRef,
  busy,
  updateCount,
  updatesBusy,
  onUpdateAll,
  installProgress,
  hasMore,
  loadingMore,
  onQueryChange,
  onLoadMore,
  onSelectPlugin,
  onInstall,
  onCancelInstall,
  onUninstall,
  onNavigationChange,
}: PluginsPageProps) {
  const { t } = useTranslation();
  const { locale } = useSeedI18n();
  const [confirmation, setConfirmation] = useState<
    | { kind: 'install'; plugin: SeedCatalogPlugin; version: string; updating: boolean; currentVersion?: string }
    | { kind: 'uninstall'; plugin: SeedInstalledPlugin }
  >();
  const [sourceFilter, setSourceFilter] = useState<'all' | 'public' | `organization:${string}`>('all');
  const [labelFilter, setLabelFilter] = useState('all');
  // Use the full directory metadata, independently of keyword search pages.
  const availableLabels = Array.from(new Set(catalogLabels ?? catalogPlugins.flatMap((plugin) => plugin.labels)));
  const selectedLabelMissing = labelFilter !== 'all' && !availableLabels.includes(labelFilter);
  if (catalogLoading && selectedLabelMissing) availableLabels.push(labelFilter);
  useEffect(() => {
    if (!catalogLoading && selectedLabelMissing && (catalogLabels !== undefined || !query.trim())) {
      setLabelFilter('all');
    }
  }, [catalogLoading, selectedLabelMissing, catalogLabels, query]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const installedById = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const matches = (plugin: SeedInstalledPlugin | SeedCatalogPlugin) =>
    (labelFilter === 'all' || plugin.labels.some((label) => label === labelFilter)) &&
    (!normalizedQuery ||
      [
        searchableText(plugin.name),
        plugin.id,
        plugin.publisher,
        searchableText(plugin.description),
        ...plugin.labels.map((label) => t(`plugins.labels.${label}`)),
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedQuery));
  const installedPlugins = plugins.filter(matches);
  const organizations = new Map<string, string>();
  const availableOrganizations =
    catalogOrganizations ??
    catalogPlugins.flatMap((plugin) =>
      plugin.visibility === 'organization' && plugin.organization ? [plugin.organization] : [],
    );
  for (const organization of availableOrganizations) {
    if (!organizations.has(organization.id)) organizations.set(organization.id, organization.name);
  }
  const sourceFilters = [
    { key: 'all' as const, label: t('plugins.sources.all') },
    { key: 'public' as const, label: t('plugins.sources.public') },
    ...Array.from(organizations, ([id, name]) => ({
      key: `organization:${id}` as const,
      label: t('plugins.organizationName', { name }),
    })),
  ];
  const selectedOrganizationId = sourceFilter.startsWith('organization:')
    ? sourceFilter.slice('organization:'.length)
    : undefined;
  const selectedOrganizationMissing =
    selectedOrganizationId !== undefined && !organizations.has(selectedOrganizationId);
  const sourcePlugins = catalogPlugins.filter(
    (plugin) =>
      sourceFilter === 'all' ||
      (sourceFilter === 'public'
        ? plugin.visibility === 'public'
        : plugin.visibility === 'organization' && plugin.organization?.id === selectedOrganizationId),
  );
  useEffect(() => {
    if (!catalogLoading && selectedOrganizationMissing) {
      setSourceFilter('all');
    }
  }, [catalogLoading, selectedOrganizationMissing]);
  const visiblePlugins = sourcePlugins.filter(matches);
  const selectedInstalledPlugin = selectedPlugin && 'source' in selectedPlugin ? selectedPlugin : undefined;
  const isPluginSubpage =
    selectedInstalledPlugin?.status === 'ready' &&
    pluginNavigation?.pluginId === selectedInstalledPlugin.id &&
    pluginNavigation.path.length > 0;
  const selectedCatalogPlugin = selectedPlugin
    ? (catalogPlugins.find((plugin) => plugin.id === selectedPlugin.id) ??
      (!('source' in selectedPlugin) ? selectedPlugin : undefined))
    : undefined;
  const selectedLatestRelease = selectedCatalogPlugin?.versions.find(
    (version) => version.version === selectedCatalogPlugin.latestVersion,
  );
  const selectedCatalogInstallable = selectedCatalogPlugin ? isCatalogPluginInstallable(selectedCatalogPlugin) : false;
  const selectedVersion = selectedInstalledPlugin?.version ?? selectedCatalogPlugin?.latestVersion;
  const selectedInstallProgress = selectedPlugin ? installProgress[selectedPlugin.id] : undefined;
  const selectedInstallBusy = Boolean(selectedCatalogPlugin && busy === `plugin-install-${selectedCatalogPlugin.id}`);
  const selectedUpdateAvailable = Boolean(
    selectedInstalledPlugin &&
    selectedCatalogPlugin &&
    compareSeedVersions(selectedInstalledPlugin.version, selectedCatalogPlugin.latestVersion) < 0 &&
    selectedCatalogInstallable,
  );
  const confirmationDialog = confirmation && (
    <ConfirmDialog
      open
      icon={confirmation.kind === 'install' ? <CatalogPluginMark plugin={confirmation.plugin} /> : undefined}
      title={
        confirmation.kind === 'install'
          ? t(confirmation.updating ? 'plugins.confirmUpdateTitle' : 'plugins.confirmInstallTitle', {
              name: resolveSeedLocalizedText(confirmation.plugin.name, locale),
            })
          : t('plugins.confirmUninstallTitle', { name: resolveSeedLocalizedText(confirmation.plugin.name, locale) })
      }
      description={confirmation.kind === 'uninstall' ? t('plugins.confirmUninstallDescription') : undefined}
      confirmLabel={
        confirmation.kind === 'install'
          ? t(confirmation.updating ? 'plugins.update' : 'plugins.install')
          : t('plugins.uninstall')
      }
      cancelLabel={t('common.cancel')}
      tone={confirmation.kind === 'install' ? 'primary' : 'danger'}
      confirmDisabled={updatesBusy}
      onCancel={() => setConfirmation(undefined)}
      onConfirm={() => {
        if (confirmation.kind === 'install') onInstall(confirmation.plugin.id, confirmation.version);
        else onUninstall(confirmation.plugin.id);
        setConfirmation(undefined);
      }}
    >
      {confirmation.kind === 'install' && (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">{t('plugins.publisher')}</dt>
          <dd className="m-0 truncate text-foreground">{confirmation.plugin.publisher}</dd>
          <dt className="text-muted-foreground">{t('plugins.version')}</dt>
          <dd className="m-0 text-foreground">
            {confirmation.updating && confirmation.currentVersion ? (
              <PluginVersionTransition
                currentVersion={confirmation.currentVersion}
                targetVersion={confirmation.version}
                large
              />
            ) : (
              confirmation.version
            )}
          </dd>
        </dl>
      )}
    </ConfirmDialog>
  );

  if (selectedPlugin)
    return (
      <>
        <section className="mx-auto flex min-h-full w-full max-w-[730px] flex-col animate-[rise_.25s_ease_both]">
          <div
            data-plugin-information
            hidden={isPluginSubpage}
            className="sticky top-0 z-10 grid shrink-0 grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-4 bg-background pb-6 pt-4"
          >
            {selectedInstalledPlugin ? (
              <PluginMark plugin={selectedInstalledPlugin} large />
            ) : selectedCatalogPlugin ? (
              <CatalogPluginMark plugin={selectedCatalogPlugin} large />
            ) : null}
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <h2 className="m-0 text-[20px] font-medium">{resolveSeedLocalizedText(selectedPlugin.name, locale)}</h2>
                {selectedPlugin.publisherType === 'official' && <OfficialMark appName={appName} />}
                {selectedInstalledPlugin && pluginMcpTools(selectedInstalledPlugin).length > 0 && <McpMark />}
                {selectedCatalogPlugin?.visibility === 'organization' && selectedCatalogPlugin.organization && (
                  <span className="max-w-[140px] truncate rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-medium text-info">
                    {t('plugins.organizationName', { name: selectedCatalogPlugin.organization.name })}
                  </span>
                )}
                <PluginDevMark plugin={selectedInstalledPlugin} />
                {selectedVersion && (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                    {selectedVersion}
                  </span>
                )}
                {selectedPlugin.labels.map((label) => (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" key={label}>
                    {t(`plugins.labels.${label}`)}
                  </span>
                ))}
              </div>
              <p className="mb-0 mt-1.5 max-w-[600px] text-[13px] text-muted-foreground">
                {resolveSeedLocalizedText(selectedPlugin.description, locale)}
              </p>
            </div>
            {selectedInstalledPlugin?.source !== 'development' && (
              <PluginDetailActions
                installed={Boolean(selectedInstalledPlugin)}
                updateAvailable={selectedUpdateAvailable}
                installable={selectedCatalogInstallable}
                progress={selectedInstallProgress}
                installing={selectedInstallBusy}
                uninstalling={Boolean(
                  selectedInstalledPlugin && busy === `plugin-uninstall-${selectedInstalledPlugin.id}`,
                )}
                updatesBusy={updatesBusy}
                onUpdate={() =>
                  selectedCatalogPlugin &&
                  selectedInstalledPlugin &&
                  setConfirmation({
                    kind: 'install',
                    plugin: selectedCatalogPlugin,
                    version: selectedCatalogPlugin.latestVersion,
                    updating: true,
                    currentVersion: selectedInstalledPlugin.version,
                  })
                }
                onUninstall={() =>
                  selectedInstalledPlugin && setConfirmation({ kind: 'uninstall', plugin: selectedInstalledPlugin })
                }
                onInstall={() =>
                  selectedCatalogPlugin &&
                  setConfirmation({
                    kind: 'install',
                    plugin: selectedCatalogPlugin,
                    version: selectedCatalogPlugin.latestVersion,
                    updating: false,
                  })
                }
                onCancel={() => onCancelInstall(selectedPlugin.id)}
              />
            )}
          </div>
          {selectedInstalledPlugin?.status === 'incompatible' && (
            <section className="rounded-[14px] border border-border px-4 py-3">
              <strong className="block text-[14px] font-medium text-foreground">
                {t('plugins.installedVersionIncompatible')}
              </strong>
            </section>
          )}
          {!selectedInstalledPlugin && selectedCatalogPlugin && !selectedCatalogPlugin.compatible && (
            <p className="m-0 text-[12px] text-muted-foreground">
              {selectedCatalogPlugin.minSeedVersion
                ? t('plugins.requiresSeedVersion', { version: selectedCatalogPlugin.minSeedVersion })
                : t('plugins.missingSeedVersion')}
            </p>
          )}
          {!selectedInstalledPlugin && selectedCatalogPlugin?.readme && (
            <section className="mt-2 rounded-[16px] border border-border bg-muted/20 px-6 py-5">
              <MarkdownContent>{resolveSeedLocalizedText(selectedCatalogPlugin.readme, locale)}</MarkdownContent>
            </section>
          )}
          {selectedInstalledPlugin?.status === 'ready' && (
            <PluginViewSurface
              revision={selectedInstalledPlugin.manifestDigest}
              pluginId={selectedInstalledPlugin.id}
              onNavigationChange={onNavigationChange}
            />
          )}
          {selectedLatestRelease?.releaseNotes && (
            <section hidden={isPluginSubpage} className="mt-8">
              <div>
                <h3 className="m-0 text-[17px] font-medium">{t('plugins.releaseNotes')}</h3>
                <p className="mb-0 mt-1 text-[12px] leading-5 text-muted-foreground">
                  {t('plugins.releaseNotesDescription')}
                </p>
              </div>
              <p className="mb-0 mt-3 whitespace-pre-wrap text-[13px] leading-6 text-muted-foreground">
                {selectedLatestRelease.releaseNotes}
              </p>
            </section>
          )}
        </section>
        {confirmationDialog}
      </>
    );

  return (
    <>
      <section className="mx-auto w-full max-w-[730px] [--plugin-search-sticky-height:60px] animate-[rise_.25s_ease_both]">
        <div className="sticky top-0 z-20 flex h-[var(--plugin-search-sticky-height)] items-start bg-background pt-4">
          <SearchInput
            className="gap-2"
            leading={
              <div className="flex shrink-0 items-center border-r border-input pr-1">
                <ListFilter aria-hidden="true" size={16} />
                <SelectControl
                  label={t('plugins.labelFilter')}
                  value={labelFilter}
                  onValueChange={setLabelFilter}
                  options={[
                    { value: 'all', label: t('plugins.allLabels') },
                    ...availableLabels.map((value) => ({
                      value,
                      label: t(`plugins.labels.${value}`, { defaultValue: value }),
                    })),
                  ]}
                  className="max-w-[150px] [&>button]:h-7 [&>button]:min-w-0 [&>button]:gap-1.5 [&>button]:rounded-full [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-2 [&>button]:leading-none [&>button]:text-muted-foreground"
                />
              </div>
            }
            ref={searchRef}
            clearLabel={t('common.clearSearch')}
            label={t('plugins.search')}
            onValueChange={onQueryChange}
            placeholder={t('plugins.search')}
            value={query}
          />
        </div>
        {(installedLoading || installedError || installedPlugins.length > 0) && (
          <section className="mb-7 mt-4" aria-busy={installedLoading}>
            <div className="pb-2 pl-2">
              <h3 className="m-0 text-[16px] font-medium">{t('plugins.installedSection')}</h3>
            </div>
            {installedLoading ? (
              <PluginListSkeleton installed label={t('plugins.loadingInstalled')} />
            ) : installedError ? (
              <p role="alert" className="m-0 px-2 py-2 text-[12px] text-muted-foreground">
                {t('plugins.loadFailed')}
              </p>
            ) : (
              <div className="flex min-h-[52px] flex-wrap items-center justify-start gap-x-2 gap-y-3 px-2 py-2">
                {installedPlugins.map((plugin) => {
                  const name = resolveSeedLocalizedText(plugin.name, locale);
                  const label = plugin.source === 'development' ? `${name} (${t('plugins.localDevelopment')})` : name;
                  return (
                    <Tooltip content={label} key={plugin.id}>
                      <button
                        className="relative rounded-xl transition hover:-translate-y-0.5"
                        onClick={() => onSelectPlugin(plugin.id)}
                        aria-label={label}
                      >
                        <PluginMark plugin={plugin} />
                        <PluginDevMark plugin={plugin} overlay />
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </section>
        )}
        <section aria-busy={catalogLoading}>
          <div className="px-1">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <h3 className="m-0 text-[16px] font-medium">{t('plugins.availableSection')}</h3>
              <PluginActionButton
                action="updateAll"
                busy={updatesBusy}
                disabled={
                  !updatesBusy &&
                  (catalogLoading ||
                    !updateCount ||
                    Boolean(busy) ||
                    Object.values(installProgress).some((progress) => progress.phase !== 'completed'))
                }
                onStart={onUpdateAll}
              />
            </div>
            {organizations.size > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-1" aria-label={t('plugins.sourceFilter')}>
                {sourceFilters.map(({ key, label }) => (
                  <button
                    className={`h-7 rounded-full px-3 text-[12px] transition-colors ${sourceFilter === key ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                    key={key}
                    type="button"
                    aria-pressed={sourceFilter === key}
                    onClick={() => setSourceFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            {visiblePlugins.length ? (
              <div className={resourceCardGridClass()}>
                {visiblePlugins.map((plugin) => {
                  return (
                    <CatalogPluginCard
                      key={plugin.id}
                      plugin={plugin}
                      appName={appName}
                      installedPlugin={installedById.get(plugin.id)}
                      installing={busy === `plugin-install-${plugin.id}`}
                      updatesBusy={updatesBusy}
                      installProgress={installProgress[plugin.id]}
                      onInstall={() =>
                        setConfirmation({
                          kind: 'install',
                          plugin,
                          version: plugin.latestVersion,
                          updating: installedById.has(plugin.id),
                          currentVersion: installedById.get(plugin.id)?.version,
                        })
                      }
                      onCancelInstall={() => onCancelInstall(plugin.id)}
                      onOpen={() => onSelectPlugin(plugin.id)}
                    />
                  );
                })}
              </div>
            ) : catalogLoading || (labelFilter !== 'all' && hasMore && !catalogError) ? (
              <PluginListSkeleton label={t('plugins.loadingAvailable')} />
            ) : catalogError ? (
              <div
                role="alert"
                className="flex min-h-[240px] flex-col items-center justify-center text-center text-muted-foreground"
              >
                <strong className="text-[14px] font-medium text-foreground">{t('plugins.loadFailed')}</strong>
                <p className="mb-0 mt-2 max-w-full break-words text-[12px]">{catalogError}</p>
              </div>
            ) : (
              <div className="flex min-h-[240px] flex-col items-center justify-center text-center text-muted-foreground">
                <PackageCheck size={27} />
                <strong className="mb-1.5 mt-3 text-[14px] font-medium text-foreground">
                  {t('plugins.noMatches')}
                </strong>
                <p className="m-0 text-[12px]">{t('plugins.searchHint')}</p>
              </div>
            )}
          </div>
          <InfiniteScrollTrigger
            hasMore={hasMore && !catalogLoading}
            label={t('common.loadingMore')}
            loading={loadingMore && !catalogLoading}
            onLoadMore={onLoadMore}
          />
        </section>
      </section>
      {confirmationDialog}
    </>
  );
}
