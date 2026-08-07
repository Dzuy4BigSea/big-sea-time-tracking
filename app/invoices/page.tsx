import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { displayBadge, type StoredStatus } from '@/modules/invoicing/invoiceState'
import { formatCents, formatDate } from '@/lib/format'
import { BADGE_STYLES, BADGE_LABEL } from '@/lib/labels'
import { generateInvoiceAction } from '@/app/invoices/actions'
import { createBlankInvoiceAction } from '@/app/invoices/[id]/edit/actions'
import { requireUser } from '@/lib/session'
import { requireModule } from '@/lib/modules'

// Reads live data on every request (no build-time prerender).
export const dynamic = 'force-dynamic'

const dayDiff = (due: Date, today: Date) =>
  Math.round(
    (Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()) -
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) /
      86_400_000,
  )

/** Harvest-style relative due label. */
function dueLabel(
  status: string,
  dueDate: Date | null,
  today: Date,
): { text: string; overdue: boolean } {
  if (status === 'draft') return { text: 'Not sent yet', overdue: false }
  if (status === 'paid') return { text: 'Paid', overdue: false }
  if (status === 'written_off') return { text: 'Written off', overdue: false }
  if (status === 'closed') return { text: 'Closed', overdue: false }
  if (!dueDate) return { text: '—', overdue: false }
  const d = dayDiff(dueDate, today)
  if (d === 0) return { text: 'Due today', overdue: false }
  if (d > 0) return { text: `Due in ${d} day${d === 1 ? '' : 's'}`, overdue: false }
  const n = Math.abs(d)
  return { text: `Overdue by ${n} day${n === 1 ? '' : 's'}`, overdue: true }
}

export default async function InvoicesPage({ searchParams }: { searchParams: { nothing?: string } }) {
  const { accountId } = await requireUser()
  await requireModule(accountId, 'invoices')
  const [invoices, clients] = await Promise.all([
    prisma.invoice.findMany({
      where: { accountId },
      include: { client: true },
      orderBy: [{ issueDate: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
    }),
    prisma.client.findMany({ where: { accountId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])

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

      <form action={generateInvoiceAction} className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">New invoice from tracked time &amp; expenses</span>
          <select name="clientId" className="min-w-56 rounded border border-gray-300 px-2 py-1.5 text-sm">
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">
          Generate draft
        </button>
        <span className="pb-1.5 text-xs text-gray-300">or</span>
        <button formAction={createBlankInvoiceAction} className="rounded border border-brand-green px-4 py-1.5 text-sm font-medium text-brand-green hover:bg-green-50">
          New blank invoice
        </button>
        {searchParams.nothing && <span className="text-sm text-gray-500">No uninvoiced time or expenses for that client.</span>}
      </form>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:max-w-md">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-400">Total open</div>
          <div className="mt-1 text-2xl font-semibold">{formatCents(totalOpen)}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-400">Total paid</div>
          <div className="mt-1 text-2xl font-semibold">{formatCents(totalPaid)}</div>
          <div className="mt-0.5 text-xs text-gray-400">Excluding retainer deposits</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Due</th>
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
              const due = dueLabel(inv.status, inv.dueDate, today)
              return (
                <tr key={inv.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_STYLES[badge]}`}>
                      {BADGE_LABEL[badge]}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-sm ${due.overdue ? 'font-medium text-red-600' : 'text-gray-500'}`}>{due.text}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(inv.issueDate)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${inv.id}`} className="text-gray-700 hover:text-brand-teal">
                      {inv.number ?? <span className="text-gray-400">Draft</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${inv.id}`} className="font-medium text-gray-900 hover:text-brand-teal">
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
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
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
