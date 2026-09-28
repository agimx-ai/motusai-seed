import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { calendarMonthDays, DateInputControl } from './DateInputControl'

describe('DateInputControl', () => {
  it('renders a shared-token trigger instead of a native date input', () => {
    const html = renderToStaticMarkup(<DateInputControl value="2024-02-29" label="Date" locale="en_US" placeholder="Select a date"
      previousMonthLabel="Previous month" nextMonthLabel="Next month" todayLabel="Today" clearLabel="Clear" onChange={() => undefined} />)
    expect(html).toContain('seed-text-input')
    expect(html).toContain('2024-02-29')
    expect(html).not.toContain('type="date"')
  })

  it('places leap-day and adjacent-month dates in the correct calendar cells', () => {
    const days = calendarMonthDays(2024, 1)
    expect(days).toHaveLength(42)
    expect(days[0]).toEqual({ value: '2024-01-29', day: 29, inMonth: false })
    expect(days.find((day) => day.value === '2024-02-29')).toEqual({ value: '2024-02-29', day: 29, inMonth: true })
    expect(calendarMonthDays(2026, 1).some((day) => day.value === '2026-02-29')).toBe(false)
  })
})
