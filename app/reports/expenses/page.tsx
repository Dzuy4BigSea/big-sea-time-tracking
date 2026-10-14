import Link from 'next/link'
import { accountWeekStartsOn } from '@/lib/accountPrefs'
import { formatCents } from '@/lib/format'
import { ReportsTabs } from '@/components/ReportsTabs'
import { requireUser } from '@/lib/session'
import { requireModule } from '@/lib/modules'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { ReportTimeframe } from '@/components/ReportTimeframe'
import { SortableTh } from '@/components/SortableTh'
import { resolveTimeframe, timeframeQuery, buildHref, type TimeframeParams } from '@/modules/shared/timeframe'
import { parseSort, sortRows, type SortState } from '@/modules/reports/sort'
import { EXPENSE_TABS, parseExpenseTab, detailedExpenseQuery, detailedRange, type ExpenseGroupRow, type ExpenseTab } from '@/modules/reports/expenseSummary'
import { expenseSummary } from '@/modules/reports/expenseSummarySql'

export const dynamic = 'force-dynamic'

const SORT_KEYS = ['name', 'count', 'cost', 'billable'] as const
type SortKey = (typeof SORT_KEYS)[number]
const DETAILED = '/reports/detailed/expenses'
const NAME_HEADER: Record<ExpenseTab, string> = { clients: 'Client', projects: 'Project', categories: 'Category', team: 'Teammate' }

/**
 * Reports → Expenses (specs/26 §7). Members see only their own expenses; `run_account_reports` sees the
 * whole account (AC-EXP-101/102). Totals and groupings are aggregated in Postgres (AC-EXP-106).
 */
export default async function ExpensesReportPage({
  searchParams,
}: {
  searchParams: TimeframeParams & { sort?: string; dir?: string; tab?: string }
}) {
  const me = await requireUser()
  const { accountId, userId, permissionProfile, permissionOverrides } = me
  await requireModule(accountId, 'expenseTracking')
  const canRunAll = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'run_account_reports')
  const sort = parseSort<SortKey>(searchParams, SORT_KEYS, { key: 'name', dir: 'asc' })
  const tab = parseExpenseTab(searchParams.tab)

  // Harvest: reports open on This week (week start per account preference, Monday by default).
  const tf = resolveTimeframe(searchParams, { defaultPeriod: 'week', weekStartsOn: await accountWeekStartsOn(accountId) })
  const tfq = timeframeQuery(tf)
  const tabq = tab === 'clients' ? {} : { tab }
  const sortq = sort.key === 'name' && sort.dir === 'asc' ? {} : { sort: sort.key, dir: sort.dir }
  const sortHref = (s: SortState<SortKey>) => buildHref('/reports/expenses', { ...tfq, ...tabq, sort: s.key, dir: s.dir })

  const { totals, rows } = await expenseSummary({ accountId, onlyUserId: canRunAll ? null : userId }, tf, tab)
  const sorted = sortRows(rows, sort, {
    name: (r: ExpenseGroupRow) => r.name,
    count: (r: ExpenseGroupRow) => r.count,
    cost: (r: ExpenseGroupRow) => r.totalCents,
    billable: (r: ExpenseGroupRow) => r.billableCents,
  })
  const drill = (id: string) => buildHref(DETAILED, detailedExpenseQuery(tf, tab, id))

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Reports</h1>
        {canRunAll && (
          <a href={buildHref('/reports/expenses/export', tfq)} className="text-sm text-brand-teal hover:underline">Export CSV</a>
        )}
      </div>
      <ReportsTabs active="Expenses" timeframe={tfq} />
      <ReportTimeframe basePath="/reports/expenses" tf={tf} keep={{ ...tabq, ...sortq }} />

      <div className="mb-6 grid gap-4 rounded-lg border border-gray-200 bg-white p-5 sm:grid-cols-4">
        <Stat label="Total amount" value={formatCents(totals.totalCents)} sub={`${totals.count.toLocaleString()} expense${totals.count === 1 ? '' : 's'}`} />
        <Stat label="Billable amount" value={formatCents(totals.billableCents)} sub="Includes markup" accent="text-brand-green" />
        <Stat label="Non-billable" value={formatCents(totals.nonBillableCents)} sub="Not billed to clients" />
        <Stat label="Uninvoiced amount" value={formatCents(totals.uninvoicedCents)} sub="Billable, not yet invoiced" />
      </div>

      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200">
        <nav className="flex gap-1" aria-label="Group by">
          {EXPENSE_TABS.map((t) => (
            <Link
              key={t.key}
              href={buildHref('/reports/expenses', { ...tfq, ...(t.key === 'clients' ? {} : { tab: t.key }), ...sortq })}
              scroll={false}
              aria-current={t.key === tab ? 'page' : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${t.key === tab ? 'border-brand-orange font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <Link href={buildHref(DETAILED, detailedRange(tf))} className="mb-2 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-800 shadow-sm hover:bg-gray-50">
          Detailed report
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <SortableTh label={NAME_HEADER[tab]} col="name" sort={sort} hrefFor={sortHref} />
              {tab === 'projects' && <th className="px-4 py-3 font-medium">Client</th>}
              <SortableTh label="Expenses" col="count" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
              <SortableTh label="Amount" col="cost" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
              <SortableTh label="Billable amount" col="billable" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="px-4 py-2.5">
                  <Link href={drill(r.id)} className="text-gray-900 hover:text-brand-teal hover:underline">{r.name}</Link>
                </td>
                {tab === 'projects' && <td className="px-4 py-2.5 text-gray-600">{r.clientName}</td>}
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{r.count}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <Link href={drill(r.id)} className="text-blue-600 underline hover:no-underline">{formatCents(r.totalCents)}</Link>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{r.billableCents ? formatCents(r.billableCents) : '—'}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={tab === 'projects' ? 5 : 4} className="px-4 py-8 text-center text-gray-400">No expenses in this period.</td>
              </tr>
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 font-semibold">
                <td className="px-4 py-3" colSpan={tab === 'projects' ? 2 : 1}>Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{totals.count}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCents(totals.totalCents)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCents(totals.billableCents)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {!canRunAll && <p className="mt-3 text-xs text-gray-500">Showing only your own expenses.</p>}
    </div>
  )
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: string }) {
  return (
    <div>
      <div className="text-sm text-gray-600">{label}</div>
      <div className={`mt-1 whitespace-nowrap text-2xl font-semibold tabular-nums ${accent ?? 'text-gray-900'}`}>{value}</div>
      <div className="mt-0.5 text-xs text-gray-400">{sub}</div>
    </div>
  )
}
