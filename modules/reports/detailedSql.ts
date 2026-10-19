import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { Timeframe } from '@/modules/shared/timeframe'
import type { DetailedFilters, DetailedGroup } from './detailed'

/**
 * DB side of the detailed reports (specs/25). Totals and group subtotals are aggregated in SQL and the
 * row list is capped, so even "All time, everything" (388k time entries) stays one cheap round trip each.
 */
export const DETAILED_ROW_LIMIT = 2000

export interface DetailedScope {
  accountId: string
  /** Set for people without `run_account_reports`: they only ever see their own entries. */
  onlyUserId: string | null
}

const ids = (xs: string[]) => Prisma.join(xs)

/** "Invoiced" = on an invoice line or locked as invoiced; the complement of the uninvoiced pool (specs/05). */
const invoicedSql = (a: 'te' | 'e') => Prisma.sql`(${Prisma.raw(a)}."invoiceLineItemId" IS NOT NULL OR ${Prisma.raw(a)}."lockState"::text = 'invoiced')`

function where(a: 'te' | 'e', f: DetailedFilters, tf: Timeframe, scope: DetailedScope): Prisma.Sql {
  const t = Prisma.raw(a)
  const parts: Prisma.Sql[] = [Prisma.sql`${t}."accountId" = ${scope.accountId}`]
  if (a === 'te') parts.push(Prisma.sql`te."isRunning" = false`)
  if (tf.from) parts.push(Prisma.sql`${t}."spentDate" >= ${tf.from}`)
  if (tf.till) parts.push(Prisma.sql`${t}."spentDate" <= ${tf.till}`)
  if (scope.onlyUserId) parts.push(Prisma.sql`${t}."userId" = ${scope.onlyUserId}`)
  if (f.clients.length) parts.push(Prisma.sql`p."clientId" IN (${ids(f.clients)})`)
  if (f.projects.length) parts.push(Prisma.sql`${t}."projectId" IN (${ids(f.projects)})`)
  if (f.items.length) parts.push(a === 'te' ? Prisma.sql`te."taskId" IN (${ids(f.items)})` : Prisma.sql`e."categoryId" IN (${ids(f.items)})`)
  if (f.users.length) parts.push(Prisma.sql`${t}."userId" IN (${ids(f.users)})`)
  if (f.billable === 'billable') parts.push(Prisma.sql`${t}."isBillable" = true`)
  if (f.billable === 'nonbillable') parts.push(Prisma.sql`${t}."isBillable" = false`)
  if (f.invoiced === 'invoiced') parts.push(invoicedSql(a))
  if (f.invoiced === 'uninvoiced') parts.push(Prisma.sql`NOT ${invoicedSql(a)}`)
  if (f.activeOnly) parts.push(Prisma.sql`p."isActive" = true AND p."archivedAt" IS NULL`)
  return Prisma.join(parts, ' AND ')
}

/** Group key + label expressions per grouping. Date keys are YYYY-MM-DD strings. */
function groupExpr(a: 'te' | 'e', g: DetailedGroup): { key: Prisma.Sql; label: Prisma.Sql; order: Prisma.Sql } {
  const t = Prisma.raw(a)
  switch (g) {
    case 'client':
      return { key: Prisma.sql`c.id`, label: Prisma.sql`c.name`, order: Prisma.sql`lower(c.name)` }
    case 'project':
      return {
        key: Prisma.sql`p.id`,
        label: Prisma.sql`CASE WHEN p.code IS NOT NULL AND p.code <> '' THEN '[' || p.code || '] ' || p.name ELSE p.name END`,
        order: Prisma.sql`lower(p.name)`,
      }
    case 'task':
      return { key: Prisma.sql`tk.id`, label: Prisma.sql`tk.name`, order: Prisma.sql`lower(tk.name)` }
    case 'category':
      return { key: Prisma.sql`cat.id`, label: Prisma.sql`cat.name`, order: Prisma.sql`lower(cat.name)` }
    case 'user':
      return { key: Prisma.sql`u.id`, label: Prisma.sql`trim(u."firstName" || ' ' || u."lastName")`, order: Prisma.sql`lower(u."firstName" || ' ' || u."lastName")` }
    case 'date':
    default:
      return { key: Prisma.sql`to_char(${t}."spentDate", 'YYYY-MM-DD')`, label: Prisma.sql`to_char(${t}."spentDate", 'MM/DD/YYYY')`, order: Prisma.sql`${t}."spentDate"` }
  }
}

export interface DetailedGroupTotal {
  key: string
  label: string
  /** Minutes (time) or cents (expense). */
  total: number
}

/* ---------- Time ---------- */

const TIME_FROM = Prisma.sql`FROM "TimeEntry" te
  JOIN "Project" p ON p.id = te."projectId"
  JOIN "Client" c ON c.id = p."clientId"
  JOIN "Task" tk ON tk.id = te."taskId"
  JOIN "User" u ON u.id = te."userId"`

export interface DetailedTimeRow {
  id: string
  groupKey: string
  spentDate: Date
  minutes: number
  notes: string | null
  isBillable: boolean
  invoiced: boolean
  billableRateCents: number | null
  clientId: string
  clientName: string
  projectId: string
  projectName: string
  projectCode: string | null
  taskName: string
  userId: string
  userName: string
  roles: string[]
  /** The Asana task (or other work item) the entry was tracked from (specs/29). */
  externalService: string | null
  externalPermalink: string | null
}

export async function detailedTime(f: DetailedFilters, tf: Timeframe, scope: DetailedScope, limit: number | null = DETAILED_ROW_LIMIT) {
  const w = where('te', f, tf, scope)
  const g = groupExpr('te', f.group)
  const [totals] = await prisma.$queryRaw<{ minutes: number | null; ubmin: number | null; n: number }[]>`
    SELECT SUM(te.minutes)::int AS minutes,
      SUM(CASE WHEN te."isBillable" AND NOT ${invoicedSql('te')} THEN te.minutes ELSE 0 END)::int AS ubmin,
      COUNT(*)::int AS n
    ${TIME_FROM} WHERE ${w}`
  const groups = await prisma.$queryRaw<DetailedGroupTotal[]>`
    SELECT ${g.key} AS key, MIN(${g.label}) AS label, SUM(te.minutes)::int AS total
    ${TIME_FROM} WHERE ${w} GROUP BY ${g.key} ORDER BY MIN(${g.order}) ASC, ${g.key}`
  const rows = await prisma.$queryRaw<DetailedTimeRow[]>`
    SELECT te.id, ${g.key} AS "groupKey", te."spentDate", te.minutes, te.notes, te."isBillable",
      ${invoicedSql('te')} AS invoiced, te."billableRateCents", te."externalService", te."externalPermalink",
      c.id AS "clientId", c.name AS "clientName", p.id AS "projectId", p.name AS "projectName", p.code AS "projectCode",
      tk.name AS "taskName", u.id AS "userId", trim(u."firstName" || ' ' || u."lastName") AS "userName", u."roleTags" AS roles
    ${TIME_FROM} WHERE ${w}
    ORDER BY ${g.order} ASC, ${g.key}, te."spentDate" ASC, lower(c.name), lower(p.name), te."createdAt"
    ${limit == null ? Prisma.empty : Prisma.sql`LIMIT ${limit}`}`
  return {
    totalMinutes: Number(totals?.minutes ?? 0),
    uninvoicedBillableMinutes: Number(totals?.ubmin ?? 0),
    count: Number(totals?.n ?? 0),
    groups: groups.map((x) => ({ ...x, total: Number(x.total) })),
    rows,
  }
}

/* ---------- Expenses ---------- */

const EXPENSE_FROM = Prisma.sql`FROM "Expense" e
  JOIN "Project" p ON p.id = e."projectId"
  JOIN "Client" c ON c.id = p."clientId"
  JOIN "ExpenseCategory" cat ON cat.id = e."categoryId"
  JOIN "User" u ON u.id = e."userId"`

export interface DetailedExpenseRow {
  id: string
  groupKey: string
  spentDate: Date
  totalCents: number
  notes: string | null
  isBillable: boolean
  invoiced: boolean
  clientId: string
  clientName: string
  projectId: string
  projectName: string
  projectCode: string | null
  categoryName: string
  userId: string
  userName: string
  /** Receipt link (📎 next to the amount; specs/26 AC-EXP-107). */
  receiptFileUrl: string | null
}

export async function detailedExpenses(f: DetailedFilters, tf: Timeframe, scope: DetailedScope, limit: number | null = DETAILED_ROW_LIMIT) {
  const w = where('e', f, tf, scope)
  const g = groupExpr('e', f.group)
  const [totals] = await prisma.$queryRaw<{ cents: number | null; billable: number | null; ucents: number | null; n: number }[]>`
    SELECT SUM(e."totalCents")::int AS cents,
      SUM(CASE WHEN e."isBillable" THEN e."totalCents" ELSE 0 END)::int AS billable,
      SUM(CASE WHEN e."isBillable" AND NOT ${invoicedSql('e')} THEN e."totalCents" ELSE 0 END)::int AS ucents,
      COUNT(*)::int AS n
    ${EXPENSE_FROM} WHERE ${w}`
  const groups = await prisma.$queryRaw<DetailedGroupTotal[]>`
    SELECT ${g.key} AS key, MIN(${g.label}) AS label, SUM(e."totalCents")::int AS total
    ${EXPENSE_FROM} WHERE ${w} GROUP BY ${g.key} ORDER BY MIN(${g.order}) ASC, ${g.key}`
  const rows = await prisma.$queryRaw<DetailedExpenseRow[]>`
    SELECT e.id, ${g.key} AS "groupKey", e."spentDate", e."totalCents", e.notes, e."isBillable",
      ${invoicedSql('e')} AS invoiced,
      c.id AS "clientId", c.name AS "clientName", p.id AS "projectId", p.name AS "projectName", p.code AS "projectCode",
      cat.name AS "categoryName", u.id AS "userId", trim(u."firstName" || ' ' || u."lastName") AS "userName",
      e."receiptFileUrl"
    ${EXPENSE_FROM} WHERE ${w}
    ORDER BY ${g.order} ASC, ${g.key}, e."spentDate" ASC, lower(c.name), lower(p.name), e."createdAt"
    ${limit == null ? Prisma.empty : Prisma.sql`LIMIT ${limit}`}`
  return {
    totalCents: Number(totals?.cents ?? 0),
    billableCents: Number(totals?.billable ?? 0),
    uninvoicedCents: Number(totals?.ucents ?? 0),
    count: Number(totals?.n ?? 0),
    groups: groups.map((x) => ({ ...x, total: Number(x.total) })),
    rows,
  }
}

/* ---------- Filter pickers ---------- */

export interface PickerOption {
  value: string
  label: string
  group?: string
  keywords?: string
  archived: boolean
}

/** Options for the Clients / Projects / Tasks|Categories / Teammates pickers (archived ones flagged). */
export async function detailedPickers(accountId: string, kind: 'time' | 'expense', onlyUserId: string | null) {
  const [clients, projects, items, users] = await Promise.all([
    prisma.client.findMany({ where: { accountId }, select: { id: true, name: true, isActive: true, archivedAt: true }, orderBy: { name: 'asc' } }),
    prisma.project.findMany({
      where: { accountId },
      select: { id: true, name: true, code: true, isActive: true, archivedAt: true, client: { select: { name: true } } },
      orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
    }),
    kind === 'time'
      ? prisma.task.findMany({ where: { accountId }, select: { id: true, name: true, isActive: true, archivedAt: true }, orderBy: { name: 'asc' } })
      : prisma.expenseCategory.findMany({ where: { accountId }, select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({
      where: { accountId, ...(onlyUserId ? { id: onlyUserId } : {}) },
      select: { id: true, firstName: true, lastName: true, isActive: true, archivedAt: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    }),
  ])
  const archived = (x: { isActive: boolean; archivedAt?: Date | null }) => !x.isActive || x.archivedAt != null
  return {
    clients: clients.map((c): PickerOption => ({ value: c.id, label: c.name, archived: archived(c) })),
    projects: projects.map((p): PickerOption => ({
      value: p.id,
      label: p.code ? `[${p.code}] ${p.name}` : p.name,
      group: p.client.name,
      keywords: p.code ?? undefined,
      archived: archived(p),
    })),
    items: items.map((t): PickerOption => ({ value: t.id, label: t.name, archived: archived(t) })),
    users: users.map((u): PickerOption => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim(), archived: archived(u) })),
  }
}
