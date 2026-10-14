import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { Timeframe } from '@/modules/shared/timeframe'
import { BILLED_SQL, expenseWhere, groupColumns, type ExpenseGroupRow, type ExpenseReportScope, type ExpenseTab, type ExpenseTotals } from './expenseSummary'

const FROM = Prisma.sql`FROM "Expense" e
  JOIN "Project" p ON p.id = e."projectId"
  JOIN "Client" c ON c.id = p."clientId"
  JOIN "ExpenseCategory" cat ON cat.id = e."categoryId"
  JOIN "User" u ON u.id = e."userId"`

const INVOICED = Prisma.sql`(e."invoiceLineItemId" IS NOT NULL OR e."lockState"::text = 'invoiced')`

/** Totals + one grouping for Reports → Expenses, two aggregate queries (specs/26 AC-EXP-105/106). */
export async function expenseSummary(scope: ExpenseReportScope, tf: Pick<Timeframe, 'from' | 'till'>, tab: ExpenseTab) {
  const w = expenseWhere(scope, tf)
  const g = groupColumns(tab)
  const [totalsRows, groups] = await Promise.all([
    prisma.$queryRaw<{ n: number; total: bigint | null; billable: bigint | null; nonbill: bigint | null; uninv: bigint | null }[]>`
      SELECT COUNT(*)::int AS n,
        SUM(e."totalCents")::bigint AS total,
        SUM(CASE WHEN e."isBillable" THEN ${BILLED_SQL} ELSE 0 END)::bigint AS billable,
        SUM(CASE WHEN e."isBillable" THEN 0 ELSE e."totalCents" END)::bigint AS nonbill,
        SUM(CASE WHEN e."isBillable" AND NOT ${INVOICED} THEN ${BILLED_SQL} ELSE 0 END)::bigint AS uninv
      FROM "Expense" e WHERE ${w}`,
    prisma.$queryRaw<{ id: string; name: string; client: string | null; n: number; total: bigint; billable: bigint }[]>`
      SELECT ${g.id} AS id, MIN(${g.name}) AS name, MIN(${g.client}) AS client, COUNT(*)::int AS n,
        SUM(e."totalCents")::bigint AS total,
        SUM(CASE WHEN e."isBillable" THEN ${BILLED_SQL} ELSE 0 END)::bigint AS billable
      ${FROM} WHERE ${w}
      GROUP BY ${g.id}`,
  ])
  const t = totalsRows[0]
  const totals: ExpenseTotals = {
    count: Number(t?.n ?? 0),
    totalCents: Number(t?.total ?? 0),
    billableCents: Number(t?.billable ?? 0),
    nonBillableCents: Number(t?.nonbill ?? 0),
    uninvoicedCents: Number(t?.uninv ?? 0),
  }
  const rows: ExpenseGroupRow[] = groups.map((r) => ({
    id: r.id,
    name: r.name,
    clientName: r.client,
    count: Number(r.n),
    totalCents: Number(r.total),
    billableCents: Number(r.billable),
  }))
  return { totals, rows }
}
