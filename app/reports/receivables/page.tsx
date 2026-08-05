import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { ReportsTabs } from '@/components/ReportsTabs'
import { requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

const dayMs = 24 * 60 * 60 * 1000

type Buckets = { current: number; d1_30: number; d31_60: number; d60plus: number; total: number }
const emptyBuckets = (): Buckets => ({ current: 0, d1_30: 0, d31_60: 0, d60plus: 0, total: 0 })

export default async function ReceivablesPage() {
  const { accountId } = await requireUser()
  const invoices = await prisma.invoice.findMany({
    where: { accountId, status: 'open' },
    select: { totalCents: true, paidCents: true, dueDate: true, client: { select: { name: true } } },
  })

  const now = Date.now()
  const byClient = new Map<string, Buckets>()
  const totals = emptyBuckets()

  for (const inv of invoices) {
    const balance = inv.totalCents - inv.paidCents
    if (balance <= 0) continue
    const overdueDays = inv.dueDate ? Math.floor((now - inv.dueDate.getTime()) / dayMs) : 0
    const bucket: keyof Buckets =
      overdueDays <= 0 ? 'current' : overdueDays <= 30 ? 'd1_30' : overdueDays <= 60 ? 'd31_60' : 'd60plus'

    const b = byClient.get(inv.client.name) ?? emptyBuckets()
    b[bucket] += balance
    b.total += balance
    totals[bucket] += balance
    totals.total += balance
    byClient.set(inv.client.name, b)
  }

  const rows = [...byClient.entries()].sort((a, b) => b[1].total - a[1].total)

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Reports</h1>
      <p className="mb-4 text-sm text-gray-500">Receivables (A/R aging) · open invoices · live from Supabase</p>
      <ReportsTabs active="Receivables" />

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 text-right font-medium">Current</th>
              <th className="px-4 py-3 text-right font-medium">1–30</th>
              <th className="px-4 py-3 text-right font-medium">31–60</th>
              <th className="px-4 py-3 text-right font-medium">60+</th>
              <th className="px-4 py-3 text-right font-medium">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([client, b]) => (
              <tr key={client} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 font-medium text-gray-900">{client}</td>
                <Cell v={b.current} />
                <Cell v={b.d1_30} />
                <Cell v={b.d31_60} />
                <Cell v={b.d60plus} warn />
                <td className="px-4 py-3 text-right font-medium tabular-nums">{formatCents(b.total)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No outstanding invoices.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 font-medium">
                <td className="px-4 py-3 text-xs uppercase tracking-wide text-gray-400">Total</td>
                <Cell v={totals.current} />
                <Cell v={totals.d1_30} />
                <Cell v={totals.d31_60} />
                <Cell v={totals.d60plus} warn />
                <td className="px-4 py-3 text-right tabular-nums">{formatCents(totals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

function Cell({ v, warn }: { v: number; warn?: boolean }) {
  return (
    <td className={`px-4 py-3 text-right tabular-nums ${warn && v > 0 ? 'text-red-600' : 'text-gray-600'}`}>
      {v > 0 ? formatCents(v) : '—'}
    </td>
  )
}
