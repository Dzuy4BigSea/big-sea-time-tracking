/**
 * Pure navigation state for /timesheet: Day vs Week view, the selected day / week, and the URLs
 * for prev / next / toggles / "Return to …" links. Harvest-style query params:
 *   week view: `?week=YYYY-MM-DD` (any day in the week; omitted = this week)
 *   day view:  `?view=day&date=YYYY-MM-DD` (omitted date = today)
 * plus `user=<id>` on a teammate's sheet (authorized server-side, never here).
 */
import { addDays, inWeek, parseYmd, sameDay, startOfWeek, ymd } from '@/lib/week'
import { todayIn } from '@/lib/tz'

export type TimesheetView = 'day' | 'week'

export interface TimesheetNav {
  view: TimesheetView
  /** The selected day: the requested date in day view; in week view today if it is in the week, else the week's first day. */
  date: Date
  weekStart: Date
  weekEnd: Date
  days: Date[]
  today: Date
  isCurrentWeek: boolean
  isToday: boolean
}

export function resolveTimesheetNav(
  params: { view?: string; date?: string; week?: string },
  now: Date,
  weekStartsOn: 'monday' | 'sunday' = 'monday',
  /** Account timezone: "today" is the account's calendar day, not the server's UTC day. */
  timezone?: string | null,
): TimesheetNav {
  const today = todayIn(timezone, now)
  const view: TimesheetView = params.view === 'day' ? 'day' : 'week'
  const anchor = view === 'day' ? parseYmd(params.date) ?? parseYmd(params.week) ?? today : parseYmd(params.week) ?? today
  const weekStart = startOfWeek(anchor, weekStartsOn)
  const date = view === 'day' ? anchor : inWeek(today, weekStart) ? today : weekStart
  return {
    view,
    date,
    weekStart,
    weekEnd: addDays(weekStart, 6),
    days: Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    today,
    isCurrentWeek: inWeek(today, weekStart),
    isToday: sameDay(date, today),
  }
}

/** Build a /timesheet URL. `day` → day view on that date; `week` → week view of that week. */
export function timesheetUrl(target: { day: Date } | { week: Date } | { thisWeek: true } | { today: true }, userId?: string): string {
  const p = new URLSearchParams()
  if ('day' in target) {
    p.set('view', 'day')
    p.set('date', ymd(target.day))
  } else if ('week' in target) p.set('week', ymd(target.week))
  else if ('today' in target) p.set('view', 'day')
  if (userId) p.set('user', userId)
  const qs = p.toString()
  return qs ? `/timesheet?${qs}` : '/timesheet'
}

/** The query string (without `user`) that keeps the current view/date when switching teammate. */
export function navQuery(nav: TimesheetNav): string {
  const p = new URLSearchParams()
  if (nav.view === 'day') {
    p.set('view', 'day')
    p.set('date', ymd(nav.date))
  } else p.set('week', ymd(nav.weekStart))
  return p.toString()
}
