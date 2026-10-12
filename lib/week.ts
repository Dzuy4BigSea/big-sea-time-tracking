/** UTC week helpers (week starts Monday, matching the account default). */

export function startOfWeekMonday(d: Date): Date {
  const day = d.getUTCDay() // 0=Sun .. 6=Sat
  const sinceMonday = (day + 6) % 7
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday))
}

/** Start of the week honoring the account preference ('monday' | 'sunday'). */
export function startOfWeek(d: Date, weekStartsOn: 'monday' | 'sunday' = 'monday'): Date {
  if (weekStartsOn === 'sunday') {
    const day = d.getUTCDay() // 0=Sun
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day))
  }
  return startOfWeekMonday(d)
}

export function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n))
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Parse a YYYY-MM-DD string to a UTC-midnight Date, or null (also for impossible dates like 2026-02-30). */
export function parseYmd(s: string | undefined | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return isNaN(d.getTime()) || ymd(d) !== s ? null : d
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const dd = (d: Date) => String(d.getUTCDate()).padStart(2, '0')

/** "Mon" for a UTC date. */
export function weekdayShort(d: Date): string {
  return DOW_SHORT[d.getUTCDay()]
}

/** "05 Oct" for a UTC date (Harvest's week-grid column header second line). */
export function dayMonth(d: Date): string {
  return `${dd(d)} ${MONTHS[d.getUTCMonth()]}`
}

/**
 * Harvest-style week range: "05 – 11 Oct 2026"; across months "28 Sep – 04 Oct 2026";
 * across years "29 Dec 2025 – 04 Jan 2026".
 */
export function formatWeekRange(start: Date, end: Date): string {
  const y1 = start.getUTCFullYear()
  const y2 = end.getUTCFullYear()
  if (y1 !== y2) return `${dayMonth(start)} ${y1} – ${dayMonth(end)} ${y2}`
  if (start.getUTCMonth() !== end.getUTCMonth()) return `${dayMonth(start)} – ${dayMonth(end)} ${y2}`
  return `${dd(start)} – ${dayMonth(end)} ${y2}`
}

/** The week-nav pill label: "This week 12 – 18 Oct 2026" on the current week, else just the range. */
export function weekNavLabel(start: Date, end: Date, isCurrentWeek: boolean): string {
  const range = formatWeekRange(start, end)
  return isCurrentWeek ? `This week ${range}` : range
}

/** The day-nav pill label: "Today: Monday, 12 Oct 2026" on today, else "Monday, 05 Oct 2026". */
export function dayNavLabel(d: Date, isToday: boolean): string {
  const s = `${DOW_LONG[d.getUTCDay()]}, ${dayMonth(d)} ${d.getUTCFullYear()}`
  return isToday ? `Today: ${s}` : s
}

/** True when `d` falls in the 7-day week starting at `weekStart` (UTC days). */
export function inWeek(d: Date, weekStart: Date): boolean {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return t >= weekStart.getTime() && t < addDays(weekStart, 7).getTime()
}
