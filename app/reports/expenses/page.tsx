import { accountWeekStartsOn } from '@/lib/accountPrefs'
import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { ReportsTabs } from '@/components/ReportsTabs'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { ReportTimeframe } from '@/components/ReportTimeframe'
import { SortableTh } from '@/components/SortableTh'
import { resolveTimeframe, timeframeQuery, buildHref, type TimeframeParams } from '@/modules/shared/timeframe'
import { parseSort, sortRows, type SortState } from '@/modules/reports/sort'

export const dynamic = 'force-dynamic'

const billed = (totalCents: number, markup: unknown) => Math.round(totalCents * (1 + (markup ? Number(markup) : 0) / 100))

const SORT_KEYS = ['name', 'count', 'cost', 'billable'] as const
type SortKey = (typeof SORT_KEYS)[number]
type Row = { count: number; cost: number; billable: number }

export default async function ExpensesReportPage({
  searchParams,
}: {
  searchParams: TimeframeParams & { sort?: string; dir?: string }
}) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  const canExport = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'run_account_reports')
  const sort = parseSort<SortKey>(searchParams, SORT_KEYS, { key: 'cost', dir: 'desc' })

  // Harvest: reports open on This week (week start per account preference, Monday by default).
  const tf = resolveTimeframe(searchParams, { defaultPeriod: 'week', weekStartsOn: await accountWeekStartsOn(accountId) })
  const tfq = timeframeQuery(tf)
  const sortq = sort.key === 'cost' && sort.dir === 'desc' ? {} : { sort: sort.key, dir: sort.dir }
  const sortHref = (s: SortState<SortKey>) => buildHref('/reports/expenses', { ...tfq, sort: s.key, dir: s.dir })

  const expenses = await prisma.expense.findMany({
    where: {
      accountId,
      ...(tf.from || tf.till ? { spentDate: { ...(tf.from ? { gte: tf.from } : {}), ...(tf.till ? { lte: tf.till } : {}) } } : {}),
    },
    select: {
      totalCents: true,
      markupPercent: true,
      isBillable: true,
      category: { select: { name: true } },
      project: { select: { name: true, client: { select: { name: true } } } },
    },
  })

  const byCategory = new Map<string, Row>()
  const byClient = new Map<string, Row>()
  const totals: Row = { count: 0, cost: 0, billable: 0 }
  const bump = (map: Map<string, Row>, key: string, e: (typeof expenses)[number]) => {
    const r = map.get(key) ?? { count: 0, cost: 0, billable: 0 }
    r.count += 1
    r.cost += e.totalCents
    r.billable += e.isBillable ? billed(e.totalCents, e.markupPercent) : 0
    map.set(key, r)
  }
  for (const e of expenses) {
    bump(byCategory, e.category.name, e)
    bump(byClient, e.project.client.name, e)
    totals.count += 1
    totals.cost += e.totalCents
    totals.billable += e.isBillable ? billed(e.totalCents, e.markupPercent) : 0
  }

  // Both groupings share columns, so one sort applies to both (rows are already aggregated).
  const accessors = {
    name: (e: [string, Row]) => e[0],
    count: (e: [string, Row]) => e[1].count,
    cost: (e: [string, Row]) => e[1].cost,
    billable: (e: [string, Row]) => e[1].billable,
  }
  const cats = sortRows([...byCategory.entries()], sort, accessors)
  const clients = sortRows([...byClient.entries()], sort, accessors)

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Reports</h1>
        {canExport && (
          <a href={buildHref('/reports/expenses/export', tfq)} className="text-sm text-brand-teal hover:underline">Export CSV</a>
        )}
      </div>
      <ReportsTabs active="Expenses" timeframe={tfq} />
      <ReportTimeframe basePath="/reports/expenses" tf={tf} keep={sortq} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Tile label="Total expenses" value={formatCents(totals.cost)} sub={`${totals.count} entries`} />
        <Tile label="Billable (with markup)" value={formatCents(totals.billable)} sub="what clients are billed" accent="text-brand-green" />
        <Tile label="Non-billable" value={formatCents(totals.cost - expenses.filter((e) => e.isBillable).reduce((s, e) => s + e.totalCents, 0))} sub="absorbed cost" />
      </div>

      <Grouping title="By category" rows={cats} sort={sort} sortHref={sortHref} />
      <div className="h-6" />
      <Grouping title="By client" rows={clients} sort={sort} sortHref={sortHref} />
    </div>
  )
}

function Grouping({
  title,
  rows,
  sort,
  sortHref,
}: {
  title: string
  rows: [string, Row][]
  sort: SortState<SortKey>
  sortHref: (s: SortState<SortKey>) => string
}) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-gray-700">{title}</h2>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <SortableTh label={title.replace('By ', '')} col="name" sort={sort} hrefFor={sortHref} />
              <SortableTh label="Entries" col="count" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
              <SortableTh label="Cost" col="cost" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
              <SortableTh label="Billable" col="billable" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, r]) => (
              <tr key={name} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-2 text-gray-800">{name}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500">{r.count}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-700">{formatCents(r.cost)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-brand-green">{formatCents(r.billable)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No expenses in this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ?? 'text-gray-900'}`}>{value}</div>
      <div className="mt-0.5 text-xs text-gray-400">{sub}</div>
    </div>
  )
}
