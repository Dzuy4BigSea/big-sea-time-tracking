/**
 * Account-timezone date helpers.
 *
 * Servers run in UTC, but "today" for Big Sea is the account's wall-clock day (Account.timezone,
 * default America/New_York). Date-only values (spentDate, issueDate, dueDate) are stored as UTC
 * midnight of the calendar day, so "today" must be that calendar day *in the account timezone*,
 * or work logged after 8pm Eastern lands on tomorrow.
 */

export const DEFAULT_TIMEZONE = 'America/New_York'

function safeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return DEFAULT_TIMEZONE
  }
}

/** Calendar parts of `now` as seen in `tz`. */
export function zonedParts(now: Date, tz?: string | null): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') }
}

/** Today's calendar day in `tz`, as a date-only value (UTC midnight of that day). */
export function todayIn(tz?: string | null, now: Date = new Date()): Date {
  const { year, month, day } = zonedParts(now, tz)
  return new Date(Date.UTC(year, month - 1, day))
}

/** Today's calendar day in `tz` as YYYY-MM-DD. */
export function todayYmdIn(tz?: string | null, now: Date = new Date()): string {
  return todayIn(tz, now).toISOString().slice(0, 10)
}

/** Wall-clock time of `d` in `tz`, e.g. "3:05 PM". */
export function formatTimeIn(d: Date, tz?: string | null): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: safeZone(tz), hour: 'numeric', minute: '2-digit' }).format(d)
}
