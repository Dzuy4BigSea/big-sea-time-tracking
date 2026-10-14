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
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k === 't' && /^\d+$/.test(v)) timestamp = parseInt(v, 10)
    else if (k === 'v1' && /^[0-9a-f]+$/i.test(v)) signatures.push(v)
  }
  if (!timestamp || signatures.length === 0) return null
  return { timestamp, signatures }
}

export function computeStripeSignature(timestamp: number, rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}

export type SignatureFailure = 'no_secret' | 'missing_header' | 'malformed_header' | 'timestamp_out_of_tolerance' | 'no_matching_signature'

/**
 * Verify a Stripe webhook against the raw (unparsed) body: ok only when a v1 signature matches
 * (timing-safe compare) and the timestamp is within `toleranceSec` of `nowSec` (replay
 * protection). Runs BEFORE the body is parsed or acted on.
 */
export function checkStripeSignature(
  rawBody: string,
  sigHeader: string | null,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): { ok: true } | { ok: false; reason: SignatureFailure } {
  if (!secret) return { ok: false, reason: 'no_secret' }
  if (!sigHeader) return { ok: false, reason: 'missing_header' }
  const parsed = parseStripeSigHeader(sigHeader)
  if (!parsed) return { ok: false, reason: 'malformed_header' }
  if (Math.abs(nowSec - parsed.timestamp) > toleranceSec) return { ok: false, reason: 'timestamp_out_of_tolerance' }
  const expectedBuf = Buffer.from(computeStripeSignature(parsed.timestamp, rawBody, secret), 'hex')
  const match = parsed.signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'hex')
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)
  })
  return match ? { ok: true } : { ok: false, reason: 'no_matching_signature' }
}

/** Boolean form of checkStripeSignature. */
export function verifyStripeWebhook(
  rawBody: string,
  sigHeader: string | null,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): boolean {
  return checkStripeSignature(rawBody, sigHeader, secret, nowSec, toleranceSec).ok
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

function onlyCardAndAch(types: unknown): boolean {
  return Array.isArray(types) && types.length > 0 && types.every((t) => t === 'card' || t === 'us_bank_account')
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
      // Track2 offers card and/or us_bank_account. A bank debit never completes as 'paid' (it
      // settles later via async_payment_succeeded), so a session paid at completion is a card and
      // an async success is a bank debit.
      let method = methodFromTypes(obj.payment_method_types)
      if (method === 'other' && onlyCardAndAch(obj.payment_method_types)) {
        method = e.type === 'checkout.session.async_payment_succeeded' ? 'bank_transfer' : 'card'
      }
      return {
        kind: 'payment',
        paymentIntentId: pi,
        chargeId: null,
        idempotencyKey: pi ?? str(obj.id),
        invoiceId,
        accountId,
        amountReceivedCents: Number(obj.amount_total ?? 0),
        currency,
        method,
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

// ---------------------------------------------------------------------------
// Event → action mapping (every event type the webhook handles; specs/14 §2, OPS.md "Stripe payments")
// ---------------------------------------------------------------------------

/**
 * What the webhook does with a verified event:
 * - record:     money arrived → recordPayment once (keyed by the PaymentIntent id)
 * - processing: Checkout finished but a bank debit (ACH) has not settled → do NOT mark paid
 * - failed:     the client's payment did not go through → trace; the invoice stays open
 * - refunded / disputed: money is going back → trace at error level for a human; invoice untouched
 * - ignore:     anything else → 200 straight away
 */
export type StripeEventAction = 'record' | 'processing' | 'failed' | 'refunded' | 'disputed' | 'ignore'

/** The facts we keep about an event. Deliberately small: never the payload, never customer data. */
export interface StripeEventFacts {
  eventId: string | null
  type: string
  livemode: boolean | null
  createdSec: number | null
  paymentIntentId: string | null
  chargeId: string | null
  sessionId: string | null
  invoiceId: string | null
  accountId: string | null
  amountCents: number | null
  currency: string | null
  /** Checkout payment_status / PaymentIntent status / refund extent / dispute reason. */
  status: string | null
  /** Stripe decline / failure code (never the free-text message). */
  failureCode: string | null
}

export interface ClassifiedStripeEvent {
  action: StripeEventAction
  facts: StripeEventFacts
  /** Set only for action 'record'. */
  payment: StripePaymentEvent | null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function classifyStripeEvent(event: unknown): ClassifiedStripeEvent {
  const e = (event ?? {}) as { id?: unknown; type?: unknown; livemode?: unknown; created?: unknown; data?: { object?: Record<string, unknown> } }
  const obj = e.data?.object ?? {}
  const meta = (obj.metadata as Record<string, unknown> | undefined) ?? {}
  const type = typeof e.type === 'string' ? e.type : ''
  const facts: StripeEventFacts = {
    eventId: str(e.id),
    type,
    livemode: typeof e.livemode === 'boolean' ? e.livemode : null,
    createdSec: num(e.created),
    paymentIntentId: null,
    chargeId: null,
    sessionId: null,
    invoiceId: str(meta.invoiceId),
    accountId: str(meta.accountId),
    amountCents: null,
    currency: str(obj.currency)?.toUpperCase() ?? null,
    status: null,
    failureCode: null,
  }
  const out = (action: StripeEventAction, payment: StripePaymentEvent | null = null): ClassifiedStripeEvent => ({ action, facts, payment })

  switch (type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed':
      facts.sessionId = str(obj.id)
      facts.paymentIntentId = idOf(obj.payment_intent)
      facts.amountCents = num(obj.amount_total)
      facts.status = str(obj.payment_status)
      if (type === 'checkout.session.async_payment_failed') return out('failed')
      if (facts.status === 'unpaid') return out('processing') // ACH: wait for async_payment_succeeded
      if (facts.status !== 'paid') return out('ignore') // e.g. no_payment_required
      break
    case 'payment_intent.succeeded':
      facts.paymentIntentId = str(obj.id)
      facts.chargeId = idOf(obj.latest_charge)
      facts.amountCents = num(obj.amount_received) ?? num(obj.amount)
      facts.status = str(obj.status)
      break
    case 'payment_intent.payment_failed': {
      const err = (obj.last_payment_error ?? {}) as { code?: unknown; decline_code?: unknown }
      facts.paymentIntentId = str(obj.id)
      facts.amountCents = num(obj.amount)
      facts.status = str(obj.status)
      facts.failureCode = str(err.decline_code) ?? str(err.code)
      return out('failed')
    }
    case 'charge.succeeded':
      facts.chargeId = str(obj.id)
      facts.paymentIntentId = idOf(obj.payment_intent)
      facts.amountCents = num(obj.amount_captured) ?? num(obj.amount)
      facts.status = str(obj.status)
      break
    case 'charge.refunded':
      facts.chargeId = str(obj.id)
      facts.paymentIntentId = idOf(obj.payment_intent)
      facts.amountCents = num(obj.amount_refunded)
      facts.status = obj.refunded === true ? 'fully_refunded' : 'partially_refunded'
      return out('refunded')
    case 'charge.dispute.created':
      // The object is a Dispute (dp_…); obj.charge is the disputed charge.
      facts.chargeId = idOf(obj.charge)
      facts.paymentIntentId = idOf(obj.payment_intent)
      facts.amountCents = num(obj.amount)
      facts.status = str(obj.reason)
      return out('disputed')
    default:
      return out('ignore')
  }

  const payment = parseStripePaymentEvent(event)
  if (!payment || !payment.idempotencyKey) return out('ignore')
  // INV-1: Stripe amounts are integer minor units; anything else is not a payment we can apply.
  if (!Number.isInteger(payment.amountReceivedCents) || payment.amountReceivedCents <= 0) return out('ignore')
  return out('record', payment)
}

/** Trace-safe summary of an event for InvoiceEvent.detail: ids, amount, currency, status. No payload. */
export function stripeEventSummary(f: StripeEventFacts, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventType: f.type,
    livemode: f.livemode,
    paymentIntentId: f.paymentIntentId,
    chargeId: f.chargeId,
    sessionId: f.sessionId,
    amountCents: f.amountCents,
    currency: f.currency,
    status: f.status,
    ...(f.failureCode ? { failureCode: f.failureCode } : {}),
    ...extra,
  }
}
