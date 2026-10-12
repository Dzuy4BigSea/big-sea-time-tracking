import { startOfWeek, addDays, ymd, parseYmd } from '@/lib/week'

/**
 * Report timeframe (Harvest-style "Week / Month / Quarter / Year / All time / Custom").
 * Shared by every report screen so the picker and the date filter behave the same everywhere.
 * URL params: `period`, plus `anchor` (any day inside the period) or `from`/`to` for custom.
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

export type TimeframeParams = { period?: string; anchor?: string; from?: string; to?: string }

export type Timeframe = {
  period: Period
  /** Inclusive UTC-midnight bounds; null = open-ended. */
  from: Date | null
  till: Date | null
  label: string
  /** YYYY-MM-DD anchor for anchored periods (week/month/quarter/year), else null. */
  anchor: string | null
  prevAnchor: string | null
  nextAnchor: string | null
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const md = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
const mdy = (d: Date) => `${md(d)}/${d.getUTCFullYear()}`

const isAnchored = (p: Period) => p === 'week' || p === 'month' || p === 'quarter' || p === 'year'

export function parsePeriod(s: string | undefined, fallback: Period = 'all'): Period {
  return PERIODS.some((p) => p.key === s) ? (s as Period) : fallback
}

/** True when the page must supply a fallback anchor (anchored period with no valid `anchor` param). */
export function needsFallbackAnchor(params: TimeframeParams, defaultPeriod: Period = 'all'): boolean {
  return isAnchored(parsePeriod(params.period, defaultPeriod)) && !parseYmd(params.anchor)
}

/**
 * Resolve URL params into an inclusive [from, till] range. `fallbackAnchor` is used when an anchored
 * period has no anchor (pages pass the latest day with data, so the default view isn't empty).
 */
export function resolveTimeframe(
  params: TimeframeParams,
  opts: { defaultPeriod?: Period; fallbackAnchor?: Date | null; weekStartsOn?: 'monday' | 'sunday' } = {},
): Timeframe {
  const period = parsePeriod(params.period, opts.defaultPeriod ?? 'all')

  if (period === 'custom') {
    let from = parseYmd(params.from)
    let till = parseYmd(params.to)
    if (!from && !till) return allTime()
    if (from && till && from > till) [from, till] = [till, from]
    const label = from && till ? `${mdy(from)} – ${mdy(till)}` : from ? `Since ${mdy(from)}` : `Through ${mdy(till!)}`
    return { period, from, till, label, anchor: null, prevAnchor: null, nextAnchor: null }
  }

  if (!isAnchored(period)) return allTime()

  const a = parseYmd(params.anchor) ?? opts.fallbackAnchor ?? new Date()
  const y = a.getUTCFullYear()
  const m = a.getUTCMonth()
  let from: Date
  let till: Date
  let label: string
  let prev: Date
  let next: Date
  if (period === 'week') {
    from = startOfWeek(a, opts.weekStartsOn ?? 'monday') // account preference, like the timesheet
    till = addDays(from, 6)
    label = `${md(from)} – ${md(till)} ${till.getUTCFullYear()}`
    prev = addDays(from, -7)
    next = addDays(from, 7)
  } else if (period === 'month') {
    from = new Date(Date.UTC(y, m, 1))
    till = new Date(Date.UTC(y, m + 1, 0))
    label = `${MONTHS[m]} ${y}`
    prev = new Date(Date.UTC(y, m - 1, 1))
    next = new Date(Date.UTC(y, m + 1, 1))
  } else if (period === 'quarter') {
    const q = Math.floor(m / 3)
    from = new Date(Date.UTC(y, q * 3, 1))
    till = new Date(Date.UTC(y, q * 3 + 3, 0))
    label = `Q${q + 1} ${y}`
    prev = new Date(Date.UTC(y, q * 3 - 3, 1))
    next = new Date(Date.UTC(y, q * 3 + 3, 1))
  } else {
    from = new Date(Date.UTC(y, 0, 1))
    till = new Date(Date.UTC(y, 11, 31))
    label = String(y)
    prev = new Date(Date.UTC(y - 1, 0, 1))
    next = new Date(Date.UTC(y + 1, 0, 1))
  }
  return { period, from, till, label, anchor: ymd(from), prevAnchor: ymd(prev), nextAnchor: ymd(next) }
}

function allTime(): Timeframe {
  return { period: 'all', from: null, till: null, label: 'All time', anchor: null, prevAnchor: null, nextAnchor: null }
}

/** True when `d` falls inside the timeframe (inclusive). */
export function inTimeframe(tf: Pick<Timeframe, 'from' | 'till'>, d: Date): boolean {
  return (!tf.from || d >= tf.from) && (!tf.till || d <= tf.till)
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

/** Build `path?query`, dropping empty values. */
export function buildHref(path: string, params: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `${path}?${s}` : path
}
