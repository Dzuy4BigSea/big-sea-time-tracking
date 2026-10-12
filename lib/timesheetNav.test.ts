import { describe, it, expect } from 'vitest'
import { navQuery, resolveTimesheetNav, timesheetUrl } from './timesheetNav'
import { parseYmd, ymd } from './week'

const NOW = new Date('2026-10-14T15:30:00Z') // a Wednesday
const d = (s: string) => parseYmd(s)!

describe('resolveTimesheetNav', () => {
  it('defaults to this week with today selected', () => {
    const n = resolveTimesheetNav({}, NOW)
    expect(n.view).toBe('week')
    expect(ymd(n.weekStart)).toBe('2026-10-12')
    expect(ymd(n.weekEnd)).toBe('2026-10-18')
    expect(ymd(n.date)).toBe('2026-10-14')
    expect(n.isCurrentWeek).toBe(true)
    expect(n.isToday).toBe(true)
    expect(n.days).toHaveLength(7)
  })
  it('selects the first day of a past week', () => {
    const n = resolveTimesheetNav({ week: '2026-10-08' }, NOW)
    expect(ymd(n.weekStart)).toBe('2026-10-05')
    expect(ymd(n.date)).toBe('2026-10-05')
    expect(n.isCurrentWeek).toBe(false)
    expect(n.isToday).toBe(false)
  })
  it('honours a Sunday week start', () => {
    expect(ymd(resolveTimesheetNav({}, NOW, 'sunday').weekStart)).toBe('2026-10-11')
  })
  it('opens day view on the requested date, defaulting to today', () => {
    const n = resolveTimesheetNav({ view: 'day', date: '2026-10-07' }, NOW)
    expect(n.view).toBe('day')
    expect(ymd(n.date)).toBe('2026-10-07')
    expect(ymd(n.weekStart)).toBe('2026-10-05')
    expect(n.isToday).toBe(false)
    const t = resolveTimesheetNav({ view: 'day', date: 'garbage' }, NOW)
    expect(ymd(t.date)).toBe('2026-10-14')
    expect(t.isToday).toBe(true)
  })
  it('treats unknown views as week', () => {
    expect(resolveTimesheetNav({ view: 'month' }, NOW).view).toBe('week')
  })
})

describe('timesheetUrl / navQuery', () => {
  it('builds day, week and return URLs', () => {
    expect(timesheetUrl({ day: d('2026-10-07') })).toBe('/timesheet?view=day&date=2026-10-07')
    expect(timesheetUrl({ week: d('2026-10-05') }, 'u2')).toBe('/timesheet?week=2026-10-05&user=u2')
    expect(timesheetUrl({ thisWeek: true })).toBe('/timesheet')
    expect(timesheetUrl({ thisWeek: true }, 'u2')).toBe('/timesheet?user=u2')
    expect(timesheetUrl({ today: true }, 'u2')).toBe('/timesheet?view=day&user=u2')
  })
  it('keeps the view in the teammate-switch query', () => {
    expect(navQuery(resolveTimesheetNav({ view: 'day', date: '2026-10-07' }, NOW))).toBe('view=day&date=2026-10-07')
    expect(navQuery(resolveTimesheetNav({ week: '2026-10-07' }, NOW))).toBe('week=2026-10-05')
  })
})
