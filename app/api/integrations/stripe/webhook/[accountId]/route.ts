import { prisma } from '@/lib/prisma'
import { listConnectionsWithSecrets, logSync } from '@/lib/integrations'
import { verifyStripeWebhook, parseStripePaymentEvent } from '@/modules/integrations/stripeWebhook'
import { recordPayment } from '@/modules/invoicing/recordPayment'
import { copyPaymentToXero } from '@/modules/integrations/xeroSync'

export const dynamic = 'force-dynamic'

/**
 * Per-account Stripe webhook (specs/14, AC-STRIPE-002/003/004).
 * Configure this URL (with the account id) as the endpoint in the Stripe Dashboard;
 * the endpoint's signing secret is stored in the account's Stripe connection.
 */
export async function POST(request: Request, { params }: { params: { accountId: string } }) {
  const accountId = params.accountId
  const raw = await request.text()
  const sig = request.headers.get('stripe-signature')

  // Each business entity can have its own Stripe account + signing secret (specs/16). One webhook URL
  // per Track2 account receives events from all of them; identify the sender by trying each entity's
  // signing secret and using the one that verifies.
  const conns = (await listConnectionsWithSecrets(accountId, 'stripe')).filter((c) => c.status === 'connected' && c.secrets.webhookSecret)
  if (conns.length === 0) {
    return new Response('Stripe not connected', { status: 400 })
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const verified = conns.some((c) => verifyStripeWebhook(raw, sig, c.secrets.webhookSecret, nowSec))
  if (!verified) {
    return new Response('Invalid signature', { status: 400 }) // AC-STRIPE-004
  }

  let event: unknown
  try {
    event = JSON.parse(raw)
  } catch {
    return new Response('Bad payload', { status: 400 })
  }

  const p = parseStripePaymentEvent(event)
  if (!p || !p.chargeId) return Response.json({ received: true }) // nothing to record

  // Resolve the invoice: prefer metadata invoiceId (scoped to this account), else the PaymentIntent id.
  const invoice = p.invoiceId
    ? await prisma.invoice.findFirst({ where: { id: p.invoiceId, accountId }, select: { id: true, status: true } })
    : p.paymentIntentId
      ? await prisma.invoice.findFirst({ where: { stripePaymentIntentId: p.paymentIntentId, accountId }, select: { id: true, status: true } })
      : null

  if (!invoice) {
    await logSync({ accountId, provider: 'stripe', direction: 'inbound', entityType: 'payment', externalId: p.chargeId, ok: false, message: 'No matching invoice' })
    return Response.json({ received: true })
  }

  // Idempotency (AC-STRIPE-003): a payment with this charge id already recorded → ack, no-op.
  const already = await prisma.payment.findUnique({ where: { stripeChargeId: p.chargeId } }).catch(() => null)
  if (already) return Response.json({ received: true, duplicate: true })

  try {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { stripePaymentIntentId: p.paymentIntentId ?? undefined } }).catch(() => {})
    await recordPayment(prisma, {
      invoiceId: invoice.id,
      amountCents: p.amountReceivedCents,
      paidOn: new Date(),
      method: 'card',
      source: 'stripe',
      stripeChargeId: p.chargeId,
      allowOverpayment: true, // money genuinely received; never reject a real payment
      note: 'Paid online via Stripe',
    })
    await logSync({ accountId, provider: 'stripe', direction: 'inbound', entityType: 'payment', entityId: invoice.id, externalId: p.chargeId, ok: true })
    // Mirror the payment into Xero when connected (Stripe → app → Xero; best-effort).
    await copyPaymentToXero(accountId, invoice.id).catch(() => {})
  } catch (e) {
    await logSync({ accountId, provider: 'stripe', direction: 'inbound', entityType: 'payment', entityId: invoice.id, externalId: p.chargeId, ok: false, message: (e as Error).message?.slice(0, 200) })
    return new Response('Could not record payment', { status: 500 })
  }

  return Response.json({ received: true })
}
