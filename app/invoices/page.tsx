import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { displayBadge, type StoredStatus } from '@/modules/invoicing/invoiceState'
import { formatCents, formatDate } from '@/lib/format'
import { BADGE_STYLES, BADGE_LABEL } from '@/lib/labels'

// Reads live data on every request (no build-time prerender).
export const dynamic = 'force-dynamic'

export default async function InvoicesPage() {
  const invoices = await prisma.invoice.findMany({
    include: { client: true },
    orderBy: [{ issueDate: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
  })

  const today = new Date()
  const totalOpen = invoices
    .filter((i) => i.status === 'open')
    .reduce((s, i) => s + (i.totalCents - i.paidCents), 0)
  const totalPaid = invoices.reduce((s, i) => s + i.paidCents, 0)

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Invoices</h1>
      <p className="mb-6 text-sm text-gray-500">
        Reading live from Supabase · {invoices.length} invoice{invoices.length === 1 ? '' : 's'}
      </p>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:max-w-md">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-400">Total open</div>
          <div className="mt-1 text-2xl font-semibold">{formatCents(totalOpen)}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-400">Total paid</div>
          <div className="mt-1 text-2xl font-semibold">{formatCents(totalPaid)}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Issue date</th>
              <th className="px-4 py-3 font-medium">Number</th>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => {
              const badge = displayBadge(
                {
                  status: inv.status as StoredStatus,
                  sentAt: inv.sentAt,
                  dueDate: inv.dueDate,
                  totalCents: inv.totalCents,
                  paidCents: inv.paidCents,
                },
                today,
              )
              const balance = inv.totalCents - inv.paidCents
              return (
                <tr key={inv.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_STYLES[badge]}`}>
                      {BADGE_LABEL[badge]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(inv.issueDate)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${inv.id}`} className="text-gray-700 hover:text-brand-orange">
                      {inv.number ?? <span className="text-gray-400">Draft</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${inv.id}`} className="font-medium text-gray-900 hover:text-brand-orange">
                      {inv.client.name}
                    </Link>
                    {inv.subject && <div className="text-xs text-gray-500">{inv.subject}</div>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{formatCents(balance, inv.currency)}</td>
                </tr>
              )
            })}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No invoices yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
