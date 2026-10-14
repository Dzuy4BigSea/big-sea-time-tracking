/**
 * Recurring-invoice scheduling (specs/10 §recurring, specs/27).
 *
 * Pure date math for advancing a profile's nextIssueDate by its frequency × interval, plus the
 * template form parsing (schedule presets, first issue date rule, line items, search).
 * Generation (cloning the template into a draft invoice) lives in ./generateRecurring;
 * these helpers are DB-free and unit-tested.
 */

export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'

const daysInUtcMonth = (year: number, monthIndex0: number) => new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()

/**
 * Add whole months to a UTC date-only value, clamping the day to the target month's length.
 * `anchorDay` (1–31) is the day of month the schedule was set up on. Harvest issues a
 * 31st-of-the-month template on the last day of short months and back on the 31st in long ones
 * (specs/27 AC-REC-102), so with an anchor the day comes from it, not from the (possibly clamped)
 * current date.
 */
export function addMonthsUtc(date: Date, months: number, anchorDay?: number | null): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  const d = anchorDay && anchorDay >= 1 && anchorDay <= 31 ? anchorDay : date.getUTCDate()
  const targetMonthAbs = m + months
  const targetYear = y + Math.floor(targetMonthAbs / 12)
  const targetMonth = ((targetMonthAbs % 12) + 12) % 12
  const clampedDay = Math.min(d, daysInUtcMonth(targetYear, targetMonth))
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay))
}

export function addDaysUtc(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days))
}

/** Advance an issue date by one interval of the given frequency (AC-REC-001, AC-REC-102). */
export function advanceIssueDate(date: Date, frequency: RecurringFrequency, intervalCount = 1, anchorDay?: number | null): Date {
  const n = Math.max(1, Math.floor(intervalCount))
  switch (frequency) {
    case 'weekly':
      return addDaysUtc(date, 7 * n)
    case 'monthly':
      return addMonthsUtc(date, n, anchorDay)
    case 'quarterly':
      return addMonthsUtc(date, 3 * n, anchorDay)
    case 'yearly':
      return addMonthsUtc(date, 12 * n, anchorDay)
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
export function nextFutureIssueDate(
  date: Date,
  frequency: RecurringFrequency,
  intervalCount: number,
  asOf: Date,
  anchorDay?: number | null,
): Date {
  const asOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())
  let next = advanceIssueDate(date, frequency, intervalCount, anchorDay)
  for (let guard = 0; next.getTime() <= asOfDay && guard < 100_000; guard++) {
    next = advanceIssueDate(next, frequency, intervalCount, anchorDay)
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

// ---------------------------------------------------------------------------------------------
// Template form helpers (specs/27 AC-REC-101/104/106/108). Pure; the server actions call these.
// ---------------------------------------------------------------------------------------------

/**
 * "How often" presets, in display order. Harvest's exact option list is UNVERIFIED (specs/27).
 * Each maps onto the stored frequency + interval. "custom" opens "every [n] [days|weeks|months]".
 */
export const RECURRING_PRESETS: { key: string; label: string; frequency: RecurringFrequency; intervalCount: number }[] = [
  { key: 'weekly', label: 'Weekly', frequency: 'weekly', intervalCount: 1 },
  { key: 'every_2_weeks', label: 'Every 2 weeks', frequency: 'weekly', intervalCount: 2 },
  { key: 'every_4_weeks', label: 'Every 4 weeks', frequency: 'weekly', intervalCount: 4 },
  { key: 'monthly', label: 'Monthly', frequency: 'monthly', intervalCount: 1 },
  { key: 'every_2_months', label: 'Every 2 months', frequency: 'monthly', intervalCount: 2 },
  { key: 'quarterly', label: 'Quarterly', frequency: 'quarterly', intervalCount: 1 },
  { key: 'every_6_months', label: 'Every 6 months', frequency: 'monthly', intervalCount: 6 },
  { key: 'yearly', label: 'Yearly', frequency: 'yearly', intervalCount: 1 },
  { key: 'every_2_years', label: 'Every 2 years', frequency: 'yearly', intervalCount: 2 },
]

export type CustomUnit = 'days' | 'weeks' | 'months'

const monthsOf = (frequency: RecurringFrequency, n: number) =>
  frequency === 'monthly' ? n : frequency === 'quarterly' ? 3 * n : frequency === 'yearly' ? 12 * n : 0

/** The form values for a stored schedule: a preset key, or 'custom' with its n + unit. */
export function scheduleToForm(frequency: RecurringFrequency, intervalCount: number): { preset: string; customN: number; customUnit: CustomUnit } {
  const n = Math.max(1, Math.floor(intervalCount))
  const months = monthsOf(frequency, n)
  const hit =
    RECURRING_PRESETS.find((p) => p.frequency === frequency && p.intervalCount === n) ??
    (months ? RECURRING_PRESETS.find((p) => monthsOf(p.frequency, p.intervalCount) === months) : undefined)
  if (frequency === 'weekly') return { preset: hit?.key ?? 'custom', customN: n, customUnit: 'weeks' }
  if (frequency === 'custom') return { preset: 'custom', customN: n, customUnit: 'days' }
  return { preset: hit?.key ?? 'custom', customN: months, customUnit: 'months' }
}

/** Parse "How often" (+ custom n/unit) into the stored frequency + interval. */
export function parseSchedule(
  preset: unknown,
  customN: unknown,
  customUnit: unknown,
): { frequency: RecurringFrequency; intervalCount: number } | 'invalid' {
  const key = String(preset ?? '')
  const hit = RECURRING_PRESETS.find((p) => p.key === key)
  if (hit) return { frequency: hit.frequency, intervalCount: hit.intervalCount }
  if (key !== 'custom') return 'invalid'
  const raw = String(customN ?? '').trim()
  if (!/^\d+$/.test(raw)) return 'invalid'
  const n = Number(raw)
  if (n < 1 || n > 365) return 'invalid'
  const unit = String(customUnit ?? '')
  if (unit === 'days') return { frequency: 'custom', intervalCount: n }
  if (unit === 'weeks') return { frequency: 'weekly', intervalCount: n }
  if (unit === 'months') return { frequency: 'monthly', intervalCount: n }
  return 'invalid'
}

export const FIRST_ISSUE_DATE_ERROR = 'The first issue date must be after today. To bill today, create a one-time invoice.'

/**
 * Harvest: a recurring template's first issue date cannot be today (or earlier). `today` is the
 * account's calendar day (UTC-midnight date). AC-REC-101.
 */
export function isValidFirstIssueDate(date: Date | null, today: Date): boolean {
  if (!date) return false
  const a = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  const b = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return a > b
}

export interface TemplateLineInput {
  description: string
  quantity: number
  unitPriceCents: number
  amountCents: number
  taxable?: boolean
  linkedProjectId?: string | null
}

/**
 * Parse the template's "+ Add item" rows (parallel description / quantity / unit price arrays).
 * Fully blank rows are skipped. The unit price becomes integer cents once (INV-1), and each line
 * amount is round(qty × unit price cents). Returns the lines + the template amount, or an error.
 */
export function parseTemplateLines(
  descriptions: unknown[],
  quantities: unknown[],
  unitPrices: unknown[],
  /** per-row fields the form carries through unchanged (an edit must not drop a project link) */
  extras: { taxable?: boolean; linkedProjectId?: string | null }[] = [],
): { lines: TemplateLineInput[]; amountCents: number } | { error: string } {
  const lines: TemplateLineInput[] = []
  const rows = Math.max(descriptions.length, quantities.length, unitPrices.length)
  for (let i = 0; i < rows; i++) {
    const description = String(descriptions[i] ?? '').trim()
    const qRaw = String(quantities[i] ?? '').trim()
    const pRaw = String(unitPrices[i] ?? '').replace(/[$,\s]/g, '')
    if (!description && !qRaw && !pRaw) continue
    if (!description) return { error: `Line ${i + 1}: add a description.` }
    const quantity = qRaw === '' ? 1 : Number(qRaw)
    if (!Number.isFinite(quantity) || quantity <= 0) return { error: `Line ${i + 1}: quantity must be a number above 0.` }
    const price = Number(pRaw)
    if (pRaw === '' || !Number.isFinite(price)) return { error: `Line ${i + 1}: enter a unit price.` }
    const unitPriceCents = Math.round(price * 100)
    const amountCents = Math.round(quantity * unitPriceCents)
    const extra = extras[i] ?? {}
    lines.push({
      description,
      quantity,
      unitPriceCents,
      amountCents,
      ...(extra.taxable ? { taxable: true } : {}),
      ...(extra.linkedProjectId ? { linkedProjectId: extra.linkedProjectId } : {}),
    })
  }
  if (lines.length === 0) return { error: 'Add at least one line item.' }
  const amountCents = lines.reduce((s, l) => s + l.amountCents, 0)
  if (amountCents <= 0) return { error: 'The template total must be above zero.' }
  return { lines, amountCents }
}

/** Case-insensitive match on subject, line descriptions and notes (Harvest recurring search, AC-REC-108). */
export function matchesRecurringSearch(p: { subject: string; notes: string | null; templateLineItems: unknown }, term: string): boolean {
  const t = term.trim().toLowerCase()
  if (!t) return true
  if (p.subject.toLowerCase().includes(t)) return true
  if ((p.notes ?? '').toLowerCase().includes(t)) return true
  const lines = Array.isArray(p.templateLineItems) ? (p.templateLineItems as { description?: unknown }[]) : []
  return lines.some((l) => String(l?.description ?? '').toLowerCase().includes(t))
}
