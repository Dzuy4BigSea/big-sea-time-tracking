import { startOfWeek, addDays, ymd, parseYmd } from '@/lib/week'

/**
 * Timeframe selection (Harvest-style "Week / Semimonth / Month / Quarter / Year / All time / Custom"),
 * shared by every report screen and the project detail page so the picker (components/ReportTimeframe.tsx)
 * and the date filter behave the same everywhere.
 *
 * URL params:
 *   - `period`
 *   - `anchor=YYYY-MM-DD`: any day inside an anchored period (week/semimonth/month/quarter/year).
 *     `date=` is accepted as an alias (older project-page links).
 *   - `from` / `to` (both inclusive, either may be blank = open-ended) for custom.
 *   - Legacy project links with no `period`: `?month=YYYY-MM`, `?month=M&year=YYYY` → Month;
 *     a bare `?year=YYYY` → Year.
 *
 * All dates are UTC midnight. `from`/`till` are inclusive; use `endExclusive` for `col < end` SQL.
 */
export type Period = 'week' | 'semimonth' | 'month' | 'quarter' | 'year' | 'all' | 'custom'
export type WeekStart = 'monday' | 'sunday'

export const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'semimonth', label: 'Semimonth' },
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
]

export type TimeframeParams = {
  period?: string
  anchor?: string
  /** Alias of `anchor` (old project-page links). */
  date?: string
  from?: string
  to?: string
  /** Legacy project-page params, honored only when `period` is absent/invalid. */
  month?: string
  year?: string
}

export type Timeframe = {
  period: Period
  /** Inclusive UTC-midnight bounds; null = open-ended. */
  from: Date | null
  till: Date | null
  label: string
  /** YYYY-MM-DD start of an anchored period, else null. */
  anchor: string | null
  prevAnchor: string | null
  nextAnchor: string | null
}

export type ResolveOptions = {
  /** Period used when the URL has none (and no legacy params). Default 'all'. */
  defaultPeriod?: Period
  /** Anchor used when an anchored period has none (report pages pass the latest day with data). */
  fallbackAnchor?: Date | null
  weekStartsOn?: WeekStart
  /** "Today" (tests); defaults to the current time. */
  now?: Date
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const md = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
const mdy = (d: Date) => `${md(d)}/${d.getUTCFullYear()}`
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d))
const dayOf = (d: Date) => utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

type Anchored = Exclude<Period, 'all' | 'custom'>
const isAnchored = (p: Period): p is Anchored => p !== 'all' && p !== 'custom'

export function parsePeriod(s: string | undefined, fallback: Period = 'all'): Period {
  return PERIODS.some((p) => p.key === s) ? (s as Period) : fallback
}

/** Period + anchor from the URL, including the `date` alias and legacy month/year links (null = not given). */
function readParams(params: TimeframeParams, now: Date): { period: Period | null; anchor: Date | null } {
  const explicit = PERIODS.some((p) => p.key === params.period) ? (params.period as Period) : null
  const anchor = parseYmd(params.anchor) ?? parseYmd(params.date)
  if (explicit) return { period: explicit, anchor }

  const ym = /^(\d{4})-(\d{2})$/.exec(params.month ?? '')
  const mNum = /^\d{1,2}$/.test(params.month ?? '') ? Number(params.month) : NaN
  const yNum = /^\d{4}$/.test(params.year ?? '') ? Number(params.year) : NaN
  if (ym && Number(ym[2]) >= 1 && Number(ym[2]) <= 12) return { period: 'month', anchor: utc(Number(ym[1]), Number(ym[2]) - 1, 1) }
  if (mNum >= 1 && mNum <= 12) return { period: 'month', anchor: utc(Number.isNaN(yNum) ? now.getUTCFullYear() : yNum, mNum - 1, 1) }
  if (!Number.isNaN(yNum)) return { period: 'year', anchor: utc(yNum, 0, 1) }
  return { period: null, anchor }
}

/** True when the page must supply a fallback anchor (anchored period with no usable anchor in the URL). */
export function needsFallbackAnchor(params: TimeframeParams, defaultPeriod: Period = 'all'): boolean {
  const { period, anchor } = readParams(params, new Date())
  return isAnchored(period ?? defaultPeriod) && !anchor
}

/** Inclusive [from, till] of the anchored period containing `a`, with its label. */
export function boundsFor(period: Anchored, a: Date, weekStartsOn: WeekStart = 'monday'): { from: Date; till: Date; label: string } {
  const y = a.getUTCFullYear()
  const m = a.getUTCMonth()
  switch (period) {
    case 'week': {
      const from = startOfWeek(a, weekStartsOn) // account preference, like the timesheet
      const till = addDays(from, 6)
      return { from, till, label: `${md(from)} – ${md(till)} ${till.getUTCFullYear()}` }
    }
    case 'semimonth': {
      // Harvest: the 1st–15th, then the 16th–last day of the month.
      const first = a.getUTCDate() <= 15
      const from = utc(y, m, first ? 1 : 16)
      const till = first ? utc(y, m, 15) : utc(y, m + 1, 0)
      return { from, till, label: `${md(from)} – ${md(till)} ${y}` }
    }
    case 'month':
      return { from: utc(y, m, 1), till: utc(y, m + 1, 0), label: `${MONTHS[m]} ${y}` }
    case 'quarter': {
      const q = Math.floor(m / 3)
      return { from: utc(y, q * 3, 1), till: utc(y, q * 3 + 3, 0), label: `Q${q + 1} ${y}` }
    }
    case 'year':
      return { from: utc(y, 0, 1), till: utc(y, 11, 31), label: String(y) }
  }
}

/** Start of the period before (-1) or after (+1) the anchored period starting at `from`. */
function stepFrom(period: Anchored, from: Date, dir: -1 | 1): Date {
  const y = from.getUTCFullYear()
  const m = from.getUTCMonth()
  switch (period) {
    case 'week':
      return addDays(from, 7 * dir)
    case 'semimonth':
      // Halves alternate: 1st ↔ 16th, crossing a month boundary every other step.
      if (from.getUTCDate() === 1) return dir < 0 ? utc(y, m - 1, 16) : utc(y, m, 16)
      return dir < 0 ? utc(y, m, 1) : utc(y, m + 1, 1)
    case 'month':
      return utc(y, m + dir, 1)
    case 'quarter':
      return utc(y, m + 3 * dir, 1)
    case 'year':
      return utc(y + dir, 0, 1)
  }
}

/**
 * Resolve URL params into an inclusive [from, till] range. An anchored period with no anchor uses
 * `fallbackAnchor`, else today.
 */
export function resolveTimeframe(params: TimeframeParams, opts: ResolveOptions = {}): Timeframe {
  const now = opts.now ?? new Date()
  const read = readParams(params, now)
  const period = read.period ?? opts.defaultPeriod ?? 'all'

  if (period === 'custom') {
    let from = parseYmd(params.from)
    let till = parseYmd(params.to)
    if (!from && !till) return allTime()
    if (from && till && from > till) [from, till] = [till, from]
    const label = from && till ? `${mdy(from)} – ${mdy(till)}` : from ? `Since ${mdy(from)}` : `Through ${mdy(till!)}`
    return { period, from, till, label, anchor: null, prevAnchor: null, nextAnchor: null }
  }

  if (!isAnchored(period)) return allTime()

  const a = read.anchor ?? opts.fallbackAnchor ?? dayOf(now)
  const ws = opts.weekStartsOn ?? 'monday'
  const { from, till, label } = boundsFor(period, a, ws)
  return { period, from, till, label, anchor: ymd(from), prevAnchor: ymd(stepFrom(period, from, -1)), nextAnchor: ymd(stepFrom(period, from, 1)) }
}

function allTime(): Timeframe {
  return { period: 'all', from: null, till: null, label: 'All time', anchor: null, prevAnchor: null, nextAnchor: null }
}

/** Exclusive end (the day after `till`) for `col < end` comparisons on timestamps; null when open-ended. */
export function endExclusive(tf: Pick<Timeframe, 'till'>): Date | null {
  return tf.till ? addDays(tf.till, 1) : null
}

/** True when `d` falls inside the timeframe (inclusive). */
export function inTimeframe(tf: Pick<Timeframe, 'from' | 'till'>, d: Date): boolean {
  return (!tf.from || d >= tf.from) && (!tf.till || d <= tf.till)
}

/**
 * Table-toolbar heading for a timeframe, Harvest-style: "This Month: October 2026" when the anchored
 * period contains today, else the plain period label ("September 2026"); "All time" / the custom
 * range label otherwise.
 */
export function periodHeading(tf: Timeframe, now: Date = new Date()): string {
  if (!isAnchored(tf.period)) return tf.label
  const p = PERIODS.find((x) => x.key === tf.period)!
  return inTimeframe(tf, dayOf(now)) ? `This ${p.label}: ${tf.label}` : tf.label
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dMon = (d: Date) => `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`

/** "12 – 18 Oct 2026", "28 Sep – 4 Oct 2026", "29 Dec 2025 – 4 Jan 2026" (Harvest's range style). */
export function dayRangeLabel(from: Date, till: Date): string {
  const y1 = from.getUTCFullYear()
  const y2 = till.getUTCFullYear()
  if (y1 !== y2) return `${dMon(from)} ${y1} – ${dMon(till)} ${y2}`
  if (from.getUTCMonth() !== till.getUTCMonth()) return `${dMon(from)} – ${dMon(till)} ${y2}`
  return `${from.getUTCDate()} – ${dMon(till)} ${y2}`
}

/**
 * Report period-stepper label, Harvest-style: `prefix` is "This week" / "This month" / … when the
 * anchored period contains today (else null); `range` is "12 – 18 Oct 2026" for week/semimonth and
 * the period label ("October 2026", "Q4 2026", "2026") otherwise.
 */
export function stepperLabel(tf: Timeframe, now: Date = new Date()): { prefix: string | null; range: string } {
  if (!isAnchored(tf.period) || !tf.from || !tf.till) return { prefix: null, range: tf.label }
  const range = tf.period === 'week' || tf.period === 'semimonth' ? dayRangeLabel(tf.from, tf.till) : tf.label
  const p = PERIODS.find((x) => x.key === tf.period)!
  return { prefix: inTimeframe(tf, dayOf(now)) ? `This ${p.label.toLowerCase()}` : null, range }
}

/** URL params that reproduce this timeframe (so links, tabs and exports keep it). */
export function timeframeQuery(tf: Timeframe): Record<string, string> {
  if (tf.period === 'custom') {
    const q: Record<string, string> = { period: 'custom' }
    if (tf.from) q.from = ymd(tf.from)
    if (tf.till) q.to = ymd(tf.till)
    return q
  }
  if (tf.period === 'all') return { period: 'all' }
  return { period: tf.period, anchor: tf.anchor! }
}

/** Default from/to (inclusive) to prefill the custom picker from the current selection. */
export function customSeed(tf: Pick<Timeframe, 'from' | 'till'>, now: Date = new Date()): { from: string; to: string } {
  const today = dayOf(now)
  if (tf.from && tf.till) return { from: ymd(tf.from), to: ymd(tf.till) }
  if (tf.from) return { from: ymd(tf.from), to: ymd(today) }
  if (tf.till) return { from: ymd(utc(tf.till.getUTCFullYear(), tf.till.getUTCMonth(), 1)), to: ymd(tf.till) }
  return { from: ymd(utc(today.getUTCFullYear(), today.getUTCMonth(), 1)), to: ymd(today) }
}

/** Build `path?query`, dropping empty values. */
export function buildHref(path: string, params: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `${path}?${s}` : path
}

/* ---------- Project detail page ---------- */

export interface BudgetShape {
  projectType: string
  budgetMethod: string
  budgetResetsMonthly: boolean
}

/**
 * Default timeframe for a project page: Month when it has a budget that resets monthly
 * (retainer-style work is reviewed month by month), otherwise All time (total budget,
 * no budget, or fixed fee — progress is measured against the life of the project).
 */
export function defaultPeriodFor(p: BudgetShape): Period {
  if (p.projectType !== 'fixed_fee' && p.budgetResetsMonthly && p.budgetMethod !== 'none') return 'month'
  return 'all'
}
