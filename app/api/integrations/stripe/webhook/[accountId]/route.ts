import { prisma } from '@/lib/prisma'
import { listConnectionsWithSecrets, logSync } from '@/lib/integrations'
import { Prisma } from '@prisma/client'
import { verifyStripeWebhook, parseStripePaymentEvent, stripeDuplicateKeys, currencyMatches } from '@/modules/integrations/stripeWebhook'
import { recordPayment } from '@/modules/invoicing/recordPayment'
import { InvalidTransitionError } from '@/modules/invoicing/invoiceState'
import { todayIn } from '@/lib/tz'
import { copyPaymentToXero } from '@/modules/integrations/xeroSync'
import { writeAudit } from '@/lib/audit'
import { formatCents } from '@/lib/format'
import { sendReceipt } from '@/modules/email/invoiceEmails'

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
  if (!p || !p.idempotencyKey || p.amountReceivedCents <= 0) return Response.json({ received: true }) // nothing to record
  const key = p.idempotencyKey
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true } })

  // Resolve the invoice: prefer metadata invoiceId (scoped to this account), else the PaymentIntent id.
  const select = { id: true, status: true, currency: true, totalCents: true, paidCents: true } as const
  const invoice = p.invoiceId
    ? await prisma.invoice.findFirst({ where: { id: p.invoiceId, accountId }, select })
    : p.paymentIntentId
      ? await prisma.invoice.findFirst({ where: { stripePaymentIntentId: p.paymentIntentId, accountId }, select })
      : null

  if (!invoice) {
    await logSync({ accountId, provider: 'stripe', direction: 'inbound', entityType: 'payment', externalId: key, ok: false, message: 'No matching invoice' })
    return Response.json({ received: true })
  }

  // Idempotency (AC-STRIPE-003): one payment is keyed by its PaymentIntent id across every event
  // type; also match the charge id older rows were recorded under.
  const already = await prisma.payment.findFirst({ where: { accountId, stripeChargeId: { in: stripeDuplicateKeys(p) } }, select: { id: true } })
  if (already) return Response.json({ received: true, duplicate: true })

  /**
   * Money arrived that we can't apply automatically (wrong currency, invoice not open). Flag it once
   * on the invoice's activity log + sync log and ack with 200 so Stripe does not retry forever.
   */
  const flag = async (reason: string) => {
    const message = `Unapplied Stripe payment ${key}: ${reason}`
    const seen = await prisma.integrationSyncLog.findFirst({
      where: { accountId, provider: 'stripe', entityType: 'payment', externalId: key, ok: false, message: { startsWith: 'Unapplied' } },
      select: { id: true },
    })
    if (seen) return Response.json({ received: true, flagged: true, duplicate: true })
    await logSync({ accountId, provider: 'stripe', direction: 'inbound', entityType: 'payment', entityId: invoice.id, externalId: key, ok: false, message: message.slice(0, 500) })
    await writeAudit({
      accountId,
      actorUserId: null,
      entityType: 'invoice',
      entityId: invoice.id,
      action: 'update',
      summary: `Stripe payment of ${formatCents(p.amountReceivedCents, p.currency)} received but NOT applied — ${reason}. Reconcile manually (refund or record it).`,
    })
    return Response.json({ received: true, flagged: true })
  }

  if (!currencyMatches(invoice.currency, p.currency)) {
    return flag(`currency ${p.currency} does not match the invoice currency ${invoice.currency}`)
  }
  if (invoice.status !== 'open') {
    return flag(`invoice is ${invoice.status.replace('_', ' ')}`)
  }

  try {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { stripePaymentIntentId: p.paymentIntentId ?? undefined } }).catch(() => {})
    await recordPayment(prisma, {
      invoiceId: invoice.id,
      amountCents: p.amountReceivedCents,
      paidOn: todayIn(account?.timezone),
      method: p.method,
      source: 'stripe',
      stripeChargeId: key,
      allowOverpayment: true, // money genuinely received; never reject a real payment
      note: 'Paid online via Stripe',
    })
  } catch (e) {
    // A concurrent delivery of the same payment won the unique key → already recorded.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return Response.json({ received: true, duplicate: true })
    // The invoice left 'open' between our read and the locked write → flag, don't 500-loop.
    if (e instanceof InvalidTransitionError) return flag('invoice is no longer open')
    await logSync({ accountId, provider: 'stripe', direction: 'inbound', entityType: 'payment', entityId: invoice.id, externalId: key, ok: false, message: (e as Error).message?.slice(0, 200) })
    return new Response('Could not record payment', { status: 500 }) // transient (DB) → let Stripe retry
  }

  await logSync({ accountId, provider: 'stripe', direction: 'inbound', entityType: 'payment', entityId: invoice.id, externalId: key, ok: true })
  await writeAudit({ accountId, actorUserId: null, entityType: 'invoice', entityId: invoice.id, action: 'update', summary: `Paid online via Stripe — ${formatCents(p.amountReceivedCents, p.currency)} (${p.method.replace('_', ' ')})` })
  const over = invoice.paidCents + p.amountReceivedCents - invoice.totalCents
  if (over > 0) {
    await writeAudit({ accountId, actorUserId: null, entityType: 'invoice', entityId: invoice.id, action: 'update', summary: `Overpaid by ${formatCents(over, p.currency)} via Stripe — refund or credit the client.` })
  }
  // Email the client a receipt (best-effort).
  const receiptSummary = await sendReceipt(accountId, invoice.id, p.amountReceivedCents, p.method, new Date()).catch(() => null)
  if (receiptSummary) await writeAudit({ accountId, actorUserId: null, entityType: 'invoice', entityId: invoice.id, action: 'update', summary: receiptSummary })
  // Mirror the payment into Xero when connected (Stripe → app → Xero; best-effort).
  await copyPaymentToXero(accountId, invoice.id).catch(() => {})

  return Response.json({ received: true })
}
