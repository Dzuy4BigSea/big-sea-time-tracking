/**
 * Recurring-invoice scheduling (specs/10 §recurring).
 *
 * Pure date math for advancing a profile's nextIssueDate by its frequency × interval.
 * Generation (cloning the template into a draft invoice) lives in the service layer;
 * these helpers are DB-free and unit-tested.
 */

export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'

const daysInUtcMonth = (year: number, monthIndex0: number) => new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()

/** Add whole months to a UTC date-only value, clamping the day to the target month's length. */
export function addMonthsUtc(date: Date, months: number): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  const d = date.getUTCDate()
  const targetMonthAbs = m + months
  const targetYear = y + Math.floor(targetMonthAbs / 12)
  const targetMonth = ((targetMonthAbs % 12) + 12) % 12
  const clampedDay = Math.min(d, daysInUtcMonth(targetYear, targetMonth))
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay))
}

export function addDaysUtc(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days))
}

/** Advance an issue date by one interval of the given frequency (AC-REC-001). */
export function advanceIssueDate(date: Date, frequency: RecurringFrequency, intervalCount = 1): Date {
  const n = Math.max(1, Math.floor(intervalCount))
  switch (frequency) {
    case 'weekly':
      return addDaysUtc(date, 7 * n)
    case 'monthly':
      return addMonthsUtc(date, n)
    case 'quarterly':
      return addMonthsUtc(date, 3 * n)
    case 'yearly':
      return addMonthsUtc(date, 12 * n)
    case 'custom':
    default:
      return addDaysUtc(date, n) // custom interval = n days
  }
}

/**
 * The next issue date after generating for `date`: advance one interval, then keep advancing until
 * the date is after `asOf`. A profile that fell behind (cron outage, paused then resumed) issues at
 * most ONE catch-up invoice instead of a backlog of one per missed interval.
 */
export function nextFutureIssueDate(date: Date, frequency: RecurringFrequency, intervalCount: number, asOf: Date): Date {
  const asOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())
  let next = advanceIssueDate(date, frequency, intervalCount)
  for (let guard = 0; next.getTime() <= asOfDay && guard < 100_000; guard++) {
    next = advanceIssueDate(next, frequency, intervalCount)
  }
  return next
}

/**
 * Is this profile due to generate as of `asOf` (date-only comparison)?
 * `remainingOccurrences`: null/undefined = recur indefinitely; ≤ 0 = the issue limit is used up.
 */
export function isDue(
  nextIssueDate: Date | null,
  asOf: Date,
  status: 'active' | 'paused',
  remainingOccurrences: number | null = null,
): boolean {
  if (status !== 'active' || !nextIssueDate) return false
  if (remainingOccurrences != null && remainingOccurrences <= 0) return false
  const a = Date.UTC(nextIssueDate.getUTCFullYear(), nextIssueDate.getUTCMonth(), nextIssueDate.getUTCDate())
  const b = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())
  return a <= b
}

/**
 * Occurrence limit after one invoice is issued (BugHerd #13 — "number of invoices to issue").
 * Indefinite (null) stays indefinite; a count decrements, and when it reaches 0 the profile
 * pauses (it reads as "Completed" in the UI and cannot resume until given more occurrences).
 */
export function afterIssue(remainingOccurrences: number | null): {
  remainingOccurrences: number | null
  status: 'active' | 'paused'
} {
  if (remainingOccurrences == null) return { remainingOccurrences: null, status: 'active' }
  const left = Math.max(0, remainingOccurrences - 1)
  return { remainingOccurrences: left, status: left === 0 ? 'paused' : 'active' }
}

/** A profile whose occurrence limit is used up. */
export function isCompleted(remainingOccurrences: number | null): boolean {
  return remainingOccurrences != null && remainingOccurrences <= 0
}

/**
 * Parse the "Number of invoices to issue" form field. Blank → null (recur indefinitely);
 * a whole number ≥ 1 → that count; anything else → 'invalid'.
 */
export function parseOccurrenceLimit(raw: unknown): number | null | 'invalid' {
  const s = String(raw ?? '').trim()
  if (s === '') return null
  if (!/^\d+$/.test(s)) return 'invalid'
  const n = Number(s)
  return n >= 1 && n <= 10_000 ? n : 'invalid'
}

/** Human label for the cadence, e.g. "every month", "every 2 weeks". */
export function cadenceLabel(frequency: RecurringFrequency, intervalCount = 1): string {
  const n = Math.max(1, Math.floor(intervalCount))
  const unit = { weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year', custom: 'day' }[frequency]
  return n === 1 ? `every ${unit}` : `every ${n} ${unit}s`
}
