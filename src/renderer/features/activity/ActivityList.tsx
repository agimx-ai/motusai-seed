import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuditEntry } from '../../../shared/contracts'
import { Tooltip } from '../../components/Tooltip'
import { useSeedI18n } from '../../i18n'
import { cx } from '../../lib/display'
import { activityCategory, activityHierarchy, activityRisk, groupActivityEntriesByDay, pluginActivityPresentation, visibleActivityChildren } from './activity-model'

const outcomeAppearance: Record<AuditEntry['outcome'], string> = {
  allowed: 'text-accent-strong before:bg-accent-strong',
  denied: 'text-danger before:bg-danger',
  failed: 'text-danger before:bg-danger',
  running: 'text-control before:bg-control',
  interrupted: 'text-warning before:bg-warning',
}

function dayLabel(timestamp: string, locale: string, todayLabel: string, yesterdayLabel: string) {
  const date = new Date(timestamp)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const difference = Math.round((startOfToday - startOfDate) / 86_400_000)
  if (difference === 0) return todayLabel
  if (difference === 1) return yesterdayLabel
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' }).format(date)
}

function localizedDetail(entry: AuditEntry, locale: string, key: 'plugin_name' | 'caller_name' | 'method_description') {
  const language = locale.toLowerCase().startsWith('en') ? 'en_us' : 'zh_hans'
  return entry.diagnosticDetails?.[`${key}_${language}`]
}

function pluginName(entry: AuditEntry, locale: string) {
  const metadataName = locale.toLowerCase().startsWith('en')
    ? entry.metadata?.plugin_name_en_us
    : entry.metadata?.plugin_name_zh_hans
  return String(localizedDetail(entry, locale, 'plugin_name') || metadataName || entry.pluginId || '')
}

function operationParts(operation: string) {
  const separator = operation.lastIndexOf('.')
  if (separator <= 0 || separator === operation.length - 1) return [operation]
  return [operation.slice(0, separator), operation.slice(separator + 1)]
}

function DetailField({ label, value, code = false }: { label: string; value?: string; code?: boolean }) {
  if (!value) return null
  return <div className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] gap-3 py-1 text-[11px] leading-5">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className={cx('m-0 min-w-0 break-words text-foreground', code && 'font-mono text-[10px]')}>{value}</dd>
  </div>
}

function AnimatedDisclosure({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(expanded)
  const [visible, setVisible] = useState(expanded)

  useEffect(() => {
    if (expanded) {
      setMounted(true)
      let revealFrame = 0
      const mountFrame = requestAnimationFrame(() => {
        revealFrame = requestAnimationFrame(() => setVisible(true))
      })
      return () => {
        cancelAnimationFrame(mountFrame)
        cancelAnimationFrame(revealFrame)
      }
    }

    setVisible(false)
    const timeout = window.setTimeout(() => setMounted(false), 200)
    return () => window.clearTimeout(timeout)
  }, [expanded])

  if (!mounted) return null
  return <div
    aria-hidden={!visible}
    className={cx(
      'grid transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none',
      visible ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0',
    )}
    inert={!visible ? true : undefined}
    onTransitionEnd={(event) => {
      if (event.currentTarget === event.target && !expanded) setMounted(false)
    }}
  >
    <div className="min-h-0 overflow-hidden">{children}</div>
  </div>
}

function FlatLabel({ entry, locale, fallback }: { entry: AuditEntry; locale: string; fallback: ReactNode }) {
  if (entry.recordKind === 'span') {
    const name = pluginName(entry, locale)
    const parts = operationParts(entry.operation)
    return <>
      {name && <span className="font-medium text-foreground transition-colors group-hover/activity:text-accent-strong">「{name}」</span>}
      {parts.map((part, index) => <span className="contents" key={`${part}-${index}`}>
        {(name || index > 0) && <span aria-hidden="true" className="mx-1.5 text-muted-foreground/60">·</span>}
        <span className={cx('transition-colors group-hover/activity:text-accent-strong', index === parts.length - 1 ? 'text-foreground' : 'text-muted-foreground')}>{part}</span>
      </span>)}
    </>
  }

  const name = pluginName(entry, locale)
  if (name && entry.operation === 'plugin.install') return <><span className="font-medium text-foreground transition-colors group-hover/activity:text-accent-strong">「{name}」</span><span aria-hidden="true" className="mx-1.5 text-muted-foreground/60">·</span>{locale.toLowerCase().startsWith('en') ? 'Install' : '安装'}</>
  if (name && entry.operation === 'plugin.uninstall') return <><span className="font-medium text-foreground transition-colors group-hover/activity:text-accent-strong">「{name}」</span><span aria-hidden="true" className="mx-1.5 text-muted-foreground/60">·</span>{locale.toLowerCase().startsWith('en') ? 'Uninstall' : '卸载'}</>
  return <>{fallback}</>
}

function ActivityRow({ entry, children, hasChildren, expanded, depth, onToggle }: {
  entry: AuditEntry
  children?: ReactNode
  hasChildren: boolean
  expanded: boolean
  depth: number
  onToggle(): void
}) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const exactTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(entry.timestamp))
  const shortTime = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(entry.timestamp))
  const outcomeLabel = t(`activity.outcome.${entry.outcome}`)
  const presentation = pluginActivityPresentation(entry, locale)
  const fallback = presentation ? t(presentation.key, presentation.values) : entry.summary
  const categoryLabel = t(`activity.category.${activityCategory(entry)}`)
  const riskLabel = t(`activity.risk.${activityRisk(entry)}`)
  const sourceLabel = t(`activity.source.${entry.source}`)
  const metadataValue = (key: keyof NonNullable<AuditEntry['metadata']>) => {
    const value = entry.metadata?.[key]
    return value === undefined ? undefined : String(value)
  }

  return <>
    <div className="group/activity grid grid-cols-[28px_minmax(0,1fr)] items-center rounded-[9px]">
      <button
        aria-label={locale.toLowerCase().startsWith('en')
          ? expanded ? 'Collapse activity' : 'Expand activity'
          : expanded ? '收起活动' : '展开活动'}
        className="grid h-11 w-7 place-items-center rounded-md text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-focus-ring)]"
        onClick={onToggle}
        type="button"
      >
        <ChevronRight aria-hidden="true" className={cx('transition-transform duration-150 ease-out motion-reduce:transition-none', expanded && 'rotate-90')} size={13} />
      </button>
      <button
        aria-expanded={expanded}
        className="grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-[9px] pr-2 text-left text-foreground outline-none transition-colors hover:text-accent-strong focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]"
        onClick={onToggle}
        type="button"
      >
        <span className="min-w-0 truncate text-[13px] leading-5">
          <span className="min-w-0 truncate"><FlatLabel entry={entry} locale={locale} fallback={fallback} /></span>
        </span>
        <span className="flex shrink-0 items-center">
          <span className={cx(
            'relative min-w-[52px] shrink-0 pl-3 text-left text-[11px] font-medium before:absolute before:left-0 before:top-1/2 before:h-1.5 before:w-1.5 before:-translate-y-1/2 before:rounded-full',
            outcomeAppearance[entry.outcome],
          )}>{outcomeLabel}</span>
          <span className="w-[44px] shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-muted-foreground">
            {depth === 0 && <Tooltip content={exactTime}><time dateTime={entry.timestamp}>{shortTime}</time></Tooltip>}
          </span>
        </span>
      </button>
    </div>
    <AnimatedDisclosure expanded={expanded}>
      <div className="relative">
        {hasChildren && <span aria-hidden="true" className="absolute bottom-0 left-5 top-0 border-l border-foreground/20" />}
        <div className="ml-7 px-5 pb-4 pt-2">
          <dl className="m-0 grid grid-cols-2 gap-x-12 gap-y-0.5">
            <DetailField label={t('activity.detail.time')} value={exactTime} />
            <DetailField label={t('activity.detail.result')} value={outcomeLabel} />
            <DetailField label={t('activity.detail.source')} value={sourceLabel} />
            <DetailField code label={t('activity.detail.operation')} value={entry.operation} />
            <DetailField label={t('activity.detail.category')} value={categoryLabel} />
            <DetailField label={t('activity.detail.risk')} value={riskLabel} />
            <DetailField code label={t('activity.detail.path')} value={entry.relativePath} />
            <DetailField code label={t('activity.detail.errorCode')} value={entry.errorCode} />
            <DetailField label={t('activity.detail.client')} value={metadataValue('client_name')} />
            <DetailField code label={t('activity.detail.pluginVersion')} value={entry.pluginVersion || metadataValue('plugin_version')} />
            <DetailField code label={t('activity.detail.capabilityMethod')} value={metadataValue('capability_method')} />
            <DetailField label={t('activity.detail.thinkingLevel')} value={metadataValue('thinking_level')} />
            <DetailField code label={t('activity.detail.component')} value={entry.component} />
            <DetailField code label={t('activity.detail.errorName')} value={entry.errorName} />
            <DetailField label={t('activity.detail.errorMessage')} value={entry.errorMessage} />
            <DetailField label={t('activity.detail.inputLength')} value={metadataValue('input_length')} />
            <DetailField label={t('activity.detail.outputLength')} value={metadataValue('output_length')} />
            <DetailField label={t('activity.detail.attachments')} value={metadataValue('attachment_count')} />
          </dl>
          {entry.errorStack && <pre className="m-0 mt-2 max-h-64 overflow-auto border-t border-border/60 pt-2 whitespace-pre-wrap break-all font-mono text-[10px] leading-5 text-muted-foreground">{entry.errorStack}</pre>}
        </div>
      </div>
      {children}
    </AnimatedDisclosure>
  </>
}

function ActivityNode({ entry, childrenByParent, depth = 0, isLast = false }: {
  entry: AuditEntry
  childrenByParent: Map<string, AuditEntry[]>
  depth?: number
  isLast?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const children = entry.spanId ? visibleActivityChildren(entry.spanId, childrenByParent) : []
  return <div className={cx(
    'relative',
    depth === 0 && 'rounded-[12px] border border-border bg-muted/45 px-2 py-1',
    depth > 0 && 'ml-5 pl-5',
  )}>
    {depth > 0 && <span aria-hidden="true" className={cx(
      'absolute left-0 top-0 border-l border-foreground/20',
      isLast ? 'h-[22px]' : 'bottom-0',
    )} />}
    {depth > 0 && <span aria-hidden="true" className="absolute left-0 top-[22px] w-4 border-t border-foreground/20" />}
    <ActivityRow depth={depth} entry={entry} expanded={expanded} hasChildren={children.length > 0}
      onToggle={() => setExpanded((value) => !value)}>
      {children.map((child, index) => <ActivityNode depth={depth + 1} isLast={index === children.length - 1}
        key={child.id} entry={child} childrenByParent={childrenByParent} />)}
    </ActivityRow>
  </div>
}

export function ActivityList({ entries }: { entries: AuditEntry[] }) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const { roots, childrenByParent } = useMemo(() => activityHierarchy(entries), [entries])
  const groups = groupActivityEntriesByDay(roots)

  return <div className="pb-4">
    {groups.map((group) => <section key={group.key}>
      <div className="sticky top-0 z-[2] -mx-2 flex items-baseline gap-2 border-b border-border/60 bg-background px-2 py-3">
        <h3 className="m-0 text-[12px] font-medium text-foreground">{dayLabel(group.entries[0].timestamp, locale, t('activity.today'), t('activity.yesterday'))}</h3>
        <span className="text-[10px] tabular-nums text-muted-foreground">{group.entries.length}</span>
      </div>
      <div className="space-y-2 py-2">{group.entries.map((entry) => <ActivityNode entry={entry} childrenByParent={childrenByParent}
        key={entry.id} />)}</div>
    </section>)}
  </div>
}
