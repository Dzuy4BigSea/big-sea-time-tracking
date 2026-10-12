/**
 * Project-detail timeframe selection (BugHerd #6): Week, Month, Quarter, Year, All time, Custom.
 *
 * URL shape: `?period=week|month|quarter|year|all|custom`
 *   - bounded periods carry an anchor date `&date=YYYY-MM-DD` (any day inside the period; default today)
 *   - custom carries `&from=YYYY-MM-DD&to=YYYY-MM-DD` (both inclusive; either may be blank = open-ended)
 * Legacy links (`?month=YYYY-MM`, `?month=M&year=YYYY`, or `?year=YYYY` alone) still resolve,
 * to period=month (or period=year for a bare year).
 *
 * Default when no period is given (see `defaultPeriodFor`): a project whose budget resets monthly
 * opens on the current Month; everything else (total budget, no budget, fixed fee) opens on All time.
 *
 * All dates are UTC midnight; `end` is exclusive so ranges compose with `spentDate < end`.
 */

export type Period = 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom'
export const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
]
const PERIOD_KEYS = new Set<string>(PERIODS.map((p) => p.key))
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type WeekStart = 'monday' | 'sunday'

export interface Timeframe {
  period: Period
  /** Inclusive start (UTC midnight), or null when unbounded. */
  start: Date | null
  /** Exclusive end (UTC midnight), or null when unbounded. */
  end: Date | null
  /** Anchor day for bounded periods (YYYY-MM-DD); used for prev/next. */
  anchor: string
}

export interface TimeframeParams {
  period?: string
  date?: string
  from?: string
  to?: string
  month?: string
  year?: string
}

export interface BudgetShape {
  projectType: string
  budgetMethod: string
  budgetResetsMonthly: boolean
}

/**
 * Default timeframe for a project: Month when it has a budget that resets monthly
 * (retainer-style work is reviewed month by month), otherwise All time (total budget,
 * no budget, or fixed fee — progress is measured against the life of the project).
 */
export function defaultPeriodFor(p: BudgetShape): Period {
  if (p.projectType !== 'fixed_fee' && p.budgetResetsMonthly && p.budgetMethod !== 'none') return 'month'
  return 'all'
}

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d))
export const ymd = (d: Date) => d.toISOString().slice(0, 10)

export function parseYmd(s: string | undefined | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return isNaN(d.getTime()) || ymd(d) !== s ? null : d
}

function addDays(d: Date, n: number): Date {
  return utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n)
}

function weekStart(d: Date, ws: WeekStart): Date {
  const day = d.getUTCDay() // 0=Sun
  const since = ws === 'sunday' ? day : (day + 6) % 7
  return addDays(d, -since)
}

/** [start, end) for a bounded period containing `anchor`. */
export function boundsFor(period: Exclude<Period, 'all' | 'custom'>, anchor: Date, ws: WeekStart = 'monday'): [Date, Date] {
  const y = anchor.getUTCFullYear()
  const m = anchor.getUTCMonth()
  switch (period) {
    case 'week': {
      const s = weekStart(anchor, ws)
      return [s, addDays(s, 7)]
    }
    case 'month':
      return [utc(y, m, 1), utc(y, m + 1, 1)]
    case 'quarter': {
      const q = Math.floor(m / 3) * 3
      return [utc(y, q, 1), utc(y, q + 3, 1)]
    }
    case 'year':
      return [utc(y, 0, 1), utc(y + 1, 0, 1)]
  }
}

/** Resolve URL params into a concrete timeframe. */
export function resolveTimeframe(
  params: TimeframeParams,
  opts: { now?: Date; weekStartsOn?: WeekStart; defaultPeriod?: Period } = {},
): Timeframe {
  const now = opts.now ?? new Date()
  const today = utc(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const ws = opts.weekStartsOn ?? 'monday'

  let period: Period | null = params.period && PERIOD_KEYS.has(params.period) ? (params.period as Period) : null
  let anchor = parseYmd(params.date)

  // Legacy ?month=YYYY-MM / ?month=M&year=YYYY / ?year=YYYY.
  if (!period) {
    const ym = /^(\d{4})-(\d{2})$/.exec(params.month ?? '')
    const mNum = /^\d{1,2}$/.test(params.month ?? '') ? Number(params.month) : NaN
    const yNum = /^\d{4}$/.test(params.year ?? '') ? Number(params.year) : NaN
    if (ym && Number(ym[2]) >= 1 && Number(ym[2]) <= 12) {
      period = 'month'
      anchor = utc(Number(ym[1]), Number(ym[2]) - 1, 1)
    } else if (mNum >= 1 && mNum <= 12) {
      period = 'month'
      anchor = utc(Number.isNaN(yNum) ? today.getUTCFullYear() : yNum, mNum - 1, 1)
    } else if (!Number.isNaN(yNum)) {
      period = 'year'
      anchor = utc(yNum, 0, 1)
    }
  }
  period = period ?? opts.defaultPeriod ?? 'all'

  if (period === 'all') return { period, start: null, end: null, anchor: ymd(today) }

  if (period === 'custom') {
    let from = parseYmd(params.from)
    let to = parseYmd(params.to)
    if (from && to && from > to) [from, to] = [to, from]
    return { period, start: from, end: to ? addDays(to, 1) : null, anchor: ymd(from ?? to ?? today) }
  }

  const a = anchor ?? today
  const [start, end] = boundsFor(period, a, ws)
  return { period, start, end, anchor: ymd(start) }
}

/** Anchor (YYYY-MM-DD) of the previous/next bounded period, or null for All time / Custom. */
export function shiftAnchor(tf: Timeframe, dir: -1 | 1, ws: WeekStart = 'monday'): string | null {
  if (tf.period === 'all' || tf.period === 'custom' || !tf.start) return null
  const s = tf.start
  const y = s.getUTCFullYear()
  const m = s.getUTCMonth()
  const next =
    tf.period === 'week' ? addDays(s, 7 * dir)
    : tf.period === 'month' ? utc(y, m + dir, 1)
    : tf.period === 'quarter' ? utc(y, m + 3 * dir, 1)
    : utc(y + dir, 0, 1)
  return ymd(boundsFor(tf.period, next, ws)[0])
}

/** URL params that reproduce this timeframe (merge into a page's query string). */
export function timeframeQuery(tf: Timeframe): Record<string, string> {
  if (tf.period === 'all') return { period: 'all' }
  if (tf.period === 'custom') {
    const q: Record<string, string> = { period: 'custom' }
    if (tf.start) q.from = ymd(tf.start)
    if (tf.end) q.to = ymd(addDays(tf.end, -1))
    return q
  }
  return { period: tf.period, date: tf.anchor }
}

const fmtDay = (d: Date, withYear = true) =>
  `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${withYear ? `, ${d.getUTCFullYear()}` : ''}`

/** Human label: "Oct 6 – 12, 2026", "Oct 2026", "Q4 2026", "2026", "All time", "Oct 1, 2026 – Oct 12, 2026". */
export function timeframeLabel(tf: Timeframe): string {
  const { start, end } = tf
  switch (tf.period) {
    case 'all':
      return 'All time'
    case 'month':
      return `${MONTHS[start!.getUTCMonth()]} ${start!.getUTCFullYear()}`
    case 'quarter':
      return `Q${Math.floor(start!.getUTCMonth() / 3) + 1} ${start!.getUTCFullYear()}`
    case 'year':
      return String(start!.getUTCFullYear())
    case 'week': {
      const last = addDays(end!, -1)
      if (start!.getUTCFullYear() !== last.getUTCFullYear()) return `${fmtDay(start!)} – ${fmtDay(last)}`
      if (start!.getUTCMonth() === last.getUTCMonth()) return `${fmtDay(start!, false)} – ${last.getUTCDate()}, ${last.getUTCFullYear()}`
      return `${fmtDay(start!, false)} – ${fmtDay(last)}`
    }
    case 'custom': {
      if (!start && !end) return 'All time'
      if (!end) return `Since ${fmtDay(start!)}`
      const last = addDays(end, -1)
      if (!start) return `Through ${fmtDay(last)}`
      return `${fmtDay(start)} – ${fmtDay(last)}`
    }
  }
}

/** Default from/to (inclusive) to prefill the custom picker from the current selection. */
export function customSeed(tf: Timeframe, now: Date = new Date()): { from: string; to: string } {
  const today = utc(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (tf.start && tf.end) return { from: ymd(tf.start), to: ymd(addDays(tf.end, -1)) }
  if (tf.start) return { from: ymd(tf.start), to: ymd(today) }
  return { from: ymd(utc(today.getUTCFullYear(), today.getUTCMonth(), 1)), to: ymd(today) }
}
