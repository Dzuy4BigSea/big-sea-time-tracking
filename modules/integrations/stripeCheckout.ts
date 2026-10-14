/**
 * Stripe Checkout for the public invoice page (specs/14 §2): pure pieces, unit-tested in
 * stripeCheckout.test.ts. The HTTP calls are in stripeClient.ts.
 */
import { createHash } from 'node:crypto'

export interface CheckoutInput {
  /** The invoice's remaining balance, integer minor units (INV-1). */
  amountCents: number
  /** The invoice currency (ISO 4217). */
  currency: string
  productName: string
  successUrl: string
  cancelUrl: string
  /** invoiceId + accountId (+ entityId): copied to the session AND its PaymentIntent. */
  metadata: Record<string, string>
  methods: { card: boolean; ach: boolean }
  /** Our invoice id, shown in the Stripe Dashboard as the session's client_reference_id. */
  clientReferenceId?: string
}

export class CheckoutInputError extends Error {}

/** Stripe's ACH Direct Debit (us_bank_account) only charges USD. */
export function stripeMethodTypes(methods: { card: boolean; ach: boolean }, currency: string): string[] {
  const types: string[] = []
  if (methods.card) types.push('card')
  if (methods.ach && currency.trim().toUpperCase() === 'USD') types.push('us_bank_account')
  return types
}

/** Form fields for POST /v1/checkout/sessions. Throws CheckoutInputError on anything we must not send. */
export function buildCheckoutSessionParams(input: CheckoutInput): Record<string, string> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new CheckoutInputError(`amount must be a positive integer number of cents (got ${input.amountCents})`)
  if (!/^[A-Za-z]{3}$/.test(input.currency.trim())) throw new CheckoutInputError(`bad currency "${input.currency}"`)
  const types = stripeMethodTypes(input.methods, input.currency)
  // Never fall back to a method the invoice / company didn't allow.
  if (types.length === 0) throw new CheckoutInputError(`no online payment method available for ${input.currency.toUpperCase()}`)

  const params: Record<string, string> = {
    mode: 'payment',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': input.currency.trim().toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(input.amountCents),
    'line_items[0][price_data][product_data][name]': input.productName.slice(0, 250),
  }
  if (input.clientReferenceId) params.client_reference_id = input.clientReferenceId
  types.forEach((m, i) => {
    params[`payment_method_types[${i}]`] = m
  })
  for (const [k, v] of Object.entries(input.metadata)) {
    if (!v) continue
    params[`metadata[${k}]`] = v
    params[`payment_intent_data[metadata][${k}]`] = v // so PaymentIntent / charge events carry it too
  }
  return params
}

export function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

/**
 * Idempotency-Key for creating the session: the same invoice, amount, methods and URLs on the
 * same UTC day give the same key, so a double-clicked Pay (or a back-and-retry) gets the same
 * session instead of a second one. A changed balance or method set is a different request and a
 * different key (Stripe rejects a reused key with different parameters). The day bucket keeps a
 * replay younger than the session's 24-hour lifetime, so the cached response never points at an
 * expired session.
 */
export function checkoutIdempotencyKey(params: Record<string, string>, now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10)
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  return `track2-checkout-${createHash('sha256').update(`${day}|${canonical}`).digest('hex').slice(0, 40)}`
}

/** Pull the safe parts out of a Stripe error response body (never the raw body). */
export function parseStripeError(text: string): { type: string | null; code: string | null; message: string | null } {
  try {
    const err = (JSON.parse(text) as { error?: { type?: unknown; code?: unknown; message?: unknown } }).error ?? {}
    const s = (v: unknown) => (typeof v === 'string' && v ? v : null)
    return { type: s(err.type), code: s(err.code), message: s(err.message)?.slice(0, 300) ?? null }
  } catch {
    return { type: null, code: null, message: null }
  }
}

// ---------------------------------------------------------------------------
// What the client sees after Stripe sends them back (success_url / cancel_url)
// ---------------------------------------------------------------------------

export type ReturnState = 'paid' | 'processing' | 'confirming' | 'not_completed' | 'canceled'

export interface CheckoutSessionView {
  id: string
  status: string | null // open | complete | expired
  paymentStatus: string | null // paid | unpaid | no_payment_required
  invoiceId: string | null // metadata.invoiceId
  amountCents: number | null
  paymentIntentId: string | null
}

/**
 * The return banner. Never an error: if the webhook hasn't landed yet, or the Stripe lookup
 * fails, the client is told we're confirming their payment, not that something went wrong.
 */
export function checkoutReturnState(input: {
  canceled: boolean
  invoiceStatus: string
  session: CheckoutSessionView | null
  invoiceId: string
}): ReturnState {
  if (input.canceled) return 'canceled'
  if (input.invoiceStatus === 'paid') return 'paid'
  const s = input.session && input.session.invoiceId === input.invoiceId ? input.session : null
  if (!s) return 'confirming'
  if (s.paymentStatus === 'paid') return 'paid'
  if (s.status === 'complete' && s.paymentStatus === 'unpaid') return 'processing'
  if (s.status === 'open' || s.status === 'expired') return 'not_completed'
  return 'confirming'
}

export const RETURN_MESSAGE: Record<ReturnState, { title: string; body: string; tone: 'success' | 'info' | 'neutral' }> = {
  paid: { title: 'Payment received — thank you', body: 'Your payment went through. A receipt is on its way by email; this invoice shows as paid within a minute.', tone: 'success' },
  processing: { title: 'Payment processing', body: 'Your bank transfer has started. Bank payments take 3–5 business days to clear; this invoice will show as paid once it does. There is no need to pay again.', tone: 'info' },
  confirming: { title: 'Thanks — we’re confirming your payment', body: 'Stripe is confirming your payment. This invoice will update shortly; there is no need to pay again.', tone: 'info' },
  not_completed: { title: 'Payment not completed', body: 'Your payment wasn’t completed and you have not been charged. You can try again below.', tone: 'neutral' },
  canceled: { title: 'Payment canceled', body: 'You have not been charged. You can pay whenever you’re ready.', tone: 'neutral' },
}

/** Whether to hide the Pay button so the client can't pay twice. */
export function hidesPayButton(state: ReturnState | null): boolean {
  return state === 'paid' || state === 'processing' || state === 'confirming'
}

// ---------------------------------------------------------------------------
// A bank payment still in flight (from the invoice trace)
// ---------------------------------------------------------------------------

export interface PaymentTraceRow {
  stage: string
  externalId: string | null
  occurredAt: Date
  detail: unknown
}

/** Stages that settle a 'payment.processing' row for the same PaymentIntent. */
const SETTLING = new Set(['payment.recorded', 'payment.failed', 'payment.flagged', 'payment.duplicate_ignored', 'payment.refunded'])
const PENDING_WINDOW_DAYS = 10

/**
 * The newest bank (ACH) payment that started (checkout completed, unpaid) and has not since been
 * recorded, failed or flagged. While it is in flight the public page says so and hides Pay, so a
 * client doesn't pay a second time while the first transfer clears.
 */
export function pendingBankPayment(rows: PaymentTraceRow[], now: Date = new Date()): { paymentIntentId: string; amountCents: number | null; since: Date } | null {
  const cutoff = now.getTime() - PENDING_WINDOW_DAYS * 86_400_000
  // A card decline earlier in the same Checkout (same PaymentIntent) doesn't settle a later bank debit.
  const settledAfter = (pi: string, t: number) => rows.some((r) => SETTLING.has(r.stage) && r.externalId === pi && r.occurredAt.getTime() >= t)
  const pending = rows
    .filter((r) => r.stage === 'payment.processing' && r.externalId && r.occurredAt.getTime() >= cutoff && !settledAfter(r.externalId, r.occurredAt.getTime()))
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0]
  if (!pending) return null
  const amount = (pending.detail as { amountCents?: unknown } | null)?.amountCents
  return { paymentIntentId: pending.externalId!, amountCents: typeof amount === 'number' ? amount : null, since: pending.occurredAt }
}
