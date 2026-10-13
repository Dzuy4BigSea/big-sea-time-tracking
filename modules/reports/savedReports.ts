/**
 * Saved reports (specs/25): a name + report kind + the report's URL query. Pure helpers shared by the
 * Saved reports list, the save dialog and the server actions.
 */
export type SavedReportKind = 'time_summary' | 'detailed_time' | 'detailed_expense'

export const KIND_PATH: Record<SavedReportKind, string> = {
  time_summary: '/reports',
  detailed_time: '/reports/detailed',
  detailed_expense: '/reports/detailed/expenses',
}

export const KIND_LABEL: Record<SavedReportKind, string> = {
  time_summary: 'Time',
  detailed_time: 'Detailed time',
  detailed_expense: 'Detailed expense',
}

export const isSavedReportKind = (s: unknown): s is SavedReportKind => typeof s === 'string' && s in KIND_PATH

/** Params that never belong in a saved report (the saved-report marker itself, one-off UI state). */
const TRANSIENT = new Set(['saved', 'edit'])

/** Clean a report's query into the params stored on a SavedReport (strings only, transient keys dropped, sorted). */
export function cleanParams(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(params).sort()) {
    const v = params[k]
    if (TRANSIENT.has(k) || typeof v !== 'string' || v === '' || k.length > 40 || v.length > 4000) continue
    out[k] = v
  }
  return out
}

/** True when two param sets describe the same report (so "Update existing report" can be disabled). */
export function sameParams(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const x = cleanParams(a)
  const y = cleanParams(b)
  const kx = Object.keys(x)
  return kx.length === Object.keys(y).length && kx.every((k) => x[k] === y[k])
}

export type SavedFilter = 'all' | 'mine' | 'shared' | 'archived'
export const SAVED_FILTERS: { key: SavedFilter; label: string }[] = [
  { key: 'all', label: 'All saved reports' },
  { key: 'mine', label: 'My reports' },
  { key: 'shared', label: 'Reports shared with me' },
  { key: 'archived', label: 'Archived reports' },
]

interface ReportLike {
  createdById: string
  shared: boolean
  archivedAt: Date | null
}

/** Who can open a saved report: its creator, or anyone in the account once it's shared. */
export const canView = (r: ReportLike, userId: string) => r.createdById === userId || r.shared

/** Who can rename / re-share / update / archive / delete it: the creator or an administrator. */
export const canEdit = (r: Pick<ReportLike, 'createdById'>, userId: string, permissionProfile: string) =>
  r.createdById === userId || permissionProfile === 'administrator'

/** Does a (viewable) report belong in the chosen list filter? */
export function inFilter(r: ReportLike, userId: string, filter: SavedFilter): boolean {
  if (filter === 'archived') return r.archivedAt != null
  if (r.archivedAt != null) return false
  if (filter === 'mine') return r.createdById === userId
  if (filter === 'shared') return r.createdById !== userId && r.shared
  return true
}

/** Link that opens a saved report: its kind's page + stored params + `saved=<id>` (for the report-name menu). */
export function savedReportHref(r: { id: string; kind: SavedReportKind; params: unknown }): string {
  const p = new URLSearchParams(cleanParams((r.params ?? {}) as Record<string, unknown>))
  p.set('saved', r.id)
  return `${KIND_PATH[r.kind]}?${p.toString()}`
}
