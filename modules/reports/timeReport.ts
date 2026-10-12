/**
 * Pure helpers for Reports > Time (app/reports/page.tsx). The page aggregates in the DB; these only
 * shape the small aggregated rows (one per client / project / task / person).
 */
import type { SortState } from './sort'

/** Group-by tab, named like Harvest's URL (`?tab=clients|projects|tasks|users`). */
export type TimeTab = 'clients' | 'projects' | 'tasks' | 'users'
export const TIME_TABS: readonly TimeTab[] = ['clients', 'projects', 'tasks', 'users']

/** Legacy `?group=` values (pre-Harvest naming) and their tab. `teammate` is linked from /team. */
const LEGACY_GROUPS: Record<string, TimeTab> = {
  clients: 'clients',
  client: 'clients',
  projects: 'projects',
  project: 'projects',
  tasks: 'tasks',
  task: 'tasks',
  teammates: 'users',
  teammate: 'users',
  users: 'users',
  user: 'users',
}

/** `?tab=` wins; the old `?group=` keeps working; default Clients. */
export function parseTimeTab(params: { tab?: string; group?: string }): TimeTab {
  if (params.tab && (TIME_TABS as readonly string[]).includes(params.tab)) return params.tab as TimeTab
  const legacy = params.group ? LEGACY_GROUPS[params.group] : undefined
  return legacy ?? 'clients'
}

export const TIME_SORT_KEYS = ['name', 'client', 'hours', 'billable', 'amount'] as const
export type TimeSortKey = (typeof TIME_SORT_KEYS)[number]

/** Harvest's default sort: Name A→Z, except Tasks which sorts by Hours (largest first). */
export function defaultTimeSort(tab: TimeTab): SortState<TimeSortKey> {
  return tab === 'tasks' ? { key: 'hours', dir: 'desc' } : { key: 'name', dir: 'asc' }
}

/** Whole-number share (0–100) of `part` in `whole`; 0 when there is nothing. */
export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

/** Hours with two decimals, Harvest-style ("1.30", "1,234.50"), from integer minutes. */
export function formatHours(minutes: number): string {
  return (minutes / 60).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Tooltip on the billable-share bar. */
export function billableShareTitle(billableMinutes: number, minutes: number): string {
  const b = pct(billableMinutes, minutes)
  return `Billable hours: ${b}% / Non-billable hours: ${minutes > 0 ? 100 - b : 0}%`
}

export interface TimeTotals {
  minutes: number
  billableMinutes: number
  billableCents: number
  uninvoicedCents: number
}

export function sumTotals(rows: readonly TimeTotals[]): TimeTotals {
  return rows.reduce<TimeTotals>(
    (a, r) => ({
      minutes: a.minutes + r.minutes,
      billableMinutes: a.billableMinutes + r.billableMinutes,
      billableCents: a.billableCents + r.billableCents,
      uninvoicedCents: a.uninvoicedCents + r.uninvoicedCents,
    }),
    { minutes: 0, billableMinutes: 0, billableCents: 0, uninvoicedCents: 0 },
  )
}

export type PersonType = 'employee' | 'contractor'

/**
 * Teammates tab: split (already sorted) rows into Employees then Contractors, each with a subtotal.
 * Empty sections are dropped; row order within a section is preserved.
 */
export function splitByPersonType<T extends TimeTotals & { personType?: string | null }>(
  rows: readonly T[],
): { type: PersonType; label: string; rows: T[]; totals: TimeTotals }[] {
  const sections: { type: PersonType; label: string }[] = [
    { type: 'employee', label: 'Employees' },
    { type: 'contractor', label: 'Contractors' },
  ]
  return sections
    .map((s) => {
      const these = rows.filter((r) => (r.personType === 'contractor' ? 'contractor' : 'employee') === s.type)
      return { ...s, rows: these, totals: sumTotals(these) }
    })
    .filter((s) => s.rows.length > 0)
}
