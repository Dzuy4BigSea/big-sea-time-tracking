import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { effectiveRate, type EffectiveRate } from '@/modules/projects/resolveRate'
import { ReportsTabs } from '@/components/ReportsTabs'
import { requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function ProfitabilityPage() {
  const { accountId } = await requireUser()
  const [entries, costRates] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { accountId },
      select: {
        userId: true,
        minutes: true,
        isBillable: true,
        billableRateCents: true,
        spentDate: true,
        project: { select: { name: true, client: { select: { name: true } } } },
      },
    }),
    prisma.personCostRate.findMany({
      where: { accountId },
      select: { userId: true, hourlyRateCents: true, startDate: true, endDate: true },
    }),
  ])

  // Effective-dated cost rates per user (revenue is the entry's snapshotted billable rate).
  const ratesByUser = new Map<string, EffectiveRate[]>()
  for (const r of costRates) {
    const list = ratesByUser.get(r.userId) ?? []
    list.push({ hourlyRateCents: r.hourlyRateCents, startDate: r.startDate, endDate: r.endDate })
    ratesByUser.set(r.userId, list)
  }

  type Row = { revenue: number; cost: number }
  const byProject = new Map<string, Row & { client: string }>()
  const totals: Row = { revenue: 0, cost: 0 }

  for (const e of entries) {
    const hours = e.minutes / 60
    const revenue = e.isBillable && e.billableRateCents ? Math.round(hours * e.billableRateCents) : 0
    const costRate = effectiveRate(ratesByUser.get(e.userId), e.spentDate)
    const cost = costRate ? Math.round(hours * costRate) : 0
    const key = `${e.project.client.name} — ${e.project.name}`
    const row = byProject.get(key) ?? { revenue: 0, cost: 0, client: e.project.client.name }
    row.revenue += revenue
    row.cost += cost
    byProject.set(key, row)
    totals.revenue += revenue
    totals.cost += cost
  }

  const rows = [...byProject.entries()].sort((a, b) => b[1].revenue - b[1].cost - (a[1].revenue - a[1].cost))
  const pct = (r: Row) => (r.revenue > 0 ? Math.round(((r.revenue - r.cost) / r.revenue) * 100) : null)

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
        Cost uses effective-dated person cost rates (Admin-only in the real permission model).
      </p>
    </div>
  )
}
