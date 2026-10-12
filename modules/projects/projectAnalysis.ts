/**
 * Pure helpers for the project analysis page (/projects/[id]), Harvest-style (specs/24 §4).
 * The page aggregates in the DB; these functions only shape the (small) aggregated rows.
 * Money is integer cents (INV-1); durations are integer minutes.
 */

export const PROJECT_TYPE_LABEL: Record<string, string> = {
  time_and_materials: 'Time & Materials',
  fixed_fee: 'Fixed Fee',
  non_billable: 'Non-Billable',
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86_400_000
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

/** "01 Jan 2026" (UTC; project dates are DATE columns). */
export function formatDayMonYear(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Whole weeks from today until the end date (0 once it has passed). */
export function weeksLeft(endsOn: Date, now: Date): number {
  const days = (utcDay(endsOn) - utcDay(now)) / DAY_MS
  return days <= 0 ? 0 : Math.floor(days / 7)
}

/**
 * Header date line: "01 Jan 2026 - 31 Dec 2026 (11 weeks left)". Null when the project has no dates.
 * The "(n weeks left)" suffix only shows while the end date is still ahead.
 */
export function projectDateRange(startsOn: Date | null, endsOn: Date | null, now: Date): string | null {
  if (!startsOn && !endsOn) return null
  const left = endsOn && utcDay(endsOn) >= utcDay(now) ? ` (${plural(weeksLeft(endsOn, now), 'week')} left)` : ''
  if (startsOn && endsOn) return `${formatDayMonYear(startsOn)} - ${formatDayMonYear(endsOn)}${left}`
  if (startsOn) return `Starts ${formatDayMonYear(startsOn)}`
  return `Ends ${formatDayMonYear(endsOn!)}${left}`
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export interface BudgetInput {
  budgetMethod: string
  budgetValue: number | null
}

export type BudgetSummary = {
  /** 'hours' → values are minutes; 'money' → values are cents. */
  unit: 'hours' | 'money'
  budget: number
  spent: number
  /** May be negative when over budget. */
  remaining: number
  /** 0–100, clamped. */
  pctRemaining: number
  pctSpent: number
  over: boolean
}

/**
 * Budget card numbers. Hours budgets (total / per task / per person; the stored value is the
 * project-wide total in minutes) compare against tracked minutes; a fee budget compares against
 * the billable amount. Cost budgets are left out: internal time costs aren't computed yet, so the
 * numbers would mislead. Null when the project has no usable budget.
 */
export function budgetSummary(p: BudgetInput, spent: { minutes: number; billableCents: number }): BudgetSummary | null {
  if (!p.budgetValue || p.budgetValue <= 0) return null
  let unit: BudgetSummary['unit']
  let used: number
  if (p.budgetMethod === 'hours_total' || p.budgetMethod === 'hours_per_task' || p.budgetMethod === 'hours_per_person') {
    unit = 'hours'
    used = spent.minutes
  } else if (p.budgetMethod === 'fee_total') {
    unit = 'money'
    used = spent.billableCents
  } else {
    return null
  }
  const budget = p.budgetValue
  const remaining = budget - used
  const pctSpent = Math.min(100, Math.max(0, Math.round((used / budget) * 100)))
  const pctRemaining = Math.min(100, Math.max(0, Math.round((remaining / budget) * 100)))
  return { unit, budget, spent: used, remaining, pctRemaining, pctSpent, over: used > budget }
}

export interface RateInput {
  projectType: string
  billableRateMethod: string | null
  projectHourlyRateCents: number | null
}

/**
 * Harvest's "This project's billable rates were never set." A time-and-materials project whose
 * rate method is unset / "No billable rate", or "Project billable rate" with no rate, or that
 * has billable time with no resolved rate.
 */
export function billableRatesMissing(p: RateInput, billableMinutesWithoutRate: number): boolean {
  if (p.projectType !== 'time_and_materials') return false
  if (!p.billableRateMethod || p.billableRateMethod === 'none') return true
  if (p.billableRateMethod === 'project' && !p.projectHourlyRateCents) return true
  return billableMinutesWithoutRate > 0
}

/** "Jane Q. Doe" → "JD"; one name → its first two letters. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** One (task × person) aggregate row from the page's single grouped query. */
export type TaskPersonCell = {
  taskId: string
  taskName: string
  userId: string
  userName: string
  minutes: number
  billableMinutes: number
  billableCents: number
}

export type Metrics = { minutes: number; billableMinutes: number; billableCents: number }
export type Rollup = Metrics & { id: string; name: string; children: (Metrics & { id: string; name: string })[] }

/**
 * Roll the task×person cells up into one row per `by` (task or person), each holding its
 * children on the other axis — the Tasks table (task → people) and Team table (person → tasks)
 * both come from the same grouped query, no per-row queries.
 */
export function rollup(cells: readonly TaskPersonCell[], by: 'task' | 'person'): Rollup[] {
  const out = new Map<string, Rollup>()
  for (const c of cells) {
    const id = by === 'task' ? c.taskId : c.userId
    const name = by === 'task' ? c.taskName : c.userName
    const r = out.get(id) ?? { id, name, minutes: 0, billableMinutes: 0, billableCents: 0, children: [] }
    r.minutes += c.minutes
    r.billableMinutes += c.billableMinutes
    r.billableCents += c.billableCents
    r.children.push({
      id: by === 'task' ? c.userId : c.taskId,
      name: by === 'task' ? c.userName : c.taskName,
      minutes: c.minutes,
      billableMinutes: c.billableMinutes,
      billableCents: c.billableCents,
    })
    out.set(id, r)
  }
  return Array.from(out.values())
}

/**
 * Harvest splits the Tasks table into "Billable tasks" and "Non-billable tasks". A task is
 * billable when the project's task assignment says so (any time on a non-billable project is
 * non-billable); a task no longer assigned falls back to whether any of its time was billable.
 */
export function isBillableTask(
  projectType: string,
  assignmentBillable: boolean | null | undefined,
  billableMinutes: number,
): boolean {
  if (projectType === 'non_billable') return false
  if (assignmentBillable != null) return assignmentBillable
  return billableMinutes > 0
}

/** Pre-tax amount of an invoice: subtotal less discount (tax excluded). */
export function preTaxCents(inv: { subtotalCents: number; discountCents: number }): number {
  return inv.subtotalCents - inv.discountCents
}
