import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { Timeframe } from '@/modules/shared/timeframe'
import type { DetailedFilters, DetailedGroup } from './detailed'
import type { DetailedScope, DetailedTimeRow } from './detailedSql'

/**
 * Keyset-paginated rows for the detailed time CSV export (specs/25). Same filters and the same order
 * as `detailedTime` in detailedSql.ts (group order, group key, date, client, project, createdAt), plus
 * `te.id` as the final tie-breaker so each batch resumes exactly after the previous one. Every sort
 * expression is non-null, so a row-value comparison `(k1, …, id) > (…)` is a correct keyset cursor.
 * (createdAt is timestamp(3), so its millisecond text form round-trips exactly.)
 *
 * KEEP IN SYNC with `where()` / `groupExpr()` in detailedSql.ts (they are module-private there).
 */

const ids = (xs: string[]) => Prisma.join(xs)
const invoicedSql = Prisma.sql`(te."invoiceLineItemId" IS NOT NULL OR te."lockState"::text = 'invoiced')`

function where(f: DetailedFilters, tf: Timeframe, scope: DetailedScope): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`te."accountId" = ${scope.accountId}`, Prisma.sql`te."isRunning" = false`]
  if (tf.from) parts.push(Prisma.sql`te."spentDate" >= ${tf.from}`)
  if (tf.till) parts.push(Prisma.sql`te."spentDate" <= ${tf.till}`)
  if (scope.onlyUserId) parts.push(Prisma.sql`te."userId" = ${scope.onlyUserId}`)
  if (f.clients.length) parts.push(Prisma.sql`p."clientId" IN (${ids(f.clients)})`)
  if (f.projects.length) parts.push(Prisma.sql`te."projectId" IN (${ids(f.projects)})`)
  if (f.items.length) parts.push(Prisma.sql`te."taskId" IN (${ids(f.items)})`)
  if (f.users.length) parts.push(Prisma.sql`te."userId" IN (${ids(f.users)})`)
  if (f.billable === 'billable') parts.push(Prisma.sql`te."isBillable" = true`)
  if (f.billable === 'nonbillable') parts.push(Prisma.sql`te."isBillable" = false`)
  if (f.invoiced === 'invoiced') parts.push(invoicedSql)
  if (f.invoiced === 'uninvoiced') parts.push(Prisma.sql`NOT ${invoicedSql}`)
  if (f.activeOnly) parts.push(Prisma.sql`p."isActive" = true AND p."archivedAt" IS NULL`)
  return Prisma.join(parts, ' AND ')
}

/**
 * Group key + leading sort expression. For the default date grouping the leading key is the raw
 * `spentDate`, so Postgres can walk the (accountId, spentDate) index and only incrementally sort
 * each batch instead of sorting the whole result for every page.
 */
function groupExpr(g: DetailedGroup): { key: Prisma.Sql; order: Prisma.Sql; isDate: boolean } {
  switch (g) {
    case 'client':
      return { key: Prisma.sql`c.id`, order: Prisma.sql`lower(c.name)`, isDate: false }
    case 'project':
      return { key: Prisma.sql`p.id`, order: Prisma.sql`lower(p.name)`, isDate: false }
    case 'task':
    case 'category':
      return { key: Prisma.sql`tk.id`, order: Prisma.sql`lower(tk.name)`, isDate: false }
    case 'user':
      return { key: Prisma.sql`u.id`, order: Prisma.sql`lower(u."firstName" || ' ' || u."lastName")`, isDate: false }
    case 'date':
    default:
      return { key: Prisma.sql`to_char(te."spentDate", 'YYYY-MM-DD')`, order: Prisma.sql`te."spentDate"`, isDate: true }
  }
}

/** Cursor = the last row's sort key, all as text (cast back in SQL). */
export type DetailedExportCursor = { k1: string; k2: string; d: string; c: string; p: string; t: string; id: string }
type Row = DetailedTimeRow & { _k1: string; _d: string; _c: string; _p: string; _t: string }

export async function detailedTimeBatch(
  f: DetailedFilters,
  tf: Timeframe,
  scope: DetailedScope,
  after: DetailedExportCursor | null,
  take: number,
): Promise<{ rows: DetailedTimeRow[]; next: DetailedExportCursor | null }> {
  const w = where(f, tf, scope)
  const g = groupExpr(f.group)
  const k1 = g.isDate ? Prisma.sql`to_char(te."spentDate", 'YYYY-MM-DD')` : g.order
  const sortKey = Prisma.sql`(${g.order}, ${g.key}, te."spentDate", lower(c.name), lower(p.name), te."createdAt", te.id)`
  const k1Param = g.isDate ? Prisma.sql`${after?.k1}::date` : Prisma.sql`${after?.k1}`
  const cursor = after
    ? Prisma.sql`AND ${sortKey} > (${k1Param}, ${after.k2}, ${after.d}::date, ${after.c}, ${after.p}, ${after.t}::timestamp(3), ${after.id})
        ${g.isDate ? Prisma.sql`AND te."spentDate" >= ${after.d}::date` : Prisma.empty}`
    : Prisma.empty
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT te.id, ${g.key} AS "groupKey", te."spentDate", te.minutes, te.notes, te."isBillable",
      ${invoicedSql} AS invoiced, te."billableRateCents", te."externalService", te."externalPermalink",
      c.id AS "clientId", c.name AS "clientName", p.id AS "projectId", p.name AS "projectName", p.code AS "projectCode",
      tk.name AS "taskName", u.id AS "userId", trim(u."firstName" || ' ' || u."lastName") AS "userName", u."roleTags" AS roles,
      ${k1} AS "_k1", to_char(te."spentDate", 'YYYY-MM-DD') AS "_d", lower(c.name) AS "_c", lower(p.name) AS "_p",
      to_char(te."createdAt", 'YYYY-MM-DD HH24:MI:SS.MS') AS "_t"
    FROM "TimeEntry" te
      JOIN "Project" p ON p.id = te."projectId"
      JOIN "Client" c ON c.id = p."clientId"
      JOIN "Task" tk ON tk.id = te."taskId"
      JOIN "User" u ON u.id = te."userId"
    WHERE ${w} ${cursor}
    ORDER BY ${g.order} ASC, ${g.key} ASC, te."spentDate" ASC, lower(c.name) ASC, lower(p.name) ASC, te."createdAt" ASC, te.id ASC
    LIMIT ${take}`
  const last = rows[rows.length - 1]
  return {
    rows,
    next: rows.length === take && last
      ? { k1: last._k1, k2: String(last.groupKey), d: last._d, c: last._c, p: last._p, t: last._t, id: last.id }
      : null,
  }
}
