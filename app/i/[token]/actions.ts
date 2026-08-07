'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getConnectionWithSecrets, logSync } from '@/lib/integrations'
import { entityIdForInvoice } from '@/lib/entities'
import { createCheckoutSession } from '@/modules/integrations/stripeClient'

function baseUrl(): string {
  const h = headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  return `${proto}://${host}`
}

/** Start a Stripe Checkout for an open invoice from its public link (specs/14, AC-STRIPE-001). */
export async function startStripeCheckoutAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '')
  if (!token) return
  const invoice = await prisma.invoice.findUnique({
    where: { publicToken: token },
    select: { id: true, accountId: true, number: true, status: true, currency: true, totalCents: true, paidCents: true, account: { select: { name: true } } },
  })
  if (!invoice || invoice.status !== 'open') return

  // Route to the invoice's business entity's Stripe account (specs/16); falls back to shared.
  const entityId = await entityIdForInvoice(invoice.accountId, invoice.id)
  const conn = await getConnectionWithSecrets(invoice.accountId, 'stripe', entityId)
  const secretKey = conn?.secrets.secretKey
  if (!conn || conn.status !== 'connected' || !secretKey) return

  const balance = invoice.totalCents - invoice.paidCents
  if (balance <= 0) return

  const base = baseUrl()
  let url: string
  try {
    const session = await createCheckoutSession(secretKey, {
      amountCents: balance,
      currency: invoice.currency,
      productName: `Invoice ${invoice.number ?? ''} — ${invoice.account.name}`.trim(),
      successUrl: `${base}/i/${token}?paid=1`,
      cancelUrl: `${base}/i/${token}`,
      metadata: { invoiceId: invoice.id, accountId: invoice.accountId, entityId: entityId ?? '' },
      methods: { card: !!conn.config.creditCardEnabled, ach: !!conn.config.achEnabled },
    })
    url = session.url
  } catch (e) {
    await logSync({ accountId: invoice.accountId, provider: 'stripe', direction: 'outbound', entityType: 'invoice', entityId: invoice.id, ok: false, message: (e as Error).message?.slice(0, 200) })
    return
  }
  redirect(url)
}
