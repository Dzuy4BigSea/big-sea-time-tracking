import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { displayBadge, type StoredStatus } from '@/modules/invoicing/invoiceState'
import { formatCents, formatDate } from '@/lib/format'
import { todayIn } from '@/lib/tz'
import { BADGE_STYLES, BADGE_LABEL, PAYMENT_TERM_LABEL, PAYMENT_METHOD_LABEL } from '@/lib/labels'
import { getInvoiceAppearance, applyEntityBranding } from '@/lib/appearance'
import { getInvoiceLabels } from '@/lib/invoiceLabels'
import { InvoiceLineItems } from '@/components/InvoiceLineItems'
import { InvoiceNotesText } from '@/components/InvoiceNotes'
import { startStripeCheckoutAction } from '@/app/i/[token]/actions'
import { effectiveOnlineMethods } from '@/modules/invoicing/onlinePayments'
import { stripeForInvoice } from '@/lib/stripePayments'
import { retrieveCheckoutSession } from '@/modules/integrations/stripeClient'
import { checkoutReturnState, hidesPayButton, pendingBankPayment, RETURN_MESSAGE, type ReturnState } from '@/modules/integrations/stripeCheckout'
import { recordInvoiceEvent } from '@/modules/observability/invoiceTrace'
import { PrintButton } from '@/components/PrintButtons'

export const dynamic = 'force-dynamic'

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
      entity: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
      payments: { orderBy: { paidOn: 'asc' } },
    },
  })
}

export default async function PublicInvoicePage({
  params,
  searchParams,
}: {
  params: { token: string }
  searchParams: { paid?: string; canceled?: string; session_id?: string; pay_error?: string }
}) {
  const invoice = await loadInvoice(params.token)
  // Only sent invoices are shareable. Drafts have no publicToken, so this also covers them.
  if (!invoice || invoice.status === 'draft') notFound()

  // Record that the client opened the invoice (AC-INV-016). Fire-and-forget; never block the view.
  void prisma.invoice.update({ where: { id: invoice.id }, data: { lastViewedAt: new Date() } }).catch(() => {})

  const effLabelEntityId = invoice.entityId ?? invoice.client.entityId ?? null
  const appearance = applyEntityBranding(await getInvoiceAppearance(invoice.accountId), invoice.entity)
  const L = await getInvoiceLabels(invoice.accountId, effLabelEntityId)
  const BRAND = appearance.brandColor
  const fromName = invoice.entity?.name ?? invoice.account.name

  // Online payment (Stripe): the same connection the checkout action will use — the invoice's
  // entity's Stripe, else the shared one (specs/16).
  const balanceDue = invoice.totalCents - invoice.paidCents
  const returned = searchParams.paid === '1' || searchParams.canceled === '1'
  const stripe =
    invoice.status === 'open' && (balanceDue > 0 || returned) ? await stripeForInvoice(invoice.accountId, invoice.id).catch(() => null) : null
  // The invoice's own "Accept online payments" choice narrows the connection's methods (specs/05).
  const canPayOnline = invoice.status === 'open' && balanceDue > 0 && !!stripe && !!effectiveOnlineMethods(stripe.config, invoice)

  // Back from Stripe: tell the client clearly what happened. Never an error — if the webhook
  // hasn't landed yet, or the Stripe lookup fails, they're told we're confirming the payment.
  let returnState: ReturnState | null = null
  if (returned) {
    const sessionId = typeof searchParams.session_id === 'string' ? searchParams.session_id : ''
    const session =
      searchParams.paid === '1' && sessionId && stripe && invoice.status === 'open' ? await retrieveCheckoutSession(stripe.secretKey, sessionId) : null
    returnState = checkoutReturnState({ canceled: searchParams.canceled === '1', invoiceStatus: invoice.status, session, invoiceId: invoice.id })
    const verified = session && session.invoiceId === invoice.id ? session : null
    void recordInvoiceEvent({
      accountId: invoice.accountId,
      invoiceId: invoice.id,
      stage: 'payment.client_returned',
      source: 'client',
      message: `Client returned from Stripe: ${returnState.replace('_', ' ')}`,
      externalId: verified?.id ?? null,
      // One row per session and outcome, however often the page is refreshed.
      externalEventId: verified ? `${verified.id}#returned:${returnState}` : null,
      detail: { outcome: returnState, sessionStatus: verified?.status ?? null, paymentStatus: verified?.paymentStatus ?? null, invoiceStatus: invoice.status },
    })
  }

  // A bank (ACH) payment still clearing: say so and hide Pay so the client doesn't pay twice.
  const pendingBank =
    canPayOnline && returnState !== 'paid'
      ? pendingBankPayment(
          await prisma.invoiceEvent
            .findMany({
              where: {
                accountId: invoice.accountId,
                invoiceId: invoice.id,
                source: 'stripe',
                stage: { in: ['payment.processing', 'payment.recorded', 'payment.failed', 'payment.flagged', 'payment.duplicate_ignored', 'payment.refunded'] },
                occurredAt: { gte: new Date(Date.now() - 11 * 86_400_000) },
              },
              select: { stage: true, externalId: true, occurredAt: true, detail: true },
              orderBy: { occurredAt: 'desc' },
              take: 50,
            })
            .catch(() => []),
        )
      : null
  const showPayButton = canPayOnline && !hidesPayButton(returnState) && !pendingBank
  const payError = searchParams.pay_error === 'failed' || searchParams.pay_error === 'unavailable' ? searchParams.pay_error : null

  const badge = displayBadge(
    {
      status: invoice.status as StoredStatus,
      sentAt: invoice.sentAt,
      dueDate: invoice.dueDate,
      totalCents: invoice.totalCents,
      paidCents: invoice.paidCents,
    },
    // Late is judged on the account's calendar day (specs/27 AC-STAT-001), not the server's UTC day.
    todayIn(invoice.account.timezone),
  )
  const due = Math.max(0, balanceDue) // an overpaid invoice owes nothing (never a negative "amount due")
  const cur = invoice.currency

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* Summary banner */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-white p-5 shadow-sm">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">Invoice {invoice.number ?? ''} {L.from}</div>
          <div className="text-lg font-semibold" style={{ color: BRAND }}>
            {fromName}
          </div>
        </div>
        <div className="text-right">
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_STYLES[badge]}`}>
            {BADGE_LABEL[badge]}
          </span>
          <div className="mt-1 text-xs uppercase tracking-wide text-gray-400">{L.amountDue}</div>
          <div className="font-serif text-3xl font-semibold" style={{ color: BRAND }}>
            {formatCents(due, cur)}
          </div>
          <div className="no-print mt-2 flex items-center justify-end gap-2">
            <PrintButton className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50" />
            {showPayButton && (
              <form action={startStripeCheckoutAction}>
                <input type="hidden" name="token" value={params.token} />
                <button className="rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                  Pay {formatCents(due, cur)}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {returnState && (
        <div
          role="status"
          className={`mb-6 rounded-lg border p-4 text-sm ${
            RETURN_MESSAGE[returnState].tone === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : RETURN_MESSAGE[returnState].tone === 'info'
                ? 'border-blue-200 bg-blue-50 text-blue-800'
                : 'border-gray-200 bg-white text-gray-700'
          }`}
        >
          <div className="font-semibold">{RETURN_MESSAGE[returnState].title}</div>
          <div className="mt-1">{RETURN_MESSAGE[returnState].body}</div>
        </div>
      )}

      {!returnState && pendingBank && (
        <div role="status" className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          <div className="font-semibold">Bank payment processing</div>
          <div className="mt-1">
            A bank transfer{pendingBank.amountCents ? ` of ${formatCents(pendingBank.amountCents, cur)}` : ''} started on {formatDate(pendingBank.since)} is
            clearing. Bank payments take 3–5 business days; this invoice will show as paid once it does. There is no need to pay again.
          </div>
        </div>
      )}

      {payError && !returnState && (
        <div role="alert" className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {payError === 'failed'
            ? 'We couldn’t start the online payment just now, and you have not been charged. Please try again in a few minutes, or reply to the invoice email and we’ll help.'
            : 'Online payment isn’t available for this invoice. Please reply to the invoice email for other ways to pay.'}
        </div>
      )}

      {/* Rendered invoice document */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {/* Brand header band */}
        <div className="flex items-center justify-between px-8 py-6 text-white" style={{ background: BRAND }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={appearance.logoFileUrl ?? '/brand/logotype-white.svg'} alt={fromName} className="h-8 w-auto" />
          {appearance.showDocumentTitle && (
            <div className="text-xl font-bold uppercase tracking-[0.14em]">{appearance.documentTitle}</div>
          )}
        </div>
        <div className="p-8 pt-6">

        <div className="mt-8 flex justify-between gap-8 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400">{L.for}</div>
            <div className="mt-1 font-medium">{invoice.client.name}</div>
            {invoice.client.address && <div className="whitespace-pre-line text-gray-600">{invoice.client.address}</div>}
          </div>
          <div className="text-right">
            <dl className="space-y-1">
              <Row label={L.invoiceId} value={invoice.number ?? '—'} />
              <Row label={L.issueDate} value={formatDate(invoice.issueDate)} />
              <Row
                label={L.dueDate}
                value={`${formatDate(invoice.dueDate)}${
                  invoice.dueDate ? ` (${PAYMENT_TERM_LABEL[invoice.paymentTerm] ?? invoice.paymentTerm})` : ''
                }`}
              />
              {invoice.poNumber && <Row label={L.poNumber} value={invoice.poNumber} />}
            </dl>
          </div>
        </div>

        {invoice.subject && (
          <div className="mt-6 text-sm">
            <span className="text-xs uppercase tracking-wide text-gray-400">{L.subject}</span>
            <div className="mt-1">{invoice.subject}</div>
          </div>
        )}

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

        <div className="mt-4 flex justify-end">
          <dl className="w-64 space-y-1 text-sm">
            <TotalRow label={L.subtotal} value={formatCents(invoice.subtotalCents, cur)} />
            {invoice.discountCents > 0 && <TotalRow label={L.discount} value={`−${formatCents(invoice.discountCents, cur)}`} />}
            {invoice.taxCents > 0 && <TotalRow label={L.tax} value={formatCents(invoice.taxCents, cur)} />}
            <div className="border-t border-gray-200 pt-1">
              <TotalRow label={L.total} value={formatCents(invoice.totalCents, cur)} bold />
            </div>
            {invoice.paidCents > 0 && <TotalRow label={L.paid} value={`−${formatCents(invoice.paidCents, cur)}`} />}
            <TotalRow label={L.amountDue} value={formatCents(due, cur)} bold brandColor={BRAND} />
          </dl>
        </div>

        {invoice.notes && (
          <div className="mt-8 border-t border-gray-200 pt-4 text-xs text-gray-500">
            <div className="mb-1 uppercase tracking-wide">{L.notes}</div>
            <div className="whitespace-pre-line"><InvoiceNotesText text={invoice.notes} /></div>
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

function TotalRow({ label, value, bold, brandColor }: { label: string; value: string; bold?: boolean; brandColor?: string }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : 'text-gray-600'}`}>
      <span>{label}</span>
      <span style={brandColor ? { color: brandColor } : undefined}>{value}</span>
    </div>
  )
}
