import { Check, TriangleAlert } from 'lucide-react'
import type { SeedCatalogPlugin, SeedInstalledPlugin } from '../../../shared/contracts'
import { resolveSeedLocalizedText } from '../../../shared/plugin-manifest'
import { useTranslation } from 'react-i18next'
import { ActionButton } from '../../components/ActionButton'
import { CatalogPluginIcon, InstalledPluginIcon } from '../../components/PluginIcon'
import { ResourceCard } from '../../components/ResourceCard'
import { Tooltip } from '../../components/Tooltip'
import verifiedIconUrl from '../../assets/verified-light.svg'
import { cx } from '../../lib/display'
import { useSeedI18n } from '../../i18n'
import { isCatalogPluginInstallable } from './plugin-updates'

export function OfficialMark({ appName }: { appName: string }) {
  const { t } = useTranslation()
  return (
    <Tooltip content={t('common.officialVerified', { appName })}>
      <img className="h-4 w-4" src={verifiedIconUrl} alt="" aria-hidden="true" />
    </Tooltip>
  )
}

function InstalledMark() {
  const { t } = useTranslation()
  return <Tooltip content={t('common.installed')}>
    <span className="grid h-[30px] min-w-[48px] shrink-0 place-items-center text-muted-foreground" role="status" aria-label={t('common.installed')}>
      <Check size={17} strokeWidth={1.8} />
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
    title={<><span className="truncate">{name}</span>{plugin.publisherType === 'official' && <OfficialMark appName={appName} />}</>}
    description={resolveSeedLocalizedText(plugin.description, locale)}
    trailing={incompatible
      ? <ActionButton tone="muted" icon={<TriangleAlert size={13} />} disabled>{t('plugins.incompatible')}</ActionButton>
      : <InstalledMark />}
    onOpen={onOpen}
  />
}

type CatalogPluginCardProps = {
  plugin: SeedCatalogPlugin
  appName: string
  installedPlugin?: SeedInstalledPlugin
  installing: boolean
  updateHighlightRevision: number
  onInstall: () => void
  onOpen: () => void
}

export function CatalogPluginCard({ plugin, appName, installedPlugin, installing, updateHighlightRevision, onInstall, onOpen }: CatalogPluginCardProps) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const current = installedPlugin?.version === plugin.latestVersion
  const incompatible = installedPlugin?.status === 'incompatible'
  const updating = Boolean(installedPlugin && !current)
  const installable = isCatalogPluginInstallable(plugin)
  const updateAvailable = updating && !incompatible && installable
  const actionLabel = installing
    ? (updating ? t('plugins.updating') : t('plugins.installing'))
    : incompatible
      ? t('plugins.incompatible')
      : current
        ? t('common.installed')
        : !installable
          ? t('plugins.incompatible')
          : updating
            ? t('plugins.update')
            : t('plugins.install')

  return <ResourceCard
    icon={installedPlugin ? <PluginMark plugin={installedPlugin} /> : <CatalogPluginMark plugin={plugin} />}
    title={<>
      <span className="truncate">{resolveSeedLocalizedText(plugin.name, locale)}</span>
      {plugin.publisherType === 'official' && <OfficialMark appName={appName} />}
      {plugin.visibility === 'organization' && plugin.organization && <span className="max-w-[112px] shrink-0 truncate rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-medium text-info">
        {t('plugins.organizationExclusive', { name: plugin.organization.name })}
      </span>}
    </>}
    description={resolveSeedLocalizedText(plugin.description, locale)}
    trailing={current
      ? <InstalledMark />
      : <div className="relative overflow-visible">
        {updateAvailable && updateHighlightRevision > 0 && <span className="seed-update-burst motion-reduce:hidden" key={updateHighlightRevision} aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
        </span>}
        <ActionButton
          key={updateHighlightRevision}
          className={cx(
            'relative z-20',
            updateAvailable && updateHighlightRevision > 0 && 'animate-[seedUpdateButtonPulse_900ms_ease-out_both] motion-reduce:animate-none',
          )}
          tone={updateAvailable ? 'info' : 'neutral'}
          icon={incompatible ? <TriangleAlert size={13} /> : undefined}
          busy={installing}
          disabled={incompatible || !installable}
          aria-label={actionLabel}
          onClick={(event) => { event.stopPropagation(); onInstall() }}
        >
          {actionLabel}
        </ActionButton>
      </div>}
    onOpen={onOpen}
  />
}
