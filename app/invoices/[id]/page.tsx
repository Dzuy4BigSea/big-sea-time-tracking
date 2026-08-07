import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { displayBadge, type StoredStatus } from '@/modules/invoicing/invoiceState'
import { formatCents, formatDate } from '@/lib/format'
import { BADGE_STYLES, BADGE_LABEL, PAYMENT_TERM_LABEL, PAYMENT_METHOD_LABEL } from '@/lib/labels'
import { ymd } from '@/lib/week'
import { RecordPaymentForm } from '@/components/RecordPaymentForm'
import { InvoiceLineItems } from '@/components/InvoiceLineItems'
import { sendInvoiceAction, markDraftAction, deleteInvoiceAction } from '@/app/invoices/actions'
import { createRecurringFromInvoiceAction } from '@/app/recurring/actions'
import { requireUser } from '@/lib/session'
import { requireModule } from '@/lib/modules'
import { getInvoiceAppearance, applyEntityBranding } from '@/lib/appearance'
import { listAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const { accountId } = await requireUser()
  await requireModule(accountId, 'invoices')
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, accountId },
    include: {
      client: true,
      account: true,
      entity: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
      payments: { orderBy: { paidOn: 'asc' } },
    },
  })
  if (!invoice) notFound()

  const appearance = applyEntityBranding(await getInvoiceAppearance(accountId), invoice.entity)
  const BRAND = appearance.brandColor
  const fromName = invoice.entity?.name ?? invoice.account.name
  const activity = await listAudit(accountId, 'invoice', invoice.id)
  const latest = activity[0]

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
    <div>
      <Link href="/invoices" className="text-sm text-gray-500 hover:text-brand-teal">
        ← Back to Invoices
      </Link>

      <div className="mb-4 mt-2 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Invoice {invoice.number ?? <span className="text-gray-400">(draft)</span>}</h1>
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_STYLES[badge]}`}>
          {BADGE_LABEL[badge]}
        </span>
        {invoice.entity && (
          <span className="rounded bg-brand-teal-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-teal" title={`Billed as ${invoice.entity.name}`}>
            {invoice.entity.code}
          </span>
        )}
        <div className="ml-auto text-right">
          <div className="text-xs uppercase tracking-wide text-gray-400">Balance</div>
          <div className="text-xl font-semibold">{formatCents(due, cur)}</div>
        </div>
      </div>

      {latest && (
        <p className="mb-4 text-sm text-gray-500">
          Latest activity: <span className="text-gray-700">{latest.summary}</span>
          {latest.actorName ? ` · ${latest.actorName}` : ''} · {formatDate(latest.createdAt)}
          {activity.length > 1 && (
            <>
              {' · '}
              <a href="#history" className="text-brand-teal hover:underline">View history</a>
            </>
          )}
        </p>
      )}

      {/* Action bar */}
      <div className="mb-4 flex flex-wrap gap-2">
        {invoice.status === 'draft' && (
          <form action={sendInvoiceAction}>
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <button className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">
              Send invoice
            </button>
          </form>
        )}
        {invoice.status === 'open' && (
          <form action={markDraftAction}>
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <button className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Mark as draft
            </button>
          </form>
        )}
        {invoice.status === 'draft' && (
          <form action={deleteInvoiceAction}>
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <button className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600">
              Delete draft
            </button>
          </form>
        )}
        {invoice.publicToken && invoice.status !== 'draft' && (
          <a
            href={`/i/${invoice.publicToken}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            View client link ↗
          </a>
        )}
        {invoice.lineItems.length > 0 && (
          <form action={createRecurringFromInvoiceAction}>
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <button className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Create recurring
            </button>
          </form>
        )}
      </div>

      {/* Rendered invoice document */}
      <div className="rounded-lg border border-gray-200 bg-white p-8">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {appearance.logoFileUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={appearance.logoFileUrl} alt={`${fromName} logo`} className="h-10 w-auto" />
            )}
            <div className="text-lg font-semibold tracking-tight">{fromName}</div>
          </div>
          {appearance.showDocumentTitle && (
            <div className="text-2xl font-bold tracking-wide" style={{ color: BRAND }}>
              {appearance.documentTitle}
            </div>
          )}
        </div>

        <div className="mt-8 flex justify-between gap-8 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400">Invoice for</div>
            <div className="mt-1 font-medium">{invoice.client.name}</div>
            {invoice.client.address && (
              <div className="whitespace-pre-line text-gray-600">{invoice.client.address}</div>
            )}
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

        {/* Line items */}
        <InvoiceLineItems
          items={invoice.lineItems.map((li) => ({
            id: li.id,
            description: li.description,
            quantity: Number(li.quantity),
            unitPriceCents: li.unitPriceCents,
            amountCents: li.amountCents,
          }))}
          appearance={appearance}
          currency={cur}
        />

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <dl className="w-64 space-y-1 text-sm">
            <TotalRow label="Subtotal" value={formatCents(invoice.subtotalCents, cur)} />
            {invoice.discountCents > 0 && <TotalRow label="Discount" value={`−${formatCents(invoice.discountCents, cur)}`} />}
            {invoice.taxCents > 0 && <TotalRow label="Tax" value={formatCents(invoice.taxCents, cur)} />}
            <div className="border-t border-gray-200 pt-1">
              <TotalRow label="Total" value={formatCents(invoice.totalCents, cur)} bold />
            </div>
            {invoice.paidCents > 0 && <TotalRow label="Paid" value={`−${formatCents(invoice.paidCents, cur)}`} />}
            <TotalRow label="Amount due" value={formatCents(due, cur)} bold brandColor={BRAND} />
          </dl>
        </div>

        {invoice.notes && (
          <div className="mt-8 border-t border-gray-200 pt-4 text-xs text-gray-500">
            <div className="mb-1 uppercase tracking-wide">Notes</div>
            <div className="whitespace-pre-line">{invoice.notes}</div>
          </div>
        )}
      </div>

      {/* Payments */}
      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Payments</h2>
        {invoice.status === 'open' && (
          <div className="mb-3">
            <RecordPaymentForm invoiceId={invoice.id} defaultDate={ymd(new Date())} dueLabel={formatCents(due, cur)} />
          </div>
        )}
        {invoice.payments.length === 0 ? (
          <p className="text-sm text-gray-400">No payments recorded.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
            {invoice.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-2">
                <span className="text-gray-600">
                  {formatDate(p.paidOn)} · {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                  {p.note ? ` · ${p.note}` : ''}
                </span>
                <span className="font-medium">{formatCents(p.amountCents, cur)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Activity / history (spec 17) */}
      {activity.length > 0 && (
        <div id="history" className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">History</h2>
          <ol className="rounded-lg border border-gray-200 bg-white text-sm">
            {activity.map((a) => (
              <li key={a.id} className="flex items-start gap-3 border-b border-gray-100 px-4 py-2.5 last:border-0">
                <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-brand-teal" />
                <span className="flex-1 text-gray-700">{a.summary}</span>
                <span className="whitespace-nowrap text-xs text-gray-400">
                  {a.actorName ? `${a.actorName} · ` : ''}
                  {formatDate(a.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
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

function TotalRow({ label, value, bold, brandColor }: { label: string; value: string; bold?: boolean; brandColor?: string }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : 'text-gray-600'}`}>
      <span>{label}</span>
      <span style={brandColor ? { color: brandColor } : undefined}>{value}</span>
    </div>
  )
}
