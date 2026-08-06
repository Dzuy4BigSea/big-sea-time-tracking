import 'server-only'

/**
 * Minimal Stripe REST client (no SDK) for creating a hosted Checkout Session.
 * Card/bank details are collected on Stripe's hosted page — the app never sees them.
 */

const STRIPE_API = 'https://api.stripe.com/v1'

export interface CheckoutInput {
  amountCents: number
  currency: string
  productName: string
  successUrl: string
  cancelUrl: string
  metadata: Record<string, string>
  methods: { card: boolean; ach: boolean }
}

function form(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

export async function createCheckoutSession(
  secretKey: string,
  input: CheckoutInput,
): Promise<{ id: string; url: string }> {
  const params: Record<string, string> = {
    mode: 'payment',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': input.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(input.amountCents),
    'line_items[0][price_data][product_data][name]': input.productName,
  }
  const methods: string[] = []
  if (input.methods.card) methods.push('card')
  if (input.methods.ach) methods.push('us_bank_account')
  ;(methods.length ? methods : ['card']).forEach((m, i) => {
    params[`payment_method_types[${i}]`] = m
  })
  for (const [k, v] of Object.entries(input.metadata)) {
    params[`metadata[${k}]`] = v
    params[`payment_intent_data[metadata][${k}]`] = v // so the PaymentIntent carries it too
  }

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form(params),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Stripe checkout session failed (${res.status}): ${text.slice(0, 300)}`)
  }
  const json = (await res.json()) as { id: string; url: string }
  return { id: json.id, url: json.url }
}
