import { describe, it, expect } from 'vitest'
import { dayMonth, dayNavLabel, formatWeekRange, inWeek, parseYmd, weekNavLabel, weekdayShort } from './week'

const d = (s: string) => parseYmd(s)!

describe('week labels', () => {
  it('formats a same-month range', () => {
    expect(formatWeekRange(d('2026-10-05'), d('2026-10-11'))).toBe('05 – 11 Oct 2026')
  })
  it('formats a cross-month range', () => {
    expect(formatWeekRange(d('2026-09-28'), d('2026-10-04'))).toBe('28 Sep – 04 Oct 2026')
  })
  it('formats a cross-year range', () => {
    expect(formatWeekRange(d('2025-12-29'), d('2026-01-04'))).toBe('29 Dec 2025 – 04 Jan 2026')
  })
  it('prefixes "This week" only on the current week', () => {
    expect(weekNavLabel(d('2026-10-12'), d('2026-10-18'), true)).toBe('This week 12 – 18 Oct 2026')
    expect(weekNavLabel(d('2026-10-05'), d('2026-10-11'), false)).toBe('05 – 11 Oct 2026')
  })
  it('formats day headers', () => {
    expect(weekdayShort(d('2026-10-05'))).toBe('Mon')
    expect(dayMonth(d('2026-10-05'))).toBe('05 Oct')
  })
  it('formats the day-nav label', () => {
    expect(dayNavLabel(d('2026-10-12'), true)).toBe('Today: Monday, 12 Oct 2026')
    expect(dayNavLabel(d('2026-10-05'), false)).toBe('Monday, 05 Oct 2026')
  })
  it('checks week membership', () => {
    expect(inWeek(d('2026-10-18'), d('2026-10-12'))).toBe(true)
    expect(inWeek(d('2026-10-19'), d('2026-10-12'))).toBe(false)
    expect(inWeek(new Date('2026-10-12T23:59:00Z'), d('2026-10-12'))).toBe(true)
  })
})
