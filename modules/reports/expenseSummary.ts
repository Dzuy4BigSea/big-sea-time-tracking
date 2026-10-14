import { Prisma } from '@prisma/client'
import type { Timeframe } from '@/modules/shared/timeframe'

/**
 * Reports → Expenses summary (specs/26 §7, a Track2 extra shaped like the Time report): totals plus one
 * group-by table (Clients | Projects | Categories | Team). Everything aggregates in Postgres; only the
 * per-group rows come back (AC-EXP-106). Money is integer cents (INV-1).
 */
export type ExpenseTab = 'clients' | 'projects' | 'categories' | 'team'

export const EXPENSE_TABS: { key: ExpenseTab; label: string }[] = [
  { key: 'clients', label: 'Clients' },
  { key: 'projects', label: 'Projects' },
  { key: 'categories', label: 'Categories' },
  { key: 'team', label: 'Team' },
]

export const parseExpenseTab = (v: string | undefined): ExpenseTab => EXPENSE_TABS.find((t) => t.key === v)?.key ?? 'clients'

/** Who the report covers: everyone (run_account_reports) or only the viewer (AC-EXP-101/102). */
export interface ExpenseReportScope {
  accountId: string
  onlyUserId: string | null
}

export interface ExpenseGroupRow {
  id: string
  name: string
  /** Client name, on the Projects tab. */
  clientName: string | null
  count: number
  totalCents: number
  /** Billable amount including markup (09). */
  billableCents: number
}

export interface ExpenseTotals {
  count: number
  totalCents: number
  billableCents: number
  nonBillableCents: number
  /** Billable (with markup), not yet invoiced. */
  uninvoicedCents: number
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** Detailed expense report params (specs/25) for the same timeframe, or null when it's all time. */
export function detailedRange(tf: Pick<Timeframe, 'from' | 'till'>): Record<string, string> {
  if (!tf.from && !tf.till) return { range: 'all' }
  return { range: 'custom', ...(tf.from ? { from: ymd(tf.from) } : {}), ...(tf.till ? { to: ymd(tf.till) } : {}) }
}

const FILTER_PARAM: Record<ExpenseTab, string> = { clients: 'clients', projects: 'projects', categories: 'categories', team: 'users' }

/** Drill-down: the Detailed expense report for this row's client / project / category / person (AC-EXP-104). */
export function detailedExpenseQuery(tf: Pick<Timeframe, 'from' | 'till'>, tab: ExpenseTab, id: string): Record<string, string> {
  return { ...detailedRange(tf), [FILTER_PARAM[tab]]: id }
}

/* ---------- SQL (built here so the shape is testable; executed in expenseSummarySql.ts) ---------- */

/** Per-row billed amount including markup, rounded half-up per expense like billedCents(). */
export const BILLED_SQL = Prisma.sql`ROUND(e."totalCents" * (1 + COALESCE(e."markupPercent", 0) / 100.0))`

export function expenseWhere(scope: ExpenseReportScope, tf: Pick<Timeframe, 'from' | 'till'>): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`e."accountId" = ${scope.accountId}`]
  if (scope.onlyUserId) parts.push(Prisma.sql`e."userId" = ${scope.onlyUserId}`)
  if (tf.from) parts.push(Prisma.sql`e."spentDate" >= ${tf.from}`)
  if (tf.till) parts.push(Prisma.sql`e."spentDate" <= ${tf.till}`)
  return Prisma.join(parts, ' AND ')
}

export function groupColumns(tab: ExpenseTab): { id: Prisma.Sql; name: Prisma.Sql; client: Prisma.Sql } {
  switch (tab) {
    case 'projects':
      return {
        id: Prisma.sql`p.id`,
        name: Prisma.sql`CASE WHEN p.code IS NOT NULL AND p.code <> '' THEN '[' || p.code || '] ' || p.name ELSE p.name END`,
        client: Prisma.sql`c.name`,
      }
    case 'categories':
      return { id: Prisma.sql`cat.id`, name: Prisma.sql`cat.name`, client: Prisma.sql`NULL::text` }
    case 'team':
      return { id: Prisma.sql`u.id`, name: Prisma.sql`trim(u."firstName" || ' ' || u."lastName")`, client: Prisma.sql`NULL::text` }
    case 'clients':
    default:
      return { id: Prisma.sql`c.id`, name: Prisma.sql`c.name`, client: Prisma.sql`NULL::text` }
  }
}
