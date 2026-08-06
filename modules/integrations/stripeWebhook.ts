/**
 * Stripe webhook signature verification + event parsing (specs/14 §Stripe).
 *
 * Implements Stripe's signed-payload scheme so we don't need the Stripe SDK:
 *   Stripe-Signature: t=<unixTime>,v1=<hex HMAC-SHA256 of `${t}.${rawBody}` with the
 *   endpoint's signing secret (whsec_…)>.
 * Pure + DB-free so it is unit-tested; the route wires it to recordPayment.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface ParsedHeader {
  timestamp: number
  signatures: string[]
}

export function parseStripeSigHeader(header: string): ParsedHeader | null {
  let timestamp = 0
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const [k, v] = part.split('=')
    if (k === 't') timestamp = parseInt(v, 10)
    else if (k === 'v1' && v) signatures.push(v)
  }
  if (!timestamp || signatures.length === 0) return null
  return { timestamp, signatures }
}

export function computeStripeSignature(timestamp: number, rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}

/**
 * Verify a Stripe webhook. Returns true only when a v1 signature matches and the timestamp
 * is within `toleranceSec` of `nowSec` (replay protection).
 */
export function verifyStripeWebhook(
  rawBody: string,
  sigHeader: string | null,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): boolean {
  if (!sigHeader || !secret) return false
  const parsed = parseStripeSigHeader(sigHeader)
  if (!parsed) return false
  if (Math.abs(nowSec - parsed.timestamp) > toleranceSec) return false
  const expected = computeStripeSignature(parsed.timestamp, rawBody, secret)
  const expectedBuf = Buffer.from(expected, 'hex')
  return parsed.signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'hex')
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)
  })
}

export interface StripePaymentEvent {
  kind: 'payment'
  paymentIntentId: string | null
  chargeId: string | null
  invoiceId: string | null // our invoice id, from PaymentIntent/session metadata
  accountId: string | null
  amountReceivedCents: number
  currency: string
}

/**
 * Extract the payment facts we care about from a verified Stripe event. Handles
 * `checkout.session.completed`, `payment_intent.succeeded`, and `charge.succeeded`.
 * Returns null for event types we don't act on.
 */
export function parseStripePaymentEvent(event: unknown): StripePaymentEvent | null {
  const e = event as { type?: string; data?: { object?: Record<string, unknown> } }
  const obj = e?.data?.object ?? {}
  const meta = (obj.metadata as Record<string, string> | undefined) ?? {}
  const invoiceId = meta.invoiceId ?? null
  const accountId = meta.accountId ?? null

  switch (e?.type) {
    case 'checkout.session.completed': {
      if (obj.payment_status && obj.payment_status !== 'paid') return null
      return {
        kind: 'payment',
        paymentIntentId: (obj.payment_intent as string) ?? null,
        chargeId: (obj.payment_intent as string) ?? (obj.id as string) ?? null,
        invoiceId,
        accountId,
        amountReceivedCents: Number(obj.amount_total ?? 0),
        currency: String(obj.currency ?? 'usd').toUpperCase(),
      }
    }
    case 'payment_intent.succeeded': {
      const charges = (obj.charges as { data?: Array<{ id?: string }> } | undefined)?.data
      return {
        kind: 'payment',
        paymentIntentId: (obj.id as string) ?? null,
        chargeId: (obj.latest_charge as string) ?? charges?.[0]?.id ?? (obj.id as string) ?? null,
        invoiceId,
        accountId,
        amountReceivedCents: Number(obj.amount_received ?? obj.amount ?? 0),
        currency: String(obj.currency ?? 'usd').toUpperCase(),
      }
    }
    case 'charge.succeeded': {
      return {
        kind: 'payment',
        paymentIntentId: (obj.payment_intent as string) ?? null,
        chargeId: (obj.id as string) ?? null,
        invoiceId,
        accountId,
        amountReceivedCents: Number(obj.amount_captured ?? obj.amount ?? 0),
        currency: String(obj.currency ?? 'usd').toUpperCase(),
      }
    }
    default:
      return null
  }
}
