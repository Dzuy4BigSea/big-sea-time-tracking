/**
 * Column sorting for report tables. Reports aggregate in the DB first, so these helpers only ever
 * sort the (small) aggregated rows. URL params: `sort` (column key) and `dir` ('asc' | 'desc').
 */
export type SortDir = 'asc' | 'desc'
export type SortState<K extends string> = { key: K; dir: SortDir }
export type SortValue = string | number | null | undefined

export function parseSort<K extends string>(
  params: { sort?: string; dir?: string },
  allowed: readonly K[],
  fallback: SortState<K>,
): SortState<K> {
  if (!allowed.includes(params.sort as K)) return fallback
  const key = params.sort as K
  const dir: SortDir = params.dir === 'asc' || params.dir === 'desc' ? params.dir : fallback.dir
  return { key, dir }
}

/**
 * The sort a header click produces: clicking the active column flips direction; clicking another
 * column starts at its natural first direction (text A→Z, numbers largest first, like Harvest).
 */
export function nextSort<K extends string>(current: SortState<K>, key: K, firstDir: SortDir): SortState<K> {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: firstDir }
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/** Compare two values ascending; null/undefined/NaN sort after everything (in either direction). */
function compare(a: SortValue, b: SortValue): number {
  if (typeof a === 'string' && typeof b === 'string') return collator.compare(a, b)
  return (a as number) - (b as number)
}
const isBlank = (v: SortValue) => v == null || (typeof v === 'number' && Number.isNaN(v))

/** Stable sort of rows by one column; returns a new array. Blanks always go last. */
export function sortRows<T, K extends string>(rows: readonly T[], state: SortState<K>, accessors: Record<K, (row: T) => SortValue>): T[] {
  const get = accessors[state.key]
  const sign = state.dir === 'asc' ? 1 : -1
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((x, y) => {
      const bx = isBlank(x.v)
      const by = isBlank(y.v)
      if (bx || by) return bx === by ? x.i - y.i : bx ? 1 : -1
      return sign * compare(x.v, y.v) || x.i - y.i
    })
    .map((x) => x.row)
}
