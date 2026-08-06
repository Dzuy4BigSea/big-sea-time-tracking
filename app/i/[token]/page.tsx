import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { displayBadge, type StoredStatus } from '@/modules/invoicing/invoiceState'
import { formatCents, formatDate } from '@/lib/format'
import { BADGE_STYLES, BADGE_LABEL, PAYMENT_TERM_LABEL, PAYMENT_METHOD_LABEL } from '@/lib/labels'

export const dynamic = 'force-dynamic'

const BRAND = '#004348' // Big Sea teal (until per-account InvoiceAppearance is wired)

export const metadata: Metadata = {
  title: 'Invoice',
  robots: { index: false, follow: false }, // public-by-link, but keep it out of search indexes
}

async function loadInvoice(token: string) {
  if (!token) return null
  return prisma.invoice.findUnique({
    where: { publicToken: token },
    include: {
      client: true,
      account: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
      payments: { orderBy: { paidOn: 'asc' } },
    },
  })
}

export default async function PublicInvoicePage({ params }: { params: { token: string } }) {
  const invoice = await loadInvoice(params.token)
  // Only sent invoices are shareable. Drafts have no publicToken, so this also covers them.
  if (!invoice || invoice.status === 'draft') notFound()

  const badge = displayBadge(
    {
      status: invoice.status as StoredStatus,
      sentAt: invoice.sentAt,
      dueDate: invoice.dueDate,
      totalCents: invoice.totalCents,
      paidCents: invoice.paidCents,
    },
    new Date(),
  )
  const due = invoice.totalCents - invoice.paidCents
  const cur = invoice.currency

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* Summary banner */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-white p-5 shadow-sm">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">Invoice {invoice.number ?? ''} from</div>
          <div className="text-lg font-semibold" style={{ color: BRAND }}>
            {invoice.account.name}
          </div>
        </div>
        <div className="text-right">
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_STYLES[badge]}`}>
            {BADGE_LABEL[badge]}
          </span>
          <div className="mt-1 text-xs uppercase tracking-wide text-gray-400">Amount due</div>
          <div className="text-2xl font-bold" style={{ color: BRAND }}>
            {formatCents(due, cur)}
          </div>
        </div>
      </div>

      {/* Rendered invoice document */}
      <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between">
          <div className="text-lg font-semibold tracking-tight">{invoice.account.name}</div>
          <div className="text-2xl font-bold tracking-wide" style={{ color: BRAND }}>
            INVOICE
          </div>
        </div>

        <div className="mt-8 flex justify-between gap-8 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400">Invoice for</div>
            <div className="mt-1 font-medium">{invoice.client.name}</div>
            {invoice.client.address && <div className="whitespace-pre-line text-gray-600">{invoice.client.address}</div>}
          </div>
          <div className="text-right">
            <dl className="space-y-1">
              <Row label="Invoice ID" value={invoice.number ?? '—'} />
              <Row label="Issue date" value={formatDate(invoice.issueDate)} />
              <Row
                label="Due date"
                value={`${formatDate(invoice.dueDate)}${
                  invoice.dueDate ? ` (${PAYMENT_TERM_LABEL[invoice.paymentTerm] ?? invoice.paymentTerm})` : ''
                }`}
              />
              {invoice.poNumber && <Row label="PO number" value={invoice.poNumber} />}
            </dl>
          </div>
        </div>

        {invoice.subject && (
          <div className="mt-6 text-sm">
            <span className="text-xs uppercase tracking-wide text-gray-400">Subject</span>
            <div className="mt-1">{invoice.subject}</div>
          </div>
        )}

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Unit price</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((li) => (
              <tr key={li.id} className="border-b border-gray-100">
                <td className="py-2 pr-4">{li.description}</td>
                <td className="py-2 text-right text-gray-600">{Number(li.quantity)}</td>
                <td className="py-2 text-right text-gray-600">{formatCents(li.unitPriceCents, cur)}</td>
                <td className="py-2 text-right">{formatCents(li.amountCents, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <dl className="w-64 space-y-1 text-sm">
            <TotalRow label="Subtotal" value={formatCents(invoice.subtotalCents, cur)} />
            {invoice.discountCents > 0 && <TotalRow label="Discount" value={`−${formatCents(invoice.discountCents, cur)}`} />}
            {invoice.taxCents > 0 && <TotalRow label="Tax" value={formatCents(invoice.taxCents, cur)} />}
            <div className="border-t border-gray-200 pt-1">
              <TotalRow label="Total" value={formatCents(invoice.totalCents, cur)} bold />
            </div>
            {invoice.paidCents > 0 && <TotalRow label="Paid" value={`−${formatCents(invoice.paidCents, cur)}`} />}
            <TotalRow label="Amount due" value={formatCents(due, cur)} bold brand />
          </dl>
        </div>

        {invoice.notes && (
          <div className="mt-8 border-t border-gray-200 pt-4 text-xs text-gray-500">
            <div className="mb-1 uppercase tracking-wide">Notes</div>
            <div className="whitespace-pre-line">{invoice.notes}</div>
          </div>
        )}

        {invoice.payments.length > 0 && (
          <div className="mt-8 border-t border-gray-200 pt-4 text-sm">
            <div className="mb-2 text-xs uppercase tracking-wide text-gray-400">Payments</div>
            <ul className="space-y-1">
              {invoice.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-gray-600">
                  <span>
                    {formatDate(p.paidOn)} · {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                  </span>
                  <span className="font-medium text-gray-800">{formatCents(p.amountCents, cur)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-gray-400">
        Questions about this invoice? Reply to the email it came from.
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-end gap-6">
      <dt className="text-gray-400">{label}</dt>
      <dd className="font-medium text-gray-800">{value}</dd>
    </div>
  )
}

function TotalRow({ label, value, bold, brand }: { label: string; value: string; bold?: boolean; brand?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : 'text-gray-600'}`}>
      <span>{label}</span>
      <span style={brand ? { color: BRAND } : undefined}>{value}</span>
    </div>
  )
}
