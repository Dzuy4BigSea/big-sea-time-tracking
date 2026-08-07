import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { formatCents, formatDate } from '@/lib/format'
import { PAYMENT_TERM_LABEL } from '@/lib/labels'
import { getInvoiceAppearance, applyEntityBranding } from '@/lib/appearance'
import { getInvoiceLabels } from '@/lib/invoiceLabels'
import { InvoiceLineItems } from '@/components/InvoiceLineItems'
import { AutoPrint } from '@/components/PrintButtons'

export const dynamic = 'force-dynamic'

/** Chrome-free, auto-printing invoice document. Rendered bare (see layout BARE_PREFIXES); the browser
 * print dialog offers "Save as PDF". Auth-gated to the actor's account (spec 17). */
export default async function PrintInvoicePage({ params }: { params: { id: string } }) {
  const { accountId } = await requireUser()
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, accountId },
    include: { client: true, account: true, entity: true, lineItems: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!invoice) notFound()

  const appearance = applyEntityBranding(await getInvoiceAppearance(accountId), invoice.entity)
  const L = await getInvoiceLabels(accountId, invoice.entityId ?? invoice.client.entityId ?? null)
  const BRAND = appearance.brandColor
  const fromName = invoice.entity?.name ?? invoice.account.name
  const cur = invoice.currency
  const due = invoice.totalCents - invoice.paidCents

  return (
    <div className="mx-auto max-w-3xl bg-white p-10 print:p-0">
      <AutoPrint />
      <div className="flex items-start justify-between border-b-2 pb-6" style={{ borderColor: BRAND }}>
        <div className="flex items-center gap-3">
          {appearance.logoFileUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={appearance.logoFileUrl} alt={fromName} className="h-10 w-auto" />
          )}
          <div className="text-lg font-semibold">{fromName}</div>
        </div>
        {appearance.showDocumentTitle && (
          <div className="text-2xl font-bold tracking-wide" style={{ color: BRAND }}>{appearance.documentTitle}</div>
        )}
      </div>

      <div className="mt-6 flex justify-between gap-8 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">{L.for}</div>
          <div className="mt-1 font-medium">{invoice.client.name}</div>
          {invoice.client.address && <div className="whitespace-pre-line text-gray-600">{invoice.client.address}</div>}
        </div>
        <div className="text-right">
          <div className="flex justify-end gap-6"><span className="text-gray-400">{L.invoiceId}</span><span className="font-medium">{invoice.number ?? '—'}</span></div>
          <div className="flex justify-end gap-6"><span className="text-gray-400">{L.issueDate}</span><span className="font-medium">{formatDate(invoice.issueDate)}</span></div>
          <div className="flex justify-end gap-6"><span className="text-gray-400">{L.dueDate}</span><span className="font-medium">{formatDate(invoice.dueDate)}{invoice.dueDate ? ` (${PAYMENT_TERM_LABEL[invoice.paymentTerm] ?? invoice.paymentTerm})` : ''}</span></div>
          {invoice.poNumber && <div className="flex justify-end gap-6"><span className="text-gray-400">{L.poNumber}</span><span className="font-medium">{invoice.poNumber}</span></div>}
        </div>
      </div>

      {invoice.subject && (
        <div className="mt-6 text-sm"><span className="text-xs uppercase tracking-wide text-gray-400">{L.subject}</span><div className="mt-1">{invoice.subject}</div></div>
      )}

      <div className="mt-4">
        <InvoiceLineItems
          items={invoice.lineItems.map((li) => ({ id: li.id, description: li.description, quantity: Number(li.quantity), unitPriceCents: li.unitPriceCents, amountCents: li.amountCents }))}
          appearance={appearance}
          currency={cur}
        />
      </div>

      <div className="mt-4 flex justify-end">
        <dl className="w-64 space-y-1 text-sm">
          <div className="flex justify-between text-gray-600"><span>{L.subtotal}</span><span>{formatCents(invoice.subtotalCents, cur)}</span></div>
          {invoice.discountCents > 0 && <div className="flex justify-between text-gray-600"><span>{L.discount}</span><span>−{formatCents(invoice.discountCents, cur)}</span></div>}
          {invoice.taxCents > 0 && <div className="flex justify-between text-gray-600"><span>{L.tax}</span><span>{formatCents(invoice.taxCents, cur)}</span></div>}
          <div className="flex justify-between border-t border-gray-300 pt-1 font-semibold"><span>{L.total}</span><span>{formatCents(invoice.totalCents, cur)}</span></div>
          {invoice.paidCents > 0 && <div className="flex justify-between text-gray-600"><span>{L.paid}</span><span>−{formatCents(invoice.paidCents, cur)}</span></div>}
          <div className="flex justify-between text-base font-semibold" style={{ color: BRAND }}><span>{L.amountDue}</span><span>{formatCents(due, cur)}</span></div>
        </dl>
      </div>

      {invoice.notes && (
        <div className="mt-8 border-t border-gray-200 pt-4 text-xs text-gray-500"><div className="mb-1 uppercase tracking-wide">{L.notes}</div><div className="whitespace-pre-line">{invoice.notes}</div></div>
      )}
      {invoice.terms && (
        <div className="mt-4 text-xs text-gray-500"><div className="mb-1 uppercase tracking-wide">Terms</div><div className="whitespace-pre-line">{invoice.terms}</div></div>
      )}
    </div>
  )
}
