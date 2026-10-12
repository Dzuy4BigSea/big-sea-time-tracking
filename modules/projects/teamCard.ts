/**
 * Pure helpers for the Edit project Team card (components/ProjectTeamManager.tsx). Displayed rates
 * are derived with resolveRate's `effectiveRate` (INV-2), never typed in.
 */
import { effectiveRate, type EffectiveRate } from './resolveRate'

/** Person billable rates only apply to Time & Materials projects using the `person` method. */
export function usesPersonRates(projectType: string, rateMethod: string | null): boolean {
  return projectType === 'time_and_materials' && rateMethod === 'person'
}

/** Two-letter initials for the avatar circle ("Ada Lovelace" → "AL"). */
export function initialsOf(firstName: string, lastName: string): string {
  return `${firstName.trim().charAt(0)}${lastName.trim().charAt(0)}`.toUpperCase() || '?'
}

export type RateCell =
  | { kind: 'custom'; cents: number }
  | { kind: 'default'; cents: number }
  | { kind: 'missing' }

/**
 * What the Team card's rate cell shows for one person: the per-project override ("custom"), else
 * the person's default in force on `on`, else "Missing rate". Mirrors resolveRate's person step.
 */
export function rateCell(overrideCents: number | null, defaults: EffectiveRate[] | undefined, on: Date): RateCell {
  if (overrideCents != null) return { kind: 'custom', cents: overrideCents }
  const d = effectiveRate(defaults, on)
  return d != null ? { kind: 'default', cents: d } : { kind: 'missing' }
}

/** Group effective-dated rate rows by user id. */
export function ratesByUser<T extends EffectiveRate & { userId: string }>(rows: readonly T[]): Map<string, EffectiveRate[]> {
  const m = new Map<string, EffectiveRate[]>()
  for (const r of rows) {
    const list = m.get(r.userId) ?? []
    list.push({ hourlyRateCents: r.hourlyRateCents, startDate: r.startDate, endDate: r.endDate })
    m.set(r.userId, list)
  }
  return m
}
