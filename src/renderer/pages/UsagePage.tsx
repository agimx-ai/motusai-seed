import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SeedInstalledPlugin, TerminalUserProfile, UsageDay, UsageSummary } from '../../shared/contracts'
import { UserAvatar } from '../components/UserAvatar'
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

export function UsagePage({ plugins, user }: { plugins: SeedInstalledPlugin[]; user: TerminalUserProfile }) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const [summary, setSummary] = useState<UsageSummary>()
  const [error, setError] = useState(false)
  const usageRequest = useRef(0)

  useEffect(() => {
    void window.motusSeed.readProfile().catch(() => undefined)
  }, [user.id])

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

  const usage = useMemo(() => {
    if (!summary) return undefined
    const storedDays = new Map(summary.days.map((day) => [day.date, day]))
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const start = new Date(today.getFullYear(), 0, 1)
    const end = new Date(today.getFullYear(), 11, 31)
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
  const fullDate = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' })
  const monthNames = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(2024, month, 1)))

  const contributions = useMemo<ActivityContribution[]>(() => {
    if (!usage) return []
    const leadingDays = usage.start.getDay()
    const empty = Array.from({ length: leadingDays }, (_, index) => {
      const day = new Date(usage.start)
      day.setDate(day.getDate() - leadingDays + index)
      return { date: localDateKey(day), count: 0, level: 0 as const }
    })
    return [...empty, ...usage.days.map((day) => ({
      date: day.date,
      count: day.creditsCharged,
      level: usageLevel(day.creditsCharged, usage.peakCredits) as 0 | 1 | 2 | 3 | 4,
    }))]
  }, [usage])

  return <section className="mx-auto w-full max-w-[920px] pt-7 animate-[rise_.25s_ease_both]">
    <div className="mb-9 flex flex-col items-center text-center">
      <UserAvatar className="grid size-20 place-items-center overflow-hidden rounded-full bg-muted text-[25px] text-foreground" imageUrl={user.avatarDataUrl} name={user.displayName} />
      <div className="mt-3 text-[22px] font-medium tracking-[-.02em]">{user.displayName}</div>
      {user.username && <div className="mt-1 text-[13px] text-muted-foreground">@{user.username}</div>}
    </div>
    {error ? <div className="rounded-[14px] border border-border bg-card px-5 py-8 text-center text-[13px] text-muted-foreground">{t('usage.loadFailed')}</div>
      : usage ? <>
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
              <span className="text-[11px] text-muted-foreground">{fullDate.formatRange(usage.start, usage.end)}</span>
            </div>
            <RareUiActivityGrid
              accent="var(--seed-accent)"
              cellSize={11}
              contributions={contributions}
              describeDay={(day) => t('usage.dayDescription', { date: fullDate.format(new Date(`${day.date}T00:00:00`)), count: day.count })}
              label={t('usage.activityChart')}
              monthNames={monthNames}
              months={12}
              rangeEnd={localDateKey(usage.end)}
              rangeStart={localDateKey(usage.start)}
            />
          </section>

          <section className="mt-10">
            <h2 className="m-0 text-[16px] font-medium">{t('usage.frequentPlugins')}</h2>
            {usage.plugins.length ? <div className="mt-3 grid grid-cols-2 gap-x-10 gap-y-1">
              {usage.plugins.map((item) => {
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
        </> : null}
  </section>
}
