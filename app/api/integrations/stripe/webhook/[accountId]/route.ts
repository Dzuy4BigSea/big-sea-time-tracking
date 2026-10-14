import { prisma } from '@/lib/prisma'
import { listConnectionsWithSecrets, logSync } from '@/lib/integrations'
import { handleStripeWebhook, type StripeWebhookPorts } from '@/modules/integrations/stripeWebhookHandler'
import { recordStripePaymentOnce } from '@/modules/invoicing/recordStripePayment'
import { recordInvoiceEvent } from '@/modules/observability/invoiceTrace'
import { todayIn } from '@/lib/tz'
import { copyPaymentToXero } from '@/modules/integrations/xeroSync'
import { writeAudit } from '@/lib/audit'
import { formatCents } from '@/lib/format'
import { sendReceipt } from '@/modules/email/invoiceEmails'

export const dynamic = 'force-dynamic'

/**
 * Per-account Stripe webhook (specs/14 §2, AC-STRIPE-002/003/004; OPS.md "Stripe payments").
 * Configure https://<app>/api/integrations/stripe/webhook/<accountId> as the endpoint in each
 * connected Stripe account; its signing secret (whsec_…) lives in that entity's Stripe connection.
 * All decisions are in modules/integrations/stripeWebhookHandler.ts; this file only wires Prisma in.
 */
function ports(): StripeWebhookPorts {
  const invoiceSelect = { id: true, status: true, currency: true, totalCents: true, paidCents: true } as const
  return {
    nowSec: () => Math.floor(Date.now() / 1000),
    listConnections: (accountId) => listConnectionsWithSecrets(accountId, 'stripe'),
    trace: (e) => recordInvoiceEvent(e),
    async findInvoice(accountId, by) {
      // Metadata invoiceId first (scoped to this account, INV-5), else the PaymentIntent id.
      if (by.invoiceId) {
        const inv = await prisma.invoice.findFirst({ where: { id: by.invoiceId, accountId }, select: invoiceSelect })
        if (inv) return inv
      }
      return by.paymentIntentId ? prisma.invoice.findFirst({ where: { stripePaymentIntentId: by.paymentIntentId, accountId }, select: invoiceSelect }) : null
    },
    findPayment: (accountId, keys) =>
      prisma.payment.findFirst({ where: { accountId, stripeChargeId: { in: keys } }, select: { id: true, invoiceId: true, amountCents: true } }),
    async paidOnFor(accountId, at) {
      const account = await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true } })
      return todayIn(account?.timezone, at)
    },
    async recordPayment(input) {
      if (input.paymentIntentId) {
        // Remember the PaymentIntent on the invoice so events without metadata still find it.
        await prisma.invoice.update({ where: { id: input.invoiceId }, data: { stripePaymentIntentId: input.paymentIntentId } }).catch(() => {})
      }
      return recordStripePaymentOnce(prisma, { invoiceId: input.invoiceId, amountCents: input.amountCents, paidOn: input.paidOn, method: input.method, key: input.key })
    },
    logSync: (input) => logSync({ provider: 'stripe', direction: 'inbound', entityType: 'payment', ...input }),
    async audit(accountId, invoiceId, summary) {
      await writeAudit({ accountId, actorUserId: null, entityType: 'invoice', entityId: invoiceId, action: 'update', summary }).catch(() => {})
    },
    async afterRecorded(accountId, invoiceId, amountCents, method) {
      // Email the client a receipt (best-effort).
      const receiptSummary = await sendReceipt(accountId, invoiceId, amountCents, method, new Date()).catch(() => null)
      if (receiptSummary) await writeAudit({ accountId, actorUserId: null, entityType: 'invoice', entityId: invoiceId, action: 'update', summary: receiptSummary }).catch(() => {})
      // Mirror the payment into Xero when connected (Stripe → app → Xero; best-effort).
      await copyPaymentToXero(accountId, invoiceId).catch(() => {})
    },
    formatMoney: (cents, currency) => formatCents(cents, currency),
  }
}

export async function POST(request: Request, { params }: { params: { accountId: string } }) {
  const rawBody = await request.text() // raw text: the signature covers these exact bytes
  const result = await handleStripeWebhook(ports(), {
    accountId: params.accountId,
    rawBody,
    signatureHeader: request.headers.get('stripe-signature'),
  })
  return typeof result.body === 'string' ? new Response(result.body, { status: result.status }) : Response.json(result.body, { status: result.status })
}
