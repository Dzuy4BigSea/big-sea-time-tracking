/**
 * Generation-time rate check (specs/05, INV-2).
 *
 * A billable time-and-materials entry whose stored billableRateCents is null/0 would otherwise be
 * billed at $0. Before invoicing we re-derive its rate with the canonical resolveRate (as of the
 * entry's spentDate); if the rate is still missing, generation is blocked with a list of the
 * project / person / task combinations that need a rate. Rates are never typed in here.
 *
 * Pure + DB-free: the caller loads the lookups (task/user assignments, person rate history).
 */
import { resolveRate, type BillableRateMethod, type EffectiveRate } from '@/modules/projects/resolveRate'

export interface PoolEntryRateContext {
  id: string
  spentDate: Date
  billableRateCents: number | null
  projectId: string
  projectName: string
  projectType: 'time_and_materials' | 'fixed_fee' | 'non_billable'
  billableRateMethod: BillableRateMethod | null
  projectHourlyRateCents: number | null
  taskId: string
  taskName: string
  taskDefaultBillable: boolean
  taskDefaultHourlyRateCents: number | null
  userId: string
  userName: string
}

export interface RateLookups {
  /** key `${projectId}|${taskId}` */
  taskAssignments: Map<string, { billable: boolean | null; hourlyRateCents: number | null }>
  /** key `${projectId}|${userId}` */
  userAssignments: Map<string, { hourlyRateCents: number | null }>
  /** key userId */
  personRates: Map<string, EffectiveRate[]>
}

export interface MissingRate {
  projectName: string
  userName: string
  taskName: string
}

/** True when a pooled entry needs its rate re-derived before it can be billed. */
export function needsRate(e: Pick<PoolEntryRateContext, 'projectType' | 'billableRateCents'>): boolean {
  return e.projectType === 'time_and_materials' && (e.billableRateCents == null || e.billableRateCents <= 0)
}

/**
 * Re-derive rates for entries that need one. Returns the rates found (entry id → cents) and the
 * distinct project/person/task combinations that still have no rate.
 */
export function resolvePoolRates(
  entries: PoolEntryRateContext[],
  lookups: RateLookups,
): { resolved: Map<string, number>; missing: MissingRate[] } {
  const resolved = new Map<string, number>()
  const missing = new Map<string, MissingRate>()
  for (const e of entries) {
    if (!needsRate(e)) continue
    const r = resolveRate({
      spentDate: e.spentDate,
      project: { projectType: e.projectType, billableRateMethod: e.billableRateMethod, projectHourlyRateCents: e.projectHourlyRateCents },
      task: { defaultBillable: e.taskDefaultBillable, defaultHourlyRateCents: e.taskDefaultHourlyRateCents },
      taskAssignment: lookups.taskAssignments.get(`${e.projectId}|${e.taskId}`) ?? null,
      projectUserAssignment: lookups.userAssignments.get(`${e.projectId}|${e.userId}`) ?? null,
      personBillableRates: lookups.personRates.get(e.userId) ?? [],
    })
    if (r.billableRateCents != null && r.billableRateCents > 0) {
      resolved.set(e.id, r.billableRateCents)
    } else {
      const key = `${e.projectId}|${e.userId}|${e.taskId}`
      if (!missing.has(key)) missing.set(key, { projectName: e.projectName, userName: e.userName, taskName: e.taskName })
    }
  }
  return { resolved, missing: [...missing.values()] }
}

/** User-facing message listing the combinations without a rate (capped for readability). */
export function missingRatesMessage(missing: MissingRate[], max = 8): string {
  const shown = missing.slice(0, max).map((m) => `${m.projectName} / ${m.userName} / ${m.taskName}`)
  const more = missing.length > max ? ` (and ${missing.length - max} more)` : ''
  return `Can't generate: billable time has no hourly rate for ${shown.join('; ')}${more}. Set the rates on the project, then try again.`
}
