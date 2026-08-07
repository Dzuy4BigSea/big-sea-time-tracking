import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { ReportsTabs } from '@/components/ReportsTabs'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'

export const dynamic = 'force-dynamic'

const billed = (totalCents: number, markup: unknown) => Math.round(totalCents * (1 + (markup ? Number(markup) : 0) / 100))

export default async function ExpensesReportPage() {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  const canExport = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'run_account_reports')
  const expenses = await prisma.expense.findMany({
    where: { accountId },
    select: {
      totalCents: true,
      markupPercent: true,
      isBillable: true,
      category: { select: { name: true } },
      project: { select: { name: true, client: { select: { name: true } } } },
    },
  })

  type Row = { count: number; cost: number; billable: number }
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

  const cats = [...byCategory.entries()].sort((a, b) => b[1].cost - a[1].cost)
  const clients = [...byClient.entries()].sort((a, b) => b[1].cost - a[1].cost)

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Reports</h1>
        {canExport && (
          <a href="/reports/expenses/export" className="text-sm text-brand-teal hover:underline">Export CSV</a>
        )}
      </div>
      <ReportsTabs active="Expenses" />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Tile label="Total expenses" value={formatCents(totals.cost)} sub={`${totals.count} entries`} />
        <Tile label="Billable (with markup)" value={formatCents(totals.billable)} sub="what clients are billed" accent="text-brand-green" />
        <Tile label="Non-billable" value={formatCents(totals.cost - expenses.filter((e) => e.isBillable).reduce((s, e) => s + e.totalCents, 0))} sub="absorbed cost" />
      </div>

      <Grouping title="By category" rows={cats} />
      <div className="h-6" />
      <Grouping title="By client" rows={clients} />
    </div>
  )
}

function Grouping({ title, rows }: { title: string; rows: [string, { count: number; cost: number; billable: number }][] }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-gray-700">{title}</h2>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">{title.replace('By ', '')}</th>
              <th className="px-4 py-3 text-right font-medium">Entries</th>
              <th className="px-4 py-3 text-right font-medium">Cost</th>
              <th className="px-4 py-3 text-right font-medium">Billable</th>
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
            {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No expenses.</td></tr>}
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
