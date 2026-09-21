import { CloudUpload, MoreHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AuditCategory,
  AuditEntry,
  AuditRiskFilter,
  AuditStatusFilter,
  TerminalLogUploadProgress,
  TerminalLogUploadRange,
} from '../../shared/contracts'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { InfiniteScrollTrigger } from '../components/InfiniteScrollTrigger'
import { SegmentedControl, type SegmentedControlOption } from '../components/SegmentedControl'
import { SearchInput } from '../components/SearchInput'
import { SelectControl, type SelectControlOption } from '../components/SelectControl'
import { ActivityList } from '../features/activity/ActivityList'
import { filterActivityEntries } from '../features/activity/activity-model'
import { cx } from '../lib/display'

const pageSize = 50

function defaultUploadRange(): TerminalLogUploadRange {
  return { days: 1 }
}

function formatBytes(value: number) {
  if (value < 1_024) return `${value} B`
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`
  return `${(value / 1_048_576).toFixed(1)} MB`
}

export function ActivityActions({ uploading, uploadProgress, onClear, onUploadLogs, onCancelUploadLogs }: {
  uploading: boolean
  uploadProgress: TerminalLogUploadProgress | null
  onClear: () => void
  onUploadLogs: (range: TerminalLogUploadRange) => Promise<unknown>
  onCancelUploadLogs: () => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [confirmingUpload, setConfirmingUpload] = useState(false)
  const [uploadRange, setUploadRange] = useState(defaultUploadRange)
  const [cancellingUpload, setCancellingUpload] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const isWindows = window.motusWindow.platform === 'win32'
  const uploadRangeOptions: Array<SelectControlOption<'1' | '3' | '7'>> = ([1, 3, 7] as const).map((days) => ({ value: String(days) as '1' | '3' | '7', label: t('activity.uploadRangeDays', { count: days }) }))

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', close)
    }
  }, [open])

  return <>
    <div className="relative [-webkit-app-region:no-drag]" ref={containerRef}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('activity.moreActions')}
        className={cx('grid place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground [-webkit-app-region:no-drag]', open && 'bg-muted text-foreground', isWindows ? 'h-8 w-8' : 'h-9 w-9')}
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        <MoreHorizontal size={18} />
      </button>
      {open && <div className={cx('absolute top-[40px] z-10 w-max max-w-[calc(100vw-24px)] overflow-hidden rounded-[12px] border border-border bg-card p-1.5 shadow-[var(--overlay-shadow)]', isWindows ? 'left-0' : 'right-0')} id={menuId} role="menu">
        <button className="flex h-8 w-full items-center gap-2 whitespace-nowrap rounded-[8px] px-2 text-left text-[12px] text-foreground hover:bg-muted" onClick={() => { setOpen(false); setUploadRange(defaultUploadRange()); setConfirmingUpload(true) }} role="menuitem" type="button"><CloudUpload size={14} />{t('activity.uploadLogs')}</button>
        <button className="flex h-8 w-full items-center gap-2 whitespace-nowrap rounded-[8px] px-2 text-left text-[12px] text-danger hover:bg-danger-soft" onClick={() => { setOpen(false); setConfirmingClear(true) }} role="menuitem" type="button"><Trash2 size={14} />{t('activity.clear')}</button>
      </div>}
    </div>
    <ConfirmDialog
      busy={uploading}
      busyActionDisabled={cancellingUpload || uploadProgress?.phase === 'completing' || uploadProgress?.phase === 'completed'}
      busyActionLabel={uploadProgress?.phase === 'completing' || uploadProgress?.phase === 'completed' ? t('activity.completingUpload') : cancellingUpload ? t('activity.cancellingUpload') : t('activity.cancelUpload')}
      cancelLabel={t('common.cancel')}
      confirmLabel={t('activity.uploadLogs')}
      description={t('activity.uploadLogsDescription')}
      onCancel={() => setConfirmingUpload(false)}
      onBusyAction={() => {
        setCancellingUpload(true)
        void onCancelUploadLogs().then((cancelled) => { if (!cancelled) setCancellingUpload(false) })
      }}
      onConfirm={() => void onUploadLogs(uploadRange).finally(() => {
        setCancellingUpload(false)
        setConfirmingUpload(false)
      })}
      open={confirmingUpload}
      title={t('activity.uploadLogsTitle')}
    >
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{t('activity.uploadRange')}</span>
          <SelectControl className="[&>button]:h-8 [&>button]:!min-w-0" disabled={uploading} label={t('activity.uploadRange')} onValueChange={(days) => setUploadRange({ days: Number(days) as 1 | 3 | 7 })} options={uploadRangeOptions} value={String(uploadRange.days) as '1' | '3' | '7'} />
        </div>
        {uploading && <div aria-live="polite" className="grid gap-1.5">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>{t(`activity.uploadPhase.${uploadProgress?.phase || 'preparing'}`)}{uploadProgress?.total ? ` · ${formatBytes(uploadProgress.transferred)} / ${formatBytes(uploadProgress.total)}` : ''}</span>
            <span className="tabular-nums text-foreground">{uploadProgress?.percent ?? 0}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border/70">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${uploadProgress?.percent ?? 0}%` }} />
          </div>
        </div>}
      </div>
    </ConfirmDialog>
    <ConfirmDialog
      cancelLabel={t('common.cancel')}
      confirmLabel={t('activity.clear')}
      description={t('activity.clearConfirm')}
      onCancel={() => setConfirmingClear(false)}
      onConfirm={() => {
        onClear()
        setConfirmingClear(false)
      }}
      open={confirmingClear}
      title={t('activity.clear')}
      tone="danger"
    />
  </>
}

export function ActivityPage({ entries, appName }: { entries: AuditEntry[]; appName: string }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<AuditStatusFilter>('all')
  const [category, setCategory] = useState<AuditCategory>('all')
  const [risk, setRisk] = useState<AuditRiskFilter>('all')
  const [results, setResults] = useState(entries.slice(0, pageSize))
  const [total, setTotal] = useState(entries.length)
  const [nextCursor, setNextCursor] = useState<string>()
  const [loadingMore, setLoadingMore] = useState(false)
  const requestVersion = useRef(0)
  const statusOptions: Array<SegmentedControlOption<AuditStatusFilter>> = (['all', 'attention'] as const)
    .map((value) => ({ value, label: t(`activity.filter.${value}`) }))
  const categoryOptions: Array<SelectControlOption<AuditCategory>> = (['all', 'capabilities', 'permissions', 'plugins', 'system'] as const)
    .map((value) => ({ value, label: t(`activity.category.${value}`) }))
  const riskOptions: Array<SelectControlOption<AuditRiskFilter>> = (['all', 'read', 'write', 'control'] as const)
    .map((value) => ({ value, label: t(`activity.riskFilter.${value}`) }))
  const hasActiveFilters = Boolean(query.trim()) || status !== 'all' || category !== 'all' || risk !== 'all'
  const showFilters = entries.length > 0 || total > 0 || hasActiveFilters

  useEffect(() => {
    const version = ++requestVersion.current
    const timer = window.setTimeout(() => {
      const bridge = window.motusSeed
      if (!bridge) {
        const filtered = filterActivityEntries(entries, { category, status, risk, query })
        setResults(filtered.slice(0, pageSize))
        setTotal(filtered.length)
        setNextCursor(undefined)
        return
      }
      void bridge.queryAudit({ category, status, risk, query, limit: pageSize }).then((page) => {
        if (version !== requestVersion.current) return
        setResults(page.items)
        setTotal(page.total)
        setNextCursor(page.nextCursor)
      })
    }, query.trim() ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [category, entries, query, risk, status])

  const loadMore = async () => {
    if (!nextCursor || !window.motusSeed || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await window.motusSeed.queryAudit({ category, status, risk, query, cursor: nextCursor, limit: pageSize })
      setResults((current) => [...current, ...page.items])
      setTotal(page.total)
      setNextCursor(page.nextCursor)
    } finally {
      setLoadingMore(false)
    }
  }

  return <section className="mx-auto flex h-full w-full max-w-[840px] flex-col pt-4 animate-[rise_.25s_ease_both]">
    {showFilters && <>
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <SearchInput
          className="min-w-[220px] flex-1"
          clearLabel={t('common.clearSearch')}
          label={t('activity.search')}
          onValueChange={setQuery}
          placeholder={t('activity.searchPlaceholder')}
          value={query}
        />
        <SegmentedControl
          className="h-[34px] [&>button]:h-7"
          label={t('activity.status.label')}
          onValueChange={setStatus}
          options={statusOptions}
          value={status}
        />
        <SelectControl
          className="[&>button]:h-[34px]"
          label={t('activity.category.label')}
          onValueChange={setCategory}
          options={categoryOptions}
          value={category}
        />
        <SelectControl
          className="[&>button]:h-[34px]"
          label={t('activity.riskFilter.label')}
          onValueChange={setRisk}
          options={riskOptions}
          value={risk}
        />
      </div>
    </>}

    {!entries.length && total === 0 && !hasActiveFilters ? <div className="grid min-h-[240px] flex-1 place-items-center px-6 py-10 text-center">
      <div className="max-w-[420px]">
        <strong className="block text-[14px] font-medium text-foreground">{t('activity.empty')}</strong>
        <p className="mb-0 mt-1.5 text-[12px] leading-5 text-muted-foreground">{t('activity.emptyDescription', { appName })}</p>
      </div>
    </div> : !results.length ? <div className="grid min-h-[220px] flex-1 place-items-center px-6 py-10 text-center">
      <div>
        <strong className="block text-[14px] font-medium text-foreground">{t('activity.noResults')}</strong>
        <button
          className="mt-2 text-[12px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
          onClick={() => {
            setQuery('')
            setStatus('all')
            setCategory('all')
            setRisk('all')
          }}
          type="button"
        >
          {t('activity.resetFilters')}
        </button>
      </div>
    </div> : <>
      <ActivityList entries={results} />
      <InfiniteScrollTrigger
        hasMore={Boolean(nextCursor)}
        label={t('common.loadingMore')}
        loading={loadingMore}
        onLoadMore={() => void loadMore()}
      />
    </>}
  </section>
}
