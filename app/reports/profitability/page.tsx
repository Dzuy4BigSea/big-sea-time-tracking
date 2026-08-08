import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { ReportsTabs } from '@/components/ReportsTabs'
import { requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function ProfitabilityPage() {
  const { accountId } = await requireUser()
  // Revenue aggregated in the DB per project (never load 388k entries). Internal cost needs
  // effective-dated person cost rates, which aren't imported from Harvest yet — so cost is 0 until
  // that backfill (see specs/19). Margin therefore equals revenue for now.
  const [raw, costRateCount] = await Promise.all([
    prisma.$queryRaw<{ key: string; revenue: number }[]>`
      SELECT (c.name || ' — ' || p.name) AS key,
        SUM(CASE WHEN te."isBillable" THEN te.minutes/60.0*COALESCE(te."billableRateCents",0) ELSE 0 END)::float8 AS revenue
      FROM "TimeEntry" te JOIN "Project" p ON p.id = te."projectId" JOIN "Client" c ON c.id = p."clientId"
      WHERE te."accountId" = ${accountId}
      GROUP BY c.name, p.name HAVING SUM(te.minutes) > 0 ORDER BY revenue DESC`,
    prisma.personCostRate.count({ where: { accountId } }),
  ])

  const rows: [string, { revenue: number; cost: number }][] = raw.map((r) => [r.key, { revenue: Math.round(Number(r.revenue)), cost: 0 }])
  const totals = rows.reduce((a, [, r]) => ({ revenue: a.revenue + r.revenue, cost: a.cost + r.cost }), { revenue: 0, cost: 0 })
  const pct = (r: { revenue: number; cost: number }) => (r.revenue > 0 ? Math.round(((r.revenue - r.cost) / r.revenue) * 100) : null)

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Reports</h1>
      <p className="mb-4 text-sm text-gray-500">Profitability · revenue vs internal cost · live from Supabase</p>
      <ReportsTabs active="Profitability" />

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 text-right font-medium">Revenue</th>
              <th className="px-4 py-3 text-right font-medium">Cost</th>
              <th className="px-4 py-3 text-right font-medium">Margin</th>
              <th className="px-4 py-3 text-right font-medium">Margin %</th>
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
                  No data.
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
