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

/** Is this profile due to generate as of `asOf` (date-only comparison)? */
export function isDue(nextIssueDate: Date | null, asOf: Date, status: 'active' | 'paused'): boolean {
  if (status !== 'active' || !nextIssueDate) return false
  const a = Date.UTC(nextIssueDate.getUTCFullYear(), nextIssueDate.getUTCMonth(), nextIssueDate.getUTCDate())
  const b = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())
  return a <= b
}

/** Human label for the cadence, e.g. "every month", "every 2 weeks". */
export function cadenceLabel(frequency: RecurringFrequency, intervalCount = 1): string {
  const n = Math.max(1, Math.floor(intervalCount))
  const unit = { weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year', custom: 'day' }[frequency]
  return n === 1 ? `every ${unit}` : `every ${n} ${unit}s`
}
