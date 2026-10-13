/**
 * Pure math for the project analysis chart (BugHerd #25, Harvest "Project progress" parity):
 * the cumulative spent series against a budget line, remaining / over-budget amounts and the
 * y-axis scale. Values are in the budget's unit: minutes for hours budgets, cents for fee
 * budgets (INV-1: money stays integer cents until display).
 */

export type BudgetUnit = 'hours' | 'money'

export type SeriesPoint = {
  /** Spent in this bucket. */
  spent: number
  /** Running total at the end of this bucket (prior spend included). For a budget that resets
   * each period this is just the bucket's own spend. */
  cumulative: number
  /** budget − cumulative; negative when over. Null without a budget. */
  remaining: number | null
  /** True once the running total exceeds the budget. */
  over: boolean
  /** Bucket lies after the last plotted bucket (e.g. a future month): no progress point. */
  future: boolean
}

/**
 * Builds the progress series.
 * - `prior`: spend before the first bucket (all-time budgets count it; ignored when the budget resets).
 * - `resetsEachPeriod`: monthly-reset budgets measure each bucket on its own against the budget.
 * - `lastIndex`: last bucket that is not in the future (−1 = all future). Defaults to the last bucket.
 */
export function budgetSeries(
  spent: number[],
  opts: { budget: number | null; prior?: number; resetsEachPeriod?: boolean; lastIndex?: number },
): SeriesPoint[] {
  const { budget, resetsEachPeriod = false } = opts
  const lastIndex = opts.lastIndex ?? spent.length - 1
  let running = resetsEachPeriod ? 0 : opts.prior ?? 0
  return spent.map((s, i) => {
    running = resetsEachPeriod ? s : running + s
    const remaining = budget != null && budget > 0 ? budget - running : null
    return { spent: s, cumulative: running, remaining, over: remaining != null && remaining < 0, future: i > lastIndex }
  })
}

/** Round up to a "nice" axis maximum (1/2/2.5/5/10 × 10ⁿ) so gridline labels read cleanly. */
export function niceCeil(n: number): number {
  if (n <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(n)))
  const f = n / pow
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nf * pow
}

/** Raw units per display unit: minutes per hour, cents per dollar. */
export const UNIT_DIVISOR: Record<BudgetUnit, number> = { hours: 60, money: 100 }

/**
 * Y-axis scale in raw units: a nice maximum (in hours / dollars) that covers every value AND the
 * budget line, plus a tick count that divides it into round steps (2.5 and 5 split in fives).
 */
export function chartScale(values: number[], budget: number | null, unit: BudgetUnit): { max: number; ticks: number } {
  const div = UNIT_DIVISOR[unit]
  const raw = Math.max(0, ...values, budget ?? 0) / div
  const nice = niceCeil(raw)
  const lead = nice / Math.pow(10, Math.floor(Math.log10(nice)))
  const ticks = lead === 2.5 || lead === 5 ? 5 : 4
  return { max: nice * div, ticks }
}

/** Hours (from minutes) with two decimals, as Harvest shows them. */
export const fmtHours = (minutes: number) =>
  (minutes / 60).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** A value in the budget's unit, e.g. "80.00 hours" or "$1,250.00". */
export function fmtAmount(v: number, unit: BudgetUnit): string {
  if (unit === 'money') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v / 100)
  return `${fmtHours(v)} hours`
}

/** Short axis label: "20h" / "12.5h" or "$500" / "$2.5k". */
export function fmtTick(v: number, unit: BudgetUnit): string {
  const n = v / UNIT_DIVISOR[unit]
  const short = (x: number) => String(Math.round(x * 100) / 100)
  if (unit === 'hours') return `${short(n)}h`
  return n >= 1000 ? `$${short(n / 1000)}k` : `$${short(n)}`
}

/** "Remaining: 15.50 hours" or "Over budget by 4.00 hours". */
export function remainingText(remaining: number, unit: BudgetUnit): string {
  return remaining < 0 ? `Over budget by ${fmtAmount(-remaining, unit)}` : `Remaining: ${fmtAmount(remaining, unit)}`
}
