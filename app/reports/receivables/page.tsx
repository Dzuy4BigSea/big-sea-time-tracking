import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { ReportsTabs } from '@/components/ReportsTabs'
import { requireUser } from '@/lib/session'
import { SortableTh } from '@/components/SortableTh'
import { buildHref } from '@/modules/shared/timeframe'
import { parseSort, sortRows, type SortState } from '@/modules/reports/sort'

export const dynamic = 'force-dynamic'

const dayMs = 24 * 60 * 60 * 1000

type Buckets = { current: number; d1_30: number; d31_60: number; d60plus: number; total: number }
const emptyBuckets = (): Buckets => ({ current: 0, d1_30: 0, d31_60: 0, d60plus: 0, total: 0 })

const SORT_KEYS = ['client', 'current', 'd1_30', 'd31_60', 'd60plus', 'total'] as const
type SortKey = (typeof SORT_KEYS)[number]

export default async function ReceivablesPage({ searchParams }: { searchParams: { sort?: string; dir?: string } }) {
  const { accountId } = await requireUser()
  const sort = parseSort<SortKey>(searchParams, SORT_KEYS, { key: 'total', dir: 'desc' })
  const sortHref = (s: SortState<SortKey>) => buildHref('/reports/receivables', { sort: s.key, dir: s.dir })
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

  const rows = sortRows([...byClient.entries()], sort, {
    client: ([c]) => c,
    current: ([, b]) => b.current,
    d1_30: ([, b]) => b.d1_30,
    d31_60: ([, b]) => b.d31_60,
    d60plus: ([, b]) => b.d60plus,
    total: ([, b]) => b.total,
  })

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Reports</h1>
      <p className="mb-4 text-sm text-gray-500">Receivables (A/R aging) · open invoices as of today · live from Supabase</p>
      <ReportsTabs active="Receivables" />

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <SortableTh label="Client" col="client" sort={sort} hrefFor={sortHref} />
              <SortableTh label="Current" col="current" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
              <SortableTh label="1–30" col="d1_30" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
              <SortableTh label="31–60" col="d31_60" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
              <SortableTh label="60+" col="d60plus" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
              <SortableTh label="Outstanding" col="total" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
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
