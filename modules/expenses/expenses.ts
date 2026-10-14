/**
 * Expense business rules (specs/09, specs/26). Pure: no Prisma, no React. Money is integer cents (INV-1).
 */
import { startOfWeek, addDays } from '@/lib/week'

export type WeekStart = 'monday' | 'sunday'

/** "$1,234.50" / "1234.5" / "42" → cents; null for empty, non-numeric, zero or negative. */
export function parseMoneyCents(raw: unknown): number | null {
  const s = String(raw ?? '').replace(/[$,\s]/g, '')
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') return null
  const [whole, frac = ''] = s.split('.')
  // Integer math on the digits: 0.29 must be 29 cents, never 28.999…
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2)) + (Number(frac[2] ?? '0') >= 5 ? 1 : 0)
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}

/** A quantity like "100", "12.5", "0.25" → hundredths of a unit (integer); null when not a positive number. */
export function parseQuantityHundredths(raw: unknown): number | null {
  const s = String(raw ?? '').replace(/[,\s]/g, '')
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') return null
  const [whole, frac = ''] = s.split('.')
  const h = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2)) + (Number(frac[2] ?? '0') >= 5 ? 1 : 0)
  return Number.isSafeInteger(h) && h > 0 ? h : null
}

/** Total for `hundredths/100` units at `unitPriceCents`, rounded half-up to whole cents (AC-EXP-116). */
export function unitTotalCents(hundredths: number, unitPriceCents: number): number {
  return Math.floor((hundredths * unitPriceCents + 50) / 100)
}

export interface CategoryPricing {
  unitName: string | null
  unitPriceCents: number | null
}

/** Harvest: a category "has a unit price" when both a price and (optionally) a unit name are set. */
export const isUnitBased = (c: CategoryPricing): c is { unitName: string | null; unitPriceCents: number } =>
  c.unitPriceCents != null && c.unitPriceCents > 0

/**
 * The expense total from the form: a quantity for a unit-priced category (Mileage: 100 miles × $0.55),
 * otherwise a money amount. Returns an error message instead of a total when the input is unusable.
 */
export function expenseTotalFromInput(
  category: CategoryPricing,
  input: { amount?: unknown; units?: unknown },
): { totalCents: number } | { error: string } {
  if (isUnitBased(category)) {
    const h = parseQuantityHundredths(input.units)
    if (h == null) return { error: `Enter how many ${category.unitName || 'units'} (e.g. 12.5).` }
    const totalCents = unitTotalCents(h, category.unitPriceCents)
    return totalCents > 0 ? { totalCents } : { error: 'That quantity is too small.' }
  }
  const totalCents = parseMoneyCents(input.amount)
  return totalCents ? { totalCents } : { error: 'Enter an amount like 42.50.' }
}

/** Quantity shown when editing a unit-priced expense (total ÷ unit price, 2 dp). Approximate if the price changed (specs/26 G15). */
export function unitsFromTotal(totalCents: number, unitPriceCents: number): string {
  if (unitPriceCents <= 0) return ''
  const h = Math.round((totalCents * 100) / unitPriceCents)
  return (h / 100).toFixed(2).replace(/\.?0+$/, '')
}

/** Harvest: expenses on billable projects default to billable, on non-billable projects to non-billable (AC-EXP-115). */
export function defaultBillableFor(project: { isBillable: boolean; projectType?: string | null }): boolean {
  return project.isBillable && project.projectType !== 'non_billable'
}

/** Billed amount including markup (09: "$29.00 + 20% markup" → $34.80). */
export function billedCents(totalCents: number, markupPercent: number | null | undefined): number {
  const pct = markupPercent ? Number(markupPercent) : 0
  return Math.round(totalCents * (1 + pct / 100))
}

/* ---------------- Week-grouped list (AC-EXP-111, 112) ---------------- */

export interface WeekGroup<T> {
  weekStart: Date
  weekEnd: Date
  totalCents: number
  rows: T[]
}

/** Group rows (already newest-first) into weeks, newest week first, keeping row order within a week. */
export function groupByWeek<T extends { spentDate: Date; totalCents: number }>(rows: readonly T[], weekStartsOn: WeekStart): WeekGroup<T>[] {
  const out: WeekGroup<T>[] = []
  const byKey = new Map<number, WeekGroup<T>>()
  for (const r of rows) {
    const ws = startOfWeek(r.spentDate, weekStartsOn)
    let g = byKey.get(ws.getTime())
    if (!g) {
      g = { weekStart: ws, weekEnd: addDays(ws, 6), totalCents: 0, rows: [] }
      byKey.set(ws.getTime(), g)
      out.push(g)
    }
    g.totalCents += r.totalCents
    g.rows.push(r)
  }
  return out.sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime())
}

export const EXPENSE_PAGE_SIZE = 50

/**
 * Paging that never splits a week. Given the first `pageSize + 1` rows (newest first) below the cursor,
 * returns the lower bound of this page: null when everything fits (no older page), else the start of the
 * week holding row `pageSize - 1`. The page then shows every row with spentDate >= that bound, and the
 * "Older expenses" cursor is that bound (exclusive). Always moves backwards, so paging terminates.
 */
export function pageLowerBound(probe: readonly { spentDate: Date }[], pageSize: number, weekStartsOn: WeekStart): Date | null {
  if (probe.length <= pageSize) return null
  return startOfWeek(probe[pageSize - 1].spentDate, weekStartsOn)
}
