/**
 * Rate resolution — the canonical billing algorithm (specs/03-clients-projects-tasks.md).
 *
 * Pure function over plain inputs (no DB access) so it is trivially unit-testable and
 * is the single reference for invariant INV-2 ("billable rate is derived, not typed").
 * A thin repository adapter fetches the rows and calls this; business logic lives ONLY here.
 *
 * Two levels:
 *   1. projectType: time_and_materials | fixed_fee | non_billable
 *   2. billableRateMethod (T&M only): none | project | person | task
 * Rates are effective-dated: the row whose [startDate, endDate] contains the entry's
 * spentDate wins. Per-project overrides beat the person/task defaults.
 */

export type ProjectType = 'time_and_materials' | 'fixed_fee' | 'non_billable'
export type BillableRateMethod = 'none' | 'project' | 'person' | 'task'

/** An effective-dated rate row. null bound = open-ended. */
export interface EffectiveRate {
  hourlyRateCents: number
  startDate: Date | null
  endDate: Date | null
}

export interface RateResolutionInput {
  /** The day the work is attributed to; drives effective-dated lookups. */
  spentDate: Date
  project: {
    projectType: ProjectType
    billableRateMethod: BillableRateMethod | null
    projectHourlyRateCents: number | null
  }
  task: {
    defaultBillable: boolean
    defaultHourlyRateCents: number | null
  }
  /** The project's assignment for this task (per-project overrides), if any. */
  taskAssignment?: {
    billable: boolean | null
    hourlyRateCents: number | null
  } | null
  /** The project's assignment for this user (per-project person-rate override), if any. */
  projectUserAssignment?: {
    hourlyRateCents: number | null
  } | null
  /** The user's effective-dated billable-rate history (for the `person` method). */
  personBillableRates?: EffectiveRate[]
}

export interface RateResolution {
  isBillable: boolean
  /** null when non-billable or when a billable method has no rate set. */
  billableRateCents: number | null
  /** true when the entry is billable but no rate could be resolved — must be fixed before invoicing. */
  rateMissing: boolean
}

/** Whole-day containment: does [startDate, endDate] (null = open) contain `date`? */
function coversDate(rate: EffectiveRate, date: Date): boolean {
  const t = date.getTime()
  if (rate.startDate != null && t < rate.startDate.getTime()) return false
  if (rate.endDate != null && t > rate.endDate.getTime()) return false
  return true
}

/** The rate in force on `date`, or null if none. Assumes non-overlapping ranges (enforced in DB). */
export function effectiveRate(rates: EffectiveRate[] | undefined, date: Date): number | null {
  if (!rates) return null
  const hit = rates.find((r) => coversDate(r, date))
  return hit ? hit.hourlyRateCents : null
}

/** Resolve isBillable + billableRateCents for a time entry. See specs/03 §Rate resolution. */
export function resolveRate(input: RateResolutionInput): RateResolution {
  const { project, task, taskAssignment, projectUserAssignment, personBillableRates, spentDate } = input

  // ---- Step 1: billable? ----
  let isBillable: boolean
  if (project.projectType === 'non_billable') {
    isBillable = false
  } else if (taskAssignment && taskAssignment.billable != null) {
    isBillable = taskAssignment.billable
  } else {
    isBillable = task.defaultBillable
  }

  if (!isBillable) {
    return { isBillable: false, billableRateCents: null, rateMissing: false }
  }

  // ---- Step 2: rate (billable only) ----
  // Fixed-fee entries carry no per-hour rate; the project fee is invoiced directly.
  if (project.projectType === 'fixed_fee') {
    return { isBillable: true, billableRateCents: 0, rateMissing: false }
  }

  // time_and_materials, by billableRateMethod. `null` is treated as `none`.
  let rate: number | null
  switch (project.billableRateMethod ?? 'none') {
    case 'none':
      rate = null
      break
    case 'project':
      rate = project.projectHourlyRateCents ?? null
      break
    case 'person':
      // per-project override wins, else the person's effective-dated default.
      rate = projectUserAssignment?.hourlyRateCents ?? effectiveRate(personBillableRates, spentDate)
      break
    case 'task':
      // per-project task-rate override wins, else the global task default.
      rate = taskAssignment?.hourlyRateCents ?? task.defaultHourlyRateCents ?? null
      break
    default:
      rate = null
  }

  return {
    isBillable: true,
    billableRateCents: rate,
    rateMissing: rate == null,
  }
}
