import { resolveTimeframe, type Timeframe, type WeekStart } from '@/modules/shared/timeframe'

/**
 * Detailed time / expense reports (specs/25): filter state, parsed from and written back to the URL so
 * a report is a link and a saved report is just its query string.
 *
 * URL params (all optional; defaults are dropped when serializing):
 *   range      this_week (default) | last_week | this_semimonth | … | this_year | last_year | all | custom
 *   from, to   YYYY-MM-DD, custom range only
 *   clients, projects, tasks, categories, users   comma-separated ids ("" = all)
 *   billable   all (default) | billable | nonbillable
 *   invoiced   all (default) | invoiced | uninvoiced
 *   group      date (default) | client | project | task | category | user
 *   active     1 = active projects only
 *   archived   1 = offer archived clients/projects/… in the filter pickers
 *
 * Relative ranges ("This week", "Last month") are stored as such, so a saved report rolls forward.
 */
export type DetailedKind = 'time' | 'expense'
export type BillableShow = 'all' | 'billable' | 'nonbillable'
export type InvoicedShow = 'all' | 'invoiced' | 'uninvoiced'
export type DetailedGroup = 'date' | 'client' | 'project' | 'task' | 'category' | 'user'

type Anchored = 'week' | 'semimonth' | 'month' | 'quarter' | 'year'
const RELATIVE: { key: string; period: Anchored; last: boolean }[] = [
  { key: 'this_week', period: 'week', last: false },
  { key: 'last_week', period: 'week', last: true },
  { key: 'this_semimonth', period: 'semimonth', last: false },
  { key: 'last_semimonth', period: 'semimonth', last: true },
  { key: 'this_month', period: 'month', last: false },
  { key: 'last_month', period: 'month', last: true },
  { key: 'this_quarter', period: 'quarter', last: false },
  { key: 'last_quarter', period: 'quarter', last: true },
  { key: 'this_year', period: 'year', last: false },
  { key: 'last_year', period: 'year', last: true },
]
export const RANGE_KEYS = [...RELATIVE.map((r) => r.key), 'all', 'custom'] as const

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Builder timeframe options, Harvest wording ("This month (October)", "Last month (September)"). */
export function rangeOptions(now: Date = new Date()): { value: string; label: string }[] {
  const m = now.getUTCMonth()
  return [
    ...RELATIVE.map((r) => {
      const base = `${r.last ? 'Last' : 'This'} ${r.period}`
      const label = r.period === 'month' ? `${base} (${MONTHS[r.last ? (m + 11) % 12 : m]})` : base
      return { value: r.key, label }
    }),
    { value: 'all', label: 'All time' },
    { value: 'custom', label: 'Custom' },
  ]
}

export const GROUPS: Record<DetailedKind, { key: DetailedGroup; label: string }[]> = {
  time: [
    { key: 'client', label: 'Client' },
    { key: 'project', label: 'Project' },
    { key: 'task', label: 'Task' },
    { key: 'user', label: 'Teammate' },
    { key: 'date', label: 'Date' },
  ],
  expense: [
    { key: 'client', label: 'Client' },
    { key: 'project', label: 'Project' },
    { key: 'category', label: 'Category' },
    { key: 'user', label: 'Teammate' },
    { key: 'date', label: 'Date' },
  ],
}

export interface DetailedFilters {
  kind: DetailedKind
  range: string
  from: string | null
  to: string | null
  clients: string[]
  projects: string[]
  /** Task ids (time) or expense-category ids (expense). */
  items: string[]
  users: string[]
  billable: BillableShow
  invoiced: InvoicedShow
  group: DetailedGroup
  activeOnly: boolean
  archived: boolean
}

export type DetailedParams = Partial<Record<string, string | string[] | undefined>>

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const YMD = /^\d{4}-\d{2}-\d{2}$/
/** Comma-separated ids; anything that isn't a plain id is dropped (they go into SQL as parameters anyway). */
export function parseIds(v: string | string[] | undefined): string[] {
  const raw = Array.isArray(v) ? v.join(',') : (v ?? '')
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{1,64}$/.test(s)))]
}

/** The param that holds the third picker: `tasks` for time, `categories` for expenses. */
export const itemsParam = (kind: DetailedKind) => (kind === 'time' ? 'tasks' : 'categories')

export function parseDetailed(kind: DetailedKind, sp: DetailedParams): DetailedFilters {
  const range = (RANGE_KEYS as readonly string[]).includes(one(sp.range) ?? '') ? one(sp.range)! : 'this_week'
  const from = YMD.test(one(sp.from) ?? '') ? one(sp.from)! : null
  const to = YMD.test(one(sp.to) ?? '') ? one(sp.to)! : null
  const billable = (['billable', 'nonbillable'] as const).find((b) => b === one(sp.billable)) ?? 'all'
  const invoiced = (['invoiced', 'uninvoiced'] as const).find((b) => b === one(sp.invoiced)) ?? 'all'
  const group = GROUPS[kind].find((g) => g.key === one(sp.group))?.key ?? 'date'
  return {
    kind,
    range,
    from: range === 'custom' ? from : null,
    to: range === 'custom' ? to : null,
    clients: parseIds(sp.clients),
    projects: parseIds(sp.projects),
    items: parseIds(sp[itemsParam(kind)]),
    users: parseIds(sp.users),
    billable,
    invoiced,
    group,
    activeOnly: one(sp.active) === '1',
    archived: one(sp.archived) === '1',
  }
}

/** URL params for these filters (defaults omitted), so links / saved reports round-trip through parseDetailed. */
export function detailedQuery(f: DetailedFilters): Record<string, string> {
  const q: Record<string, string> = {}
  if (f.range !== 'this_week') q.range = f.range
  if (f.range === 'custom') {
    if (f.from) q.from = f.from
    if (f.to) q.to = f.to
  }
  if (f.clients.length) q.clients = f.clients.join(',')
  if (f.projects.length) q.projects = f.projects.join(',')
  if (f.items.length) q[itemsParam(f.kind)] = f.items.join(',')
  if (f.users.length) q.users = f.users.join(',')
  if (f.billable !== 'all') q.billable = f.billable
  if (f.invoiced !== 'all') q.invoiced = f.invoiced
  if (f.group !== 'date') q.group = f.group
  if (f.activeOnly) q.active = '1'
  if (f.archived) q.archived = '1'
  return q
}

/** Inclusive date bounds for the filter's range ("Last month" is resolved against `now`). */
export function detailedTimeframe(f: Pick<DetailedFilters, 'range' | 'from' | 'to'>, opts: { weekStartsOn?: WeekStart; now?: Date } = {}): Timeframe {
  if (f.range === 'all') return resolveTimeframe({ period: 'all' }, opts)
  if (f.range === 'custom') return resolveTimeframe({ period: 'custom', from: f.from ?? undefined, to: f.to ?? undefined }, opts)
  const r = RELATIVE.find((x) => x.key === f.range) ?? RELATIVE[0]
  const current = resolveTimeframe({ period: r.period }, opts)
  return r.last ? resolveTimeframe({ period: r.period, anchor: current.prevAnchor! }, opts) : current
}
