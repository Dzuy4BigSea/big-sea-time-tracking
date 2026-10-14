'use server'

import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { logSync } from '@/lib/integrations'
import { stripeForInvoice } from '@/lib/stripePayments'
import { createCheckoutSession, StripeApiError } from '@/modules/integrations/stripeClient'
import { effectiveOnlineMethods } from '@/modules/invoicing/onlinePayments'
import { recordInvoiceEvent } from '@/modules/observability/invoiceTrace'
import { resolveAppUrl } from '@/lib/appUrl'
import { formatCents } from '@/lib/format'

/**
 * Start a Stripe Checkout for an open invoice from its public link (specs/14, AC-STRIPE-001).
 *
 * Charges exactly the remaining balance in the invoice currency with the invoice's allowed
 * methods. Success/cancel URLs come from configuration (APP_URL / AUTH_URL / NEXTAUTH_URL), never
 * from the client-controllable x-forwarded-host header. Never leaves the client on a dead click:
 * anything that stops the checkout sends them back to the invoice with a message.
 */
export async function startStripeCheckoutAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '')
  if (!token) return
  const invoice = await prisma.invoice.findUnique({
    where: { publicToken: token },
    select: { id: true, accountId: true, number: true, status: true, currency: true, totalCents: true, paidCents: true, acceptOnlinePayments: true, allowCardPayments: true, allowAchPayments: true, account: { select: { name: true } }, entity: { select: { name: true } } },
  })
  if (!invoice || invoice.status === 'draft') return
  const back = `/i/${encodeURIComponent(token)}`
  // Paid / closed meanwhile (e.g. a second tab): the page shows the current state, no Pay button.
  if (invoice.status !== 'open') redirect(back)
  const balance = invoice.totalCents - invoice.paidCents
  if (balance <= 0) redirect(back)

  // Route to the invoice's business entity's Stripe account (specs/16); falls back to shared.
  const stripe = await stripeForInvoice(invoice.accountId, invoice.id)
  // Per-invoice "Accept online payments" (Credit Card / ACH) narrows the connection's methods.
  const methods = stripe ? effectiveOnlineMethods(stripe.config, invoice) : null
  if (!stripe || !methods) redirect(`${back}?pay_error=unavailable`)

  const base = resolveAppUrl()
  const trace = { accountId: invoice.accountId, invoiceId: invoice.id, source: 'stripe' as const }
  const t0 = Date.now()
  let url: string
  try {
    const session = await createCheckoutSession(stripe.secretKey, {
      amountCents: balance,
      currency: invoice.currency,
      productName: `Invoice ${invoice.number ?? ''} — ${invoice.entity?.name ?? invoice.account.name}`.replace(/\s+/g, ' ').trim(),
      // {CHECKOUT_SESSION_ID} is filled in by Stripe; the return page uses it to tell paid vs processing.
      successUrl: `${base}${back}?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}${back}?canceled=1`,
      metadata: { invoiceId: invoice.id, accountId: invoice.accountId, entityId: stripe.entityId ?? '' },
      methods,
      clientReferenceId: invoice.id,
    })
    await recordInvoiceEvent({
      ...trace,
      stage: 'payment.checkout_started',
      message: `Client started online payment of ${formatCents(balance, invoice.currency)}${session.replayed ? ' (repeat click: same Checkout Session)' : ''}`,
      externalId: session.id,
      // A double click replays the same session: one trace row per session.
      externalEventId: `${session.id}#checkout_started`,
      durationMs: Date.now() - t0,
      detail: { amountCents: balance, currency: invoice.currency, methods: session.methodTypes, entityId: stripe.entityId, replayed: session.replayed },
    })
    url = session.url
  } catch (e) {
    const se = e instanceof StripeApiError ? e : null
    const msg = (e as Error)?.message?.slice(0, 300) ?? String(e)
    await recordInvoiceEvent({
      ...trace,
      level: 'error',
      stage: 'payment.checkout_failed',
      message: `Could not start Stripe Checkout: ${msg}`,
      httpStatus: se?.httpStatus ?? null,
      durationMs: Date.now() - t0,
      detail: { amountCents: balance, currency: invoice.currency, methods, entityId: stripe.entityId, stripeType: se?.stripeType ?? null, stripeCode: se?.stripeCode ?? null },
    })
    await logSync({ accountId: invoice.accountId, provider: 'stripe', direction: 'outbound', entityType: 'invoice', entityId: invoice.id, ok: false, message: msg.slice(0, 200) })
    redirect(`${back}?pay_error=failed`)
  }
  redirect(url)
}
