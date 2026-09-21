/*
 * Adapted from Rare UI's GitHub Activity component.
 * https://github.com/swamimalode07/rare-ui
 *
 * MIT License
 *
 * Copyright (c) 2026 Swami Malode
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cx } from '../lib/display'

export type ActivityLevel = 0 | 1 | 2 | 3 | 4

export type ActivityContribution = {
  date: string
  count: number
  level: ActivityLevel
}

type LevelStyle = { backgroundColor: string; opacity: number }
type HoveredDay = { day: ActivityContribution; x: number; y: number }

type RareUiActivityGridProps = {
  contributions: ActivityContribution[]
  describeDay: (day: ActivityContribution) => string
  monthNames: string[]
  accent?: string | string[]
  cellSize?: number
  months?: number
  showMonths?: boolean
  label: string
  className?: string
}

const LEVELS = [0, 1, 2, 3, 4] as const
const LEVEL_OPACITY: Record<ActivityLevel, number> = { 0: 0, 1: 0.3, 2: 0.52, 3: 0.76, 4: 1 }
const WEEKS_PER_MONTH = 365.25 / 12 / 7
const MIN_LABEL_WEEKS = 3
const TOOLTIP_EDGE = 8
const COLUMN_STAGGER = 0.012
const CELL_FADE = { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const }
const TOOLTIP_FADE = { duration: 0.14, ease: [0.22, 1, 0.36, 1] as const }
const LABEL_REVEAL = { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const }

const useIsoLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect
const gapFor = (cellSize: number) => Math.max(2, Math.round(cellSize / 4))
const weeksFor = (months: number) => Math.max(1, Math.ceil(months * WEEKS_PER_MONTH))

function toWeeks(contributions: ActivityContribution[]) {
  const weeks: ActivityContribution[][] = []
  for (let index = 0; index < contributions.length; index += 7) weeks.push(contributions.slice(index, index + 7))
  return weeks
}

function toMonthLabels(weeks: ActivityContribution[][], monthNames: string[]) {
  const labels: Array<string | null> = weeks.map(() => null)
  const monthAt = (index: number) => weeks[index]?.[0]?.date.slice(5, 7)
  let start = 0
  for (let index = 1; index <= weeks.length; index += 1) {
    if (index < weeks.length && monthAt(index) === monthAt(start)) continue
    if (index - start >= MIN_LABEL_WEEKS) labels[start] = monthNames[Number(monthAt(start)) - 1] ?? null
    start = index
  }
  return labels
}

function toScale(accent: string | string[]): LevelStyle[] {
  if (typeof accent === 'string') {
    return LEVELS.map((level) => ({ backgroundColor: accent, opacity: LEVEL_OPACITY[level] }))
  }
  const colors = accent.length > 4 ? accent : ['transparent', ...accent]
  return LEVELS.map((level) => {
    const color = colors[level] ?? colors.at(-1) ?? 'transparent'
    return { backgroundColor: color, opacity: color === 'transparent' ? 0 : 1 }
  })
}

function ActivityTooltip({ hovered, describeDay, reduceMotion }: {
  hovered: HoveredDay
  describeDay: (day: ActivityContribution) => string
  reduceMotion: boolean | null
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [left, setLeft] = React.useState(hovered.x)

  useIsoLayoutEffect(() => {
    const half = (ref.current?.offsetWidth ?? 0) / 2
    const edge = TOOLTIP_EDGE + half
    setLeft(Math.min(Math.max(hovered.x, edge), window.innerWidth - edge))
  }, [hovered])

  return createPortal(
    <div className="pointer-events-none fixed z-50" style={{ left, top: hovered.y, transform: 'translate(-50%, calc(-100% - 8px))' }}>
      <motion.div
        ref={ref}
        className="whitespace-nowrap rounded-lg bg-foreground px-2 py-1 text-[11px] font-medium text-background shadow-md"
        initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
        transition={reduceMotion ? { duration: 0 } : TOOLTIP_FADE}
      >
        {describeDay(hovered.day)}
      </motion.div>
    </div>,
    document.body,
  )
}

export function RareUiActivityGrid({
  contributions,
  describeDay,
  monthNames,
  accent = 'var(--seed-accent)',
  cellSize = 11,
  months = 3,
  showMonths = true,
  label,
  className,
}: RareUiActivityGridProps) {
  const reduceMotion = useReducedMotion()
  const weeks = React.useMemo(() => toWeeks(contributions), [contributions])
  const scale = React.useMemo(() => toScale(accent), [accent])
  const [hovered, setHovered] = React.useState<HoveredDay>()
  const cap = Math.min(weeks.length, weeksFor(months))
  const visible = weeks.slice(-cap)
  const gap = gapFor(cellSize)
  const gridStyle = { gap, gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }
  const sweepEnd = Math.max(0, visible.length - 1) * COLUMN_STAGGER + CELL_FADE.duration

  const hover = (day: ActivityContribution) => (event: React.PointerEvent) => {
    const cell = event.currentTarget.getBoundingClientRect()
    setHovered({ day, x: cell.left + cell.width / 2, y: cell.top })
  }

  return <div data-slot="rare-ui-activity-grid" role="img" aria-label={label} className={cx('relative w-full', className)}>
    <div className="grid w-full" style={gridStyle} onPointerLeave={() => setHovered(undefined)}>
      {visible.map((week, weekIndex) => <div className="flex min-w-0 flex-col" key={week[0]?.date ?? weekIndex} style={{ gap }}>
        {week.map((day) => <motion.div
          aria-label={describeDay(day)}
          className="aspect-square w-full shrink-0 rounded-[3px] bg-foreground/[0.08]"
          key={day.date}
          onPointerEnter={hover(day)}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...CELL_FADE, delay: reduceMotion ? 0 : weekIndex * COLUMN_STAGGER }}
        >
          <div className="h-full w-full rounded-[3px]" style={scale[day.level] ?? scale[0]} />
        </motion.div>)}
      </div>)}
    </div>

    {showMonths && <motion.div
      className="grid w-full"
      style={{ ...gridStyle, marginTop: gap + 8 }}
      initial={reduceMotion ? false : { opacity: 0, filter: 'blur(6px)' }}
      animate={{ opacity: 1, filter: 'blur(0px)' }}
      transition={{ ...LABEL_REVEAL, delay: reduceMotion ? 0 : sweepEnd }}
    >
      {toMonthLabels(visible, monthNames).map((month, index) => <div className="relative h-3 min-w-0" key={index}>
        {month && <span className="absolute left-0 top-0 whitespace-nowrap text-[10px] leading-none text-muted-foreground">{month}</span>}
      </div>)}
    </motion.div>}

    <AnimatePresence>
      {hovered && <ActivityTooltip describeDay={describeDay} hovered={hovered} key="tooltip" reduceMotion={reduceMotion} />}
    </AnimatePresence>
  </div>
}
