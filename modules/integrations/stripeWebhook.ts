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

export type StripePaymentMethod = 'card' | 'bank_transfer' | 'other'

export interface StripePaymentEvent {
  kind: 'payment'
  paymentIntentId: string | null
  chargeId: string | null
  /**
   * The one key a payment is recorded under (Payment.stripeChargeId), the same for every event
   * type that reports this payment: the PaymentIntent id, falling back to the charge / session id
   * only when the event carries no PaymentIntent. Stops checkout.session.completed +
   * payment_intent.succeeded + charge.succeeded from recording one payment three times.
   */
  idempotencyKey: string | null
  invoiceId: string | null // our invoice id, from PaymentIntent/session metadata
  accountId: string | null
  amountReceivedCents: number
  currency: string
  /** Track2 payment method when derivable (card vs ACH / bank debit); 'other' when ambiguous. */
  method: StripePaymentMethod
}

const BANK_TYPES = new Set(['us_bank_account', 'ach_debit', 'ach_credit_transfer', 'acss_debit', 'sepa_debit', 'bacs_debit', 'au_becs_debit', 'customer_balance'])

/** Map a Stripe payment-method type to our PaymentMethod. */
export function mapStripeMethodType(type: string | null | undefined): StripePaymentMethod {
  if (!type) return 'other'
  if (type === 'card' || type === 'link' || type === 'card_present') return 'card'
  if (BANK_TYPES.has(type)) return 'bank_transfer'
  return 'other'
}

/** The method from a list of allowed types — only definitive when exactly one type was offered. */
function methodFromTypes(types: unknown): StripePaymentMethod {
  return Array.isArray(types) && types.length === 1 ? mapStripeMethodType(String(types[0])) : 'other'
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
/** `payment_intent` / `latest_charge` may be an id or an expanded object. */
const idOf = (v: unknown): string | null => str(v) ?? str((v as { id?: unknown } | null)?.id)

/**
 * Extract the payment facts we care about from a verified Stripe event. Handles
 * `checkout.session.completed` / `checkout.session.async_payment_succeeded` (ACH settles later),
 * `payment_intent.succeeded`, and `charge.succeeded`. Returns null for event types we don't act on.
 */
export function parseStripePaymentEvent(event: unknown): StripePaymentEvent | null {
  const e = event as { type?: string; data?: { object?: Record<string, unknown> } }
  const obj = e?.data?.object ?? {}
  const meta = (obj.metadata as Record<string, string> | undefined) ?? {}
  const invoiceId = meta.invoiceId || null
  const accountId = meta.accountId || null
  const currency = String(obj.currency ?? 'usd').toUpperCase()

  switch (e?.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (obj.payment_status && obj.payment_status !== 'paid') return null
      const pi = idOf(obj.payment_intent)
      return {
        kind: 'payment',
        paymentIntentId: pi,
        chargeId: null,
        idempotencyKey: pi ?? str(obj.id),
        invoiceId,
        accountId,
        amountReceivedCents: Number(obj.amount_total ?? 0),
        currency,
        method: methodFromTypes(obj.payment_method_types),
      }
    }
    case 'payment_intent.succeeded': {
      const charges = (obj.charges as { data?: Array<{ id?: string; payment_method_details?: { type?: string } }> } | undefined)?.data
      const pi = str(obj.id)
      const detailType = charges?.[0]?.payment_method_details?.type
      return {
        kind: 'payment',
        paymentIntentId: pi,
        chargeId: idOf(obj.latest_charge) ?? str(charges?.[0]?.id),
        idempotencyKey: pi,
        invoiceId,
        accountId,
        amountReceivedCents: Number(obj.amount_received ?? obj.amount ?? 0),
        currency,
        method: detailType ? mapStripeMethodType(detailType) : methodFromTypes(obj.payment_method_types),
      }
    }
    case 'charge.succeeded': {
      const pi = idOf(obj.payment_intent)
      const details = obj.payment_method_details as { type?: string } | undefined
      return {
        kind: 'payment',
        paymentIntentId: pi,
        chargeId: str(obj.id),
        idempotencyKey: pi ?? str(obj.id),
        invoiceId,
        accountId,
        amountReceivedCents: Number(obj.amount_captured ?? obj.amount ?? 0),
        currency,
        method: mapStripeMethodType(details?.type),
      }
    }
    default:
      return null
  }
}

/** Every id a payment for this event may already be recorded under (older rows used the charge id). */
export function stripeDuplicateKeys(p: Pick<StripePaymentEvent, 'idempotencyKey' | 'paymentIntentId' | 'chargeId'>): string[] {
  return [...new Set([p.idempotencyKey, p.paymentIntentId, p.chargeId].filter((k): k is string => !!k))]
}

/** Invoice / payment currency agreement (Stripe sends lowercase ISO codes). */
export function currencyMatches(invoiceCurrency: string, paymentCurrency: string): boolean {
  return invoiceCurrency.trim().toUpperCase() === paymentCurrency.trim().toUpperCase()
}
