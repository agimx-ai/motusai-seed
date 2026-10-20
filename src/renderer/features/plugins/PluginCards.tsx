import { TriangleAlert } from 'lucide-react';
import type { PluginInstallProgress, SeedCatalogPlugin, SeedInstalledPlugin } from '../../../shared/contracts';
import { resolveSeedLocalizedText } from '../../../shared/plugin-manifest';
import { useTranslation } from 'react-i18next';
import { ActionButton, Tooltip } from '@motus-ai/seed-sdk/react';
import { CatalogPluginIcon, InstalledPluginIcon } from '../../components/PluginIcon';
import { ResourceCard } from '../../components/ResourceCard';
import verifiedIconUrl from '../../assets/verified-light.svg';
import developmentIconUrl from '../../assets/development.svg';
import mcpIconUrl from '../../assets/mcp.svg';
import { cx } from '../../lib/display';
import { useSeedI18n } from '../../i18n';
import { isCatalogPluginInstallable } from './plugin-updates';
import { compareSeedVersions } from '../../../shared/seed-version';
import { pluginMcpTools } from './mcp-tools';
import { PluginActionButton } from './PluginActionButton';

export function OfficialMark({ appName }: { appName: string }) {
  const { t } = useTranslation();
  return (
    <Tooltip content={t('common.officialVerified', { appName })}>
      <img className="h-4 w-4" src={verifiedIconUrl} alt="" aria-hidden="true" />
    </Tooltip>
  );
}

export function McpMark() {
  const { t } = useTranslation();
  return (
    <Tooltip content={t('plugins.mcpToolsAvailable')}>
      <span className="grid h-4 w-4 shrink-0 place-items-center" role="img" aria-label={t('plugins.mcpToolsAvailable')}>
        <img className="h-3.5 w-3.5 dark:invert" src={mcpIconUrl} alt="" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}

export function PluginDevMark({ plugin, overlay = false }: { plugin?: SeedInstalledPlugin; overlay?: boolean }) {
  const { t } = useTranslation();
  if (plugin?.source !== 'development') return null;
  const label = t('plugins.localDevelopment');
  const mark = (
    <span
      className={cx(
        'grid h-4 w-4 shrink-0 place-items-center text-muted-foreground',
        overlay && 'pointer-events-none absolute -bottom-1 -right-1 rounded-full bg-background ring-2 ring-background',
      )}
      role="img"
      aria-label={label}
    >
      <span
        className="h-3.5 w-3.5 bg-current"
        style={{ mask: `url("${developmentIconUrl}") center / contain no-repeat` }}
        aria-hidden="true"
      />
    </span>
  );
  return overlay ? mark : <Tooltip content={label}>{mark}</Tooltip>;
}

export function CatalogPluginMark({ plugin, large = false }: { plugin: SeedCatalogPlugin; large?: boolean }) {
  return <CatalogPluginIcon plugin={plugin} large={large} />;
}

export function PluginVersionTransition({
  currentVersion,
  targetVersion,
  large = false,
}: {
  currentVersion: string;
  targetVersion: string;
  large?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={cx(
        'shrink-0 font-medium tabular-nums text-warning',
        large ? 'text-[12px] leading-5' : 'text-[10px] leading-4',
      )}
      aria-label={t('plugins.versionUpdate', { current: currentVersion, target: targetVersion })}
    >
      {currentVersion} → {targetVersion}
    </span>
  );
}

export function PluginMark({ plugin, large = false }: { plugin: SeedInstalledPlugin; large?: boolean }) {
  return <InstalledPluginIcon plugin={plugin} large={large} />;
}

export function PluginCard({
  plugin,
  appName,
  onOpen,
}: {
  plugin: SeedInstalledPlugin;
  appName: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { locale } = useSeedI18n();
  const name = resolveSeedLocalizedText(plugin.name, locale);
  const incompatible = plugin.status === 'incompatible';
  return (
    <ResourceCard
      icon={<PluginMark plugin={plugin} />}
      title={
        <>
          <span className="truncate">{name}</span>
          {plugin.publisherType === 'official' && <OfficialMark appName={appName} />}
          {pluginMcpTools(plugin).length > 0 && <McpMark />}
          <PluginDevMark plugin={plugin} />
        </>
      }
      description={resolveSeedLocalizedText(plugin.description, locale)}
      trailing={
        incompatible ? (
          <ActionButton tone="muted" icon={<TriangleAlert size={13} />} disabled>
            {t('plugins.incompatible')}
          </ActionButton>
        ) : (
          <PluginActionButton action="details" onStart={onOpen} />
        )
      }
      onOpen={onOpen}
    />
  );
}

type CatalogPluginCardProps = {
  plugin: SeedCatalogPlugin;
  appName: string;
  installedPlugin?: SeedInstalledPlugin;
  installing: boolean;
  updatesBusy: boolean;
  installProgress?: PluginInstallProgress;
  onInstall: () => void;
  onCancelInstall: () => void;
  onOpen: () => void;
};

export function CatalogPluginCard({
  plugin,
  appName,
  installedPlugin,
  installing,
  updatesBusy,
  installProgress,
  onInstall,
  onCancelInstall,
  onOpen,
}: CatalogPluginCardProps) {
  const { t } = useTranslation();
  const { locale } = useSeedI18n();
  const current = Boolean(
    installedPlugin && compareSeedVersions(installedPlugin.version, plugin.latestVersion) >= 0,
  );
  const updating = Boolean(installedPlugin && !current);
  const installable = isCatalogPluginInstallable(plugin);
  const updateAvailable = updating && installable;
  return (
    <ResourceCard
      icon={installedPlugin ? <PluginMark plugin={installedPlugin} /> : <CatalogPluginMark plugin={plugin} />}
      title={
        <>
          <span className="truncate">{resolveSeedLocalizedText(plugin.name, locale)}</span>
          {plugin.publisherType === 'official' && <OfficialMark appName={appName} />}
          {installedPlugin && pluginMcpTools(installedPlugin).length > 0 && <McpMark />}
          {plugin.visibility === 'organization' && plugin.organization && (
            <span className="max-w-[112px] shrink-0 truncate rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-medium text-info">
              {t('plugins.organizationName', { name: plugin.organization.name })}
            </span>
          )}
          <PluginDevMark plugin={installedPlugin} />
        </>
      }
      description={resolveSeedLocalizedText(plugin.description, locale)}
      trailing={
        !installProgress && !installing && !current && !installable ? (
          <ActionButton tone="muted" icon={<TriangleAlert size={13} />} disabled>
            {t('plugins.incompatible')}
          </ActionButton>
        ) : (
          <PluginActionButton
            action={current ? 'details' : updateAvailable ? 'update' : 'install'}
            progress={installProgress}
            busy={installing}
            disabled={updatesBusy && !installProgress && !current}
            onStart={current ? onOpen : onInstall}
            onCancel={onCancelInstall}
          />
        )
      }
      onOpen={onOpen}
    />
  );
}
