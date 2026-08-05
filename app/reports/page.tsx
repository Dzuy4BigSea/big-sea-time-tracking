import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { isUninvoiced } from '@/modules/invoicing/uninvoiced'
import { ReportsTabs } from '@/components/ReportsTabs'
import { requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

const hrs = (m: number) => (m / 60).toLocaleString(undefined, { maximumFractionDigits: 2 })

export default async function ReportsPage() {
  const { accountId } = await requireUser()
  const entries = await prisma.timeEntry.findMany({
    where: { accountId },
    select: {
      minutes: true,
      isBillable: true,
      billableRateCents: true,
      invoiceLineItemId: true,
      lockState: true,
      project: { select: { name: true, client: { select: { name: true } } } },
    },
  })

  type Agg = { minutes: number; billableMinutes: number; billableCents: number; uninvoicedCents: number }
  const empty = (): Agg => ({ minutes: 0, billableMinutes: 0, billableCents: 0, uninvoicedCents: 0 })
  const byClient = new Map<string, Agg>()
  const totals = empty()

  for (const e of entries) {
    const key = e.project.client.name
    const a = byClient.get(key) ?? empty()
    const amount = e.isBillable && e.billableRateCents ? Math.round((e.minutes / 60) * e.billableRateCents) : 0
    a.minutes += e.minutes
    totals.minutes += e.minutes
    if (e.isBillable) {
      a.billableMinutes += e.minutes
      totals.billableMinutes += e.minutes
    }
    a.billableCents += amount
    totals.billableCents += amount
    if (isUninvoiced({ isBillable: e.isBillable, invoiceLineItemId: e.invoiceLineItemId, lockState: e.lockState })) {
      a.uninvoicedCents += amount
      totals.uninvoicedCents += amount
    }
    byClient.set(key, a)
  }

  const rows = [...byClient.entries()].sort((x, y) => y[1].minutes - x[1].minutes)

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Reports</h1>
      <p className="mb-4 text-sm text-gray-500">Time report · grouped by client · live from Supabase</p>
      <ReportsTabs active="Time" />

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 text-right font-medium">Hours</th>
              <th className="px-4 py-3 text-right font-medium">Billable hours</th>
              <th className="px-4 py-3 text-right font-medium">Billable amount</th>
              <th className="px-4 py-3 text-right font-medium">Uninvoiced</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([client, a]) => (
              <tr key={client} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 font-medium text-gray-900">{client}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{hrs(a.minutes)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{hrs(a.billableMinutes)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{a.billableCents ? formatCents(a.billableCents) : '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                  {a.uninvoicedCents ? formatCents(a.uninvoicedCents) : '—'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No tracked time yet.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 font-medium">
                <td className="px-4 py-3 text-xs uppercase tracking-wide text-gray-400">Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{hrs(totals.minutes)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{hrs(totals.billableMinutes)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCents(totals.billableCents)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCents(totals.uninvoicedCents)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
