import 'server-only'

/**
 * Minimal Stripe REST client (no SDK) for the hosted Checkout Session.
 * Card/bank details are collected on Stripe's hosted page — the app never sees them (AC-STRIPE-005).
 * Request building is pure and tested in stripeCheckout.ts.
 */
import {
  buildCheckoutSessionParams,
  checkoutIdempotencyKey,
  formEncode,
  parseStripeError,
  type CheckoutInput,
  type CheckoutSessionView,
} from '@/modules/integrations/stripeCheckout'

export type { CheckoutInput } from '@/modules/integrations/stripeCheckout'

const STRIPE_API = 'https://api.stripe.com/v1'
const TIMEOUT_MS = 15_000

/** A Stripe API refusal, with only the safe parts of the response. */
export class StripeApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly stripeType: string | null,
    readonly stripeCode: string | null,
    message: string,
  ) {
    super(message)
    this.name = 'StripeApiError'
  }
}

export interface CreatedCheckoutSession {
  id: string
  url: string
  /** Stripe answered from its idempotency cache (a repeat click got the same session). */
  replayed: boolean
  idempotencyKey: string
  methodTypes: string[]
}

export async function createCheckoutSession(secretKey: string, input: CheckoutInput, now: Date = new Date()): Promise<CreatedCheckoutSession> {
  const params = buildCheckoutSessionParams(input)
  const idempotencyKey = checkoutIdempotencyKey(params, now)
  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    body: formEncode(params),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    const err = parseStripeError(await res.text())
    throw new StripeApiError(res.status, err.type, err.code, `Stripe checkout session failed (${res.status}${err.code ? ` ${err.code}` : ''}): ${err.message ?? 'no message'}`)
  }
  const json = (await res.json()) as { id: string; url: string }
  return {
    id: json.id,
    url: json.url,
    replayed: res.headers.get('idempotent-replayed') === 'true',
    idempotencyKey,
    methodTypes: Object.keys(params).filter((k) => k.startsWith('payment_method_types[')).map((k) => params[k]),
  }
}

/** Look up a Checkout Session (for the success page). Null on any failure — never throws. */
export async function retrieveCheckoutSession(secretKey: string, sessionId: string): Promise<CheckoutSessionView | null> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return null
  try {
    const res = await fetch(`${STRIPE_API}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
      signal: AbortSignal.timeout(5_000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const s = (await res.json()) as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
    const pi = s.payment_intent
    return {
      id: String(s.id),
      status: str(s.status),
      paymentStatus: str(s.payment_status),
      invoiceId: str((s.metadata as Record<string, unknown> | null)?.invoiceId),
      amountCents: typeof s.amount_total === 'number' ? s.amount_total : null,
      paymentIntentId: str(pi) ?? str((pi as { id?: unknown } | null)?.id),
    }
  } catch {
    return null
  }
}
