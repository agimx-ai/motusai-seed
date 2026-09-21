import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PersonalCreditGrant, SeedInstalledPlugin, UsageDay, UsageSummary } from '../../shared/contracts'
import { PluginIcon } from '../components/PluginIcon'
import { RareUiActivityGrid, type ActivityContribution } from '../components/RareUiActivityGrid'
import { useSeedI18n } from '../i18n'
import { cx } from '../lib/display'

function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function streaks(days: UsageDay[]) {
  let longest = 0
  let running = 0
  for (const day of days) {
    running = day.paidCallCount > 0 ? running + 1 : 0
    longest = Math.max(longest, running)
  }
  let index = days.length - 1
  if (index >= 0 && days[index]?.paidCallCount === 0) index -= 1
  let current = 0
  while (index >= 0 && days[index]?.paidCallCount && days[index]!.paidCallCount > 0) {
    current += 1
    index -= 1
  }
  return { current, longest }
}

function usageLevel(value: number, maximum: number) {
  if (!value || !maximum) return 0
  return Math.min(4, Math.max(1, Math.ceil(value / maximum * 4)))
}

export function UsagePage({ plugins }: { plugins: SeedInstalledPlugin[] }) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const [summary, setSummary] = useState<UsageSummary>()
  const [error, setError] = useState(false)
  const [grants, setGrants] = useState<PersonalCreditGrant[]>([])
  const [grantCursor, setGrantCursor] = useState<string>()
  const [grantLoading, setGrantLoading] = useState(true)
  const [grantError, setGrantError] = useState(false)
  const usageRequest = useRef(0)
  const grantRequest = useRef(0)

  const loadUsage = useCallback(async () => {
    const request = ++usageRequest.current
    setError(false)
    try {
      const result = await window.motusSeed.queryUsage()
      if (request === usageRequest.current) setSummary(result)
    } catch {
      if (request === usageRequest.current) setError(true)
    }
  }, [])

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void loadUsage() }
    void loadUsage()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      usageRequest.current += 1
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [loadUsage])

  const loadGrants = useCallback(async (cursor?: string) => {
    const request = ++grantRequest.current
    setGrantLoading(true)
    setGrantError(false)
    try {
      const page = await window.motusSeed.personalCreditGrants(cursor)
      if (request !== grantRequest.current) return
      setGrants((current) => cursor ? [...current, ...page.items] : page.items)
      setGrantCursor(page.nextCursor)
    } catch {
      if (request === grantRequest.current) setGrantError(true)
    } finally {
      if (request === grantRequest.current) setGrantLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadGrants()
    return () => { grantRequest.current += 1 }
  }, [loadGrants])

  const usage = useMemo(() => {
    if (!summary) return undefined
    const storedDays = new Map(summary.days.map((day) => [day.date, day]))
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const start = new Date(today.getFullYear(), today.getMonth() - 11, 1)
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    const days: UsageDay[] = []
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      days.push(storedDays.get(localDateKey(cursor)) || {
        date: localDateKey(cursor), creditsCharged: 0, paidCallCount: 0,
      })
    }
    const elapsedDays = days.filter((day) => day.date <= localDateKey(today))
    const totalCredits = elapsedDays.reduce((total, day) => total + day.creditsCharged, 0)
    const paidCallCount = elapsedDays.reduce((total, day) => total + day.paidCallCount, 0)
    const peakCredits = Math.max(0, ...elapsedDays.map((day) => day.creditsCharged))
    return { days, plugins: summary.plugins, totalCredits, paidCallCount, peakCredits, ...streaks(elapsedDays), start, end }
  }, [summary])

  const number = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
  const date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
  const fullDate = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' })
  const grantDate = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
  const creditNumber = new Intl.NumberFormat(locale)
  const monthNames = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(2024, month, 1)))

  const contributions = useMemo<ActivityContribution[]>(() => {
    if (!usage) return []
    const leadingDays = usage.start.getDay()
    const empty = Array.from({ length: leadingDays }, (_, index) => {
      const day = new Date(usage.start)
      day.setDate(day.getDate() - leadingDays + index)
      return { date: localDateKey(day), count: 0, level: 0 as const }
    })
    const trailingDays = 6 - usage.end.getDay()
    const trailing = Array.from({ length: trailingDays }, (_, index) => {
      const day = new Date(usage.end)
      day.setDate(day.getDate() + index + 1)
      return { date: localDateKey(day), count: 0, level: 0 as const }
    })
    return [...empty, ...usage.days.map((day) => ({
      date: day.date,
      count: day.creditsCharged,
      level: usageLevel(day.creditsCharged, usage.peakCredits) as 0 | 1 | 2 | 3 | 4,
    })), ...trailing]
  }, [usage])

  return <section className="mx-auto w-full max-w-[920px] animate-[rise_.25s_ease_both]">
    <div className="mb-8">
      <h1 className="m-0 text-[24px] font-medium tracking-[-.02em]">{t('usage.title')}</h1>
      <p className="mb-0 mt-1 text-[12px] text-muted-foreground">{t('usage.description')}</p>
    </div>

    {error ? <div className="rounded-[14px] border border-border bg-card px-5 py-8 text-center text-[13px] text-muted-foreground">{t('usage.loadFailed')}</div>
      : !usage ? <div className="h-[280px] animate-pulse rounded-[14px] bg-muted/60" />
        : <>
          <div className="grid grid-cols-5 rounded-[14px] border border-border bg-card px-3 py-5">
            {[
              [number.format(usage.totalCredits), t('usage.totalCredits')],
              [number.format(usage.peakCredits), t('usage.peakCredits')],
              [number.format(usage.paidCallCount), t('usage.paidCalls')],
              [t('usage.dayCount', { count: usage.current }), t('usage.currentStreak')],
              [t('usage.dayCount', { count: usage.longest }), t('usage.longestStreak')],
            ].map(([value, label], index) => <div className={cx('min-w-0 px-3 text-center', index > 0 && 'border-l border-border')} key={label}>
              <div className="truncate text-[16px] font-medium tabular-nums text-foreground">{value}</div>
              <div className="mt-1 truncate text-[11px] text-muted-foreground">{label}</div>
            </div>)}
          </div>

          <section className="mt-10">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h2 className="m-0 text-[16px] font-medium">{t('usage.activity')}</h2>
                <p className="mb-0 mt-1 text-[11px] text-muted-foreground">{t('usage.creditBreakdown', {
                  credits: number.format(usage.totalCredits), count: number.format(usage.paidCallCount),
                })}</p>
              </div>
              <span className="text-[11px] text-muted-foreground">{date.format(usage.start)} – {date.format(usage.end)}</span>
            </div>
            <RareUiActivityGrid
              accent="var(--seed-accent)"
              cellSize={11}
              contributions={contributions}
              describeDay={(day) => t('usage.dayDescription', { date: fullDate.format(new Date(`${day.date}T00:00:00`)), count: day.count })}
              label={t('usage.activityChart')}
              monthNames={monthNames}
              months={12}
            />
          </section>

          <section className="mt-10">
            <h2 className="m-0 text-[16px] font-medium">{t('usage.frequentPlugins')}</h2>
            {usage.plugins.length ? <div className="mt-3 grid grid-cols-2 gap-x-10 gap-y-1">
              {usage.plugins.slice(0, 5).map((item) => {
                const installed = plugins.find((plugin) => plugin.id === item.pluginId)
                const name = installed
                  ? (locale.toLowerCase().startsWith('en') ? installed.name.en_US : installed.name.zh_Hans)
                  : (locale.toLowerCase().startsWith('en') ? item.nameEnUs : item.nameZhHans) || item.nameZhHans || item.nameEnUs || item.pluginId
                return <div className="flex min-h-11 items-center gap-3" key={item.pluginId}>
                  <PluginIcon iconUrl={installed?.iconDataUrl} iconDarkUrl={installed?.iconDarkDataUrl} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{name}</span>
                  <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{t('usage.pluginStats', {
                    count: number.format(item.callCount), credits: number.format(item.creditsCharged),
                  })}</span>
                </div>
              })}
            </div> : <p className="mb-0 mt-3 text-[12px] text-muted-foreground">{t('usage.noPluginUsage')}</p>}
          </section>
        </>}

    <section className="mt-10">
      <h2 className="m-0 text-[16px] font-medium">{t('usage.grantRecords')}</h2>
      {grantLoading && grants.length === 0
        ? <div aria-label={t('usage.loadingGrantRecords')} className="mt-3 overflow-hidden rounded-[14px] border border-border bg-card" role="status">
          {[0, 1, 2].map((item) => <div className="flex h-[58px] animate-pulse items-center justify-between border-b border-border px-4 last:border-b-0" key={item}>
            <div className="h-3 w-36 rounded-full bg-muted" />
            <div className="space-y-2">
              <div className="ml-auto h-3 w-16 rounded-full bg-muted" />
              <div className="ml-auto h-2.5 w-28 rounded-full bg-muted" />
            </div>
          </div>)}
        </div>
        : grantError && grants.length === 0
          ? <div className="mt-3 flex min-h-11 items-center gap-3">
            <span className="text-[12px] text-muted-foreground">{t('usage.grantRecordsUnavailable')}</span>
            <button className="shrink-0 text-[12px] text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" onClick={() => void loadGrants()} type="button">
              {t('usage.retryGrantRecords')}
            </button>
          </div>
          : grants.length === 0
            ? <p className="mb-0 mt-3 text-[12px] text-muted-foreground">{t('usage.noGrantRecords')}</p>
            : <div className="mt-3 overflow-hidden rounded-[14px] border border-border bg-card">
              {grants.map((grant) => <div className="flex min-h-[58px] items-center justify-between gap-6 border-b border-border px-4 py-3 last:border-b-0" key={grant.id}>
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{grant.reason}</span>
                <div className="shrink-0 text-right">
                  <div className="text-[13px] font-medium tabular-nums text-foreground">{t('usage.grantAmount', { count: creditNumber.format(grant.amount) })}</div>
                  <time className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground" dateTime={grant.createdAt}>{grantDate.format(new Date(grant.createdAt))}</time>
                </div>
              </div>)}
            </div>}
      {grantError && grants.length > 0 ? <div className="mt-3 flex items-center gap-3 text-[12px] text-muted-foreground">
        <span>{t('usage.grantRecordsUnavailable')}</span>
        <button className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" onClick={() => void loadGrants(grantCursor)} type="button">{t('usage.retryGrantRecords')}</button>
      </div> : null}
      {grantCursor && !grantError ? <button className="mt-3 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-60" disabled={grantLoading} onClick={() => void loadGrants(grantCursor)} type="button">
        {t('usage.loadMoreGrantRecords')}
      </button> : null}
    </section>
  </section>
}
