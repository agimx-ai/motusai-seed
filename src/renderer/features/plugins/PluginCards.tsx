import { TriangleAlert } from 'lucide-react'
import type { PluginInstallProgress, SeedCatalogPlugin, SeedInstalledPlugin } from '../../../shared/contracts'
import { resolveSeedLocalizedText } from '../../../shared/plugin-manifest'
import { useTranslation } from 'react-i18next'
import { ActionButton } from '../../components/ActionButton'
import { CatalogPluginIcon, InstalledPluginIcon } from '../../components/PluginIcon'
import { ResourceCard } from '../../components/ResourceCard'
import { Tooltip } from '../../components/Tooltip'
import verifiedIconUrl from '../../assets/verified-light.svg'
import mcpIconUrl from '../../assets/mcp.svg'
import { cx } from '../../lib/display'
import { useSeedI18n } from '../../i18n'
import { isCatalogPluginInstallable } from './plugin-updates'
import { pluginMcpTools } from './mcp-tools'
import { PluginActionButton } from './PluginActionButton'

export function OfficialMark({ appName }: { appName: string }) {
  const { t } = useTranslation()
  return (
    <Tooltip content={t('common.officialVerified', { appName })}>
      <img className="h-4 w-4" src={verifiedIconUrl} alt="" aria-hidden="true" />
    </Tooltip>
  )
}

export function McpMark() {
  const { t } = useTranslation()
  return <Tooltip content={t('plugins.mcpToolsAvailable')}>
    <span className="grid h-4 w-4 shrink-0 place-items-center" role="img" aria-label={t('plugins.mcpToolsAvailable')}>
      <img className="h-3.5 w-3.5 dark:invert" src={mcpIconUrl} alt="" aria-hidden="true" />
    </span>
  </Tooltip>
}

export function CatalogPluginMark({ plugin, large = false }: { plugin: SeedCatalogPlugin; large?: boolean }) {
  return <CatalogPluginIcon plugin={plugin} large={large} />
}

export function PluginVersionTransition({ currentVersion, targetVersion, large = false }: {
  currentVersion: string
  targetVersion: string
  large?: boolean
}) {
  const { t } = useTranslation()
  return <span
    className={cx('shrink-0 font-medium tabular-nums text-warning', large ? 'text-[12px] leading-5' : 'text-[10px] leading-4')}
    aria-label={t('plugins.versionUpdate', { current: currentVersion, target: targetVersion })}
  >{currentVersion} → {targetVersion}</span>
}

export function PluginMark({ plugin, large = false }: { plugin: SeedInstalledPlugin; large?: boolean }) {
  return <InstalledPluginIcon plugin={plugin} large={large} />
}

export function PluginCard({ plugin, appName, onOpen }: { plugin: SeedInstalledPlugin; appName: string; onOpen: () => void }) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const name = resolveSeedLocalizedText(plugin.name, locale)
  const incompatible = plugin.status === 'incompatible'
  return <ResourceCard
    icon={<PluginMark plugin={plugin} />}
    title={<><span className="truncate">{name}</span>{plugin.publisherType === 'official' && <OfficialMark appName={appName} />}{pluginMcpTools(plugin).length > 0 && <McpMark />}</>}
    description={resolveSeedLocalizedText(plugin.description, locale)}
    trailing={incompatible
      ? <ActionButton tone="muted" icon={<TriangleAlert size={13} />} disabled>{t('plugins.incompatible')}</ActionButton>
      : <PluginActionButton action="details" onStart={onOpen} />}
    onOpen={onOpen}
  />
}

type CatalogPluginCardProps = {
  plugin: SeedCatalogPlugin
  appName: string
  installedPlugin?: SeedInstalledPlugin
  installing: boolean
  installProgress?: PluginInstallProgress
  onInstall: () => void
  onCancelInstall: () => void
  onOpen: () => void
}

export function CatalogPluginCard({ plugin, appName, installedPlugin, installing, installProgress, onInstall, onCancelInstall, onOpen }: CatalogPluginCardProps) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const current = installedPlugin?.version === plugin.latestVersion
  const incompatible = installedPlugin?.status === 'incompatible'
  const updating = Boolean(installedPlugin && !current)
  const installable = isCatalogPluginInstallable(plugin)
  const updateAvailable = updating && !incompatible && installable
  return <ResourceCard
    icon={installedPlugin ? <PluginMark plugin={installedPlugin} /> : <CatalogPluginMark plugin={plugin} />}
    title={<>
      <span className="truncate">{resolveSeedLocalizedText(plugin.name, locale)}</span>
      {plugin.publisherType === 'official' && <OfficialMark appName={appName} />}
      {installedPlugin && pluginMcpTools(installedPlugin).length > 0 && <McpMark />}
      {plugin.visibility === 'organization' && plugin.organization && <span className="max-w-[112px] shrink-0 truncate rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-medium text-info">
        {t('plugins.organizationName', { name: plugin.organization.name })}
      </span>}
    </>}
    description={resolveSeedLocalizedText(plugin.description, locale)}
    trailing={!installProgress && !installing && !current && (incompatible || !installable)
        ? <ActionButton tone="muted" icon={<TriangleAlert size={13} />} disabled>{t('plugins.incompatible')}</ActionButton>
        : <PluginActionButton
            action={current ? 'details' : updateAvailable ? 'update' : 'install'}
            progress={installProgress}
            busy={installing}
            onStart={current ? onOpen : onInstall}
            onCancel={onCancelInstall}
          />}
    onOpen={onOpen}
  />
}
