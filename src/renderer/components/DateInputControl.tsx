import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ActionButton } from './ActionButton'
import { IconButton } from './IconButton'

type DateInputControlProps = {
  value: string
  label: string
  locale: string
  placeholder: string
  previousMonthLabel: string
  nextMonthLabel: string
  todayLabel: string
  clearLabel: string
  onChange(value: string): void
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null
}

function localToday() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function monthOf(date: Date) {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() }
}

export function calendarMonthDays(year: number, month: number) {
  const offset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month, index - offset + 1))
    return { value: date.toISOString().slice(0, 10), day: date.getUTCDate(), inMonth: date.getUTCMonth() === month }
  })
}

export function DateInputControl({ value, label, locale, placeholder, previousMonthLabel, nextMonthLabel, todayLabel, clearLabel, onChange }: DateInputControlProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => monthOf(parseDate(value) || parseDate(localToday())!))
  const [focusedDate, setFocusedDate] = useState(value || localToday())
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number }>()
  const calendarLocale = locale.startsWith('zh') ? 'zh-CN' : 'en-US'
  const today = localToday()
  const days = calendarMonthDays(month.year, month.month)
  const monthLabel = new Intl.DateTimeFormat(calendarLocale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(month.year, month.month, 1)))
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(calendarLocale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, index + 1))))

  const shiftMonth = (delta: number) => setMonth(({ year, month: current }) => monthOf(new Date(Date.UTC(year, current + delta, 1))))
  const openCalendar = () => {
    const selected = parseDate(value) || parseDate(localToday())!
    setMonth(monthOf(selected))
    setFocusedDate(selected.toISOString().slice(0, 10))
    setOpen(true)
  }
  const choose = (selected: string) => {
    onChange(selected)
    setOpen(false)
    triggerRef.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const trigger = triggerRef.current?.getBoundingClientRect()
      const popup = popupRef.current
      if (!trigger || !popup) return
      const width = Math.min(288, window.innerWidth - 16)
      const left = Math.max(8, Math.min(trigger.left, window.innerWidth - width - 8))
      const below = window.innerHeight - trigger.bottom - 8
      const maxHeight = window.innerHeight - 16
      const height = Math.min(popup.scrollHeight, maxHeight)
      const top = below >= height || below >= trigger.top
        ? trigger.bottom + 5
        : Math.max(8, trigger.top - height - 5)
      setPosition({ left, top: Math.min(top, window.innerHeight - height - 8), width, maxHeight })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [open, month.year, month.month])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !popupRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  useEffect(() => {
    if (open) popupRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedDate}"]`)?.focus()
  }, [open, focusedDate, month.year, month.month])

  const onCalendarKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -7 : event.key === 'ArrowDown' ? 7 : 0
    if (!step || !(event.target instanceof HTMLElement) || !event.target.dataset.date) return
    event.preventDefault()
    const next = parseDate(event.target.dataset.date)!
    next.setUTCDate(next.getUTCDate() + step)
    setFocusedDate(next.toISOString().slice(0, 10))
    setMonth(monthOf(next))
  }

  return <>
    <button ref={triggerRef} type="button" className="seed-text-input w-full justify-between gap-2 text-left" aria-label={label} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => open ? setOpen(false) : openCalendar()}>
      <span className={value ? 'text-foreground' : 'text-muted-foreground'}>{value || placeholder}</span>
      <CalendarDays size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={popupRef} className="fixed z-[110] overflow-y-auto rounded-[var(--radius-control)] border border-border bg-card p-3 text-foreground shadow-lg"
      style={{ ...position, visibility: position ? 'visible' : 'hidden' }} role="dialog" aria-label={label} onKeyDown={onCalendarKeyDown}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <IconButton icon={<ChevronLeft size={16} />} label={previousMonthLabel} onClick={() => shiftMonth(-1)} />
        <span className="text-[13px] font-medium">{monthLabel}</span>
        <IconButton icon={<ChevronRight size={16} />} label={nextMonthLabel} onClick={() => shiftMonth(1)} />
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {weekdays.map((day, index) => <span key={index} className="py-1 text-[11px] text-muted-foreground">{day}</span>)}
        {days.map((day) => <button key={day.value} type="button" data-date={day.value} tabIndex={day.value === focusedDate ? 0 : -1}
          className={`grid size-8 place-items-center rounded-[var(--radius-control)] text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${day.value === value ? 'bg-accent text-accent-foreground' : day.value === today ? 'border border-accent text-foreground hover:bg-muted' : day.inMonth ? 'text-foreground hover:bg-muted' : 'text-muted-foreground hover:bg-muted'}`}
          aria-label={day.value} aria-pressed={day.value === value} onClick={() => choose(day.value)}>{day.day}</button>)}
      </div>
      <div className="mt-3 flex justify-between border-t border-border pt-2">
        <ActionButton type="button" tone="ghost" onClick={() => choose(today)}>{todayLabel}</ActionButton>
        {value && <ActionButton type="button" tone="ghost" onClick={() => choose('')}>{clearLabel}</ActionButton>}
      </div>
    </div>, document.body)}
  </>
}
