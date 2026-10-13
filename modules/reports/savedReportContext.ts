import { prisma } from '@/lib/prisma'
import type { CurrentUser } from '@/lib/session'
import { canEdit, canView, cleanParams, sameParams, type SavedReportKind } from './savedReports'

/**
 * For a report page opened from Saved reports (`?saved=<id>`): the saved report's name, sharing and
 * whether the current view differs from what's stored (enables "Update existing report"). Null when
 * there's no marker, it isn't this kind, or the viewer may not see it.
 */
export async function savedReportContext(me: CurrentUser, savedId: string | undefined, kind: SavedReportKind, current: Record<string, string>) {
  if (!savedId) return null
  const r = await prisma.savedReport.findFirst({ where: { id: savedId, accountId: me.accountId, kind } })
  if (!r || !canView(r, me.userId)) return null
  return {
    id: r.id,
    name: r.name,
    shared: r.shared,
    canEdit: canEdit(r, me.userId, me.permissionProfile),
    changed: !sameParams((r.params ?? {}) as Record<string, unknown>, current),
  }
}

/** A page's search params as the flat string map a saved report stores. */
export const currentParams = (sp: Record<string, string | string[] | undefined>) =>
  cleanParams(Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v])))
