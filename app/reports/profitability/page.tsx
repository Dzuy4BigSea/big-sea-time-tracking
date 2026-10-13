import { accountWeekStartsOn } from '@/lib/accountPrefs'
import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { ReportsTabs } from '@/components/ReportsTabs'
import { Prisma } from '@prisma/client'
import { requireCapability } from '@/lib/session'
import { ReportTimeframe } from '@/components/ReportTimeframe'
import { SortableTh } from '@/components/SortableTh'
import { resolveTimeframe, timeframeQuery, buildHref, type TimeframeParams } from '@/modules/shared/timeframe'
import { parseSort, sortRows, type SortState } from '@/modules/reports/sort'

export const dynamic = 'force-dynamic'

const SORT_KEYS = ['name', 'revenue', 'cost', 'margin', 'pct'] as const
type SortKey = (typeof SORT_KEYS)[number]

export default async function ProfitabilityPage({
  searchParams,
}: {
  searchParams: TimeframeParams & { sort?: string; dir?: string }
}) {
  // Money report: account-wide reports permission (Accounting / Executive / Admin).
  const { accountId } = await requireCapability('run_account_reports')
  const sort = parseSort<SortKey>(searchParams, SORT_KEYS, { key: 'revenue', dir: 'desc' })
  // Harvest: reports open on This week (week start per account preference, Monday by default).
  const tf = resolveTimeframe(searchParams, { defaultPeriod: 'week', weekStartsOn: await accountWeekStartsOn(accountId) })
  const tfq = timeframeQuery(tf)
  const sortq = sort.key === 'revenue' && sort.dir === 'desc' ? {} : { sort: sort.key, dir: sort.dir }
  const sortHref = (s: SortState<SortKey>) => buildHref('/reports/profitability', { ...tfq, sort: s.key, dir: s.dir })
  const dateFilter = Prisma.sql`${tf.from ? Prisma.sql`AND te."spentDate" >= ${tf.from}` : Prisma.empty} ${tf.till ? Prisma.sql`AND te."spentDate" <= ${tf.till}` : Prisma.empty}`
  // Revenue aggregated in the DB per project (never load 388k entries). Internal cost needs
  // effective-dated person cost rates, which aren't imported from Harvest yet — so cost is 0 until
  // that backfill (see specs/19). Margin therefore equals revenue for now.
  const [raw, costRateCount] = await Promise.all([
    prisma.$queryRaw<{ key: string; revenue: number }[]>`
      SELECT (c.name || ' — ' || p.name) AS key,
        SUM(CASE WHEN te."isBillable" THEN te.minutes/60.0*COALESCE(te."billableRateCents",0) ELSE 0 END)::float8 AS revenue
      FROM "TimeEntry" te JOIN "Project" p ON p.id = te."projectId" JOIN "Client" c ON c.id = p."clientId"
      WHERE te."accountId" = ${accountId} ${dateFilter}
      GROUP BY c.name, p.name HAVING SUM(te.minutes) > 0 ORDER BY revenue DESC`,
    prisma.personCostRate.count({ where: { accountId } }),
  ])

  const pct = (r: { revenue: number; cost: number }) => (r.revenue > 0 ? Math.round(((r.revenue - r.cost) / r.revenue) * 100) : null)
  const rows = sortRows(
    raw.map((r): [string, { revenue: number; cost: number }] => [r.key, { revenue: Math.round(Number(r.revenue)), cost: 0 }]),
    sort,
    {
      name: ([k]) => k,
      revenue: ([, r]) => r.revenue,
      cost: ([, r]) => r.cost,
      margin: ([, r]) => r.revenue - r.cost,
      pct: ([, r]) => pct(r),
    },
  )
  const totals = rows.reduce((a, [, r]) => ({ revenue: a.revenue + r.revenue, cost: a.cost + r.cost }), { revenue: 0, cost: 0 })

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Reports</h1>
      <p className="mb-4 text-sm text-gray-500">Profitability · revenue vs internal cost · live from Supabase</p>
      <ReportsTabs active="Profitability" timeframe={tfq} />
      <ReportTimeframe basePath="/reports/profitability" tf={tf} keep={sortq} />

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <SortableTh label="Project" col="name" sort={sort} hrefFor={sortHref} />
              <SortableTh label="Revenue" col="revenue" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
              <SortableTh label="Cost" col="cost" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
              <SortableTh label="Margin" col="margin" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
              <SortableTh label="Margin %" col="pct" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, r]) => {
              const margin = r.revenue - r.cost
              const p = pct(r)
              return (
                <tr key={key} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900">{key}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatCents(r.revenue)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-500">{formatCents(r.cost)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${margin < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    {formatCents(margin)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-600">{p == null ? '—' : `${p}%`}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No tracked time in this period.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 font-medium">
                <td className="px-4 py-3 text-xs uppercase tracking-wide text-gray-400">Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCents(totals.revenue)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{formatCents(totals.cost)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCents(totals.revenue - totals.cost)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                  {pct(totals) == null ? '—' : `${pct(totals)}%`}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        {costRateCount > 0
          ? 'Cost uses effective-dated person cost rates (Admin-only).'
          : 'Internal cost rates aren’t imported from Harvest yet, so Cost shows $0 and Margin = Revenue. Backfill cost rates to populate (specs/19).'}
      </p>
    </div>
  )
}
