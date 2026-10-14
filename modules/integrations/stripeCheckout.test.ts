import { describe, it, expect } from 'vitest'
import {
  buildCheckoutSessionParams,
  checkoutIdempotencyKey,
  checkoutReturnState,
  CheckoutInputError,
  hidesPayButton,
  parseStripeError,
  pendingBankPayment,
  stripeMethodTypes,
  type CheckoutInput,
} from './stripeCheckout'
import { effectiveOnlineMethods } from '@/modules/invoicing/onlinePayments'

const base: CheckoutInput = {
  amountCents: 123456,
  currency: 'USD',
  productName: 'Invoice 42 — Big Sea',
  successUrl: 'https://track2.example.com/i/tok?paid=1&session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'https://track2.example.com/i/tok?canceled=1',
  metadata: { invoiceId: 'inv_1', accountId: 'acc_1', entityId: '' },
  methods: { card: true, ach: true },
  clientReferenceId: 'inv_1',
}

describe('buildCheckoutSessionParams', () => {
  it('charges exactly the balance, in the invoice currency, with the allowed methods and metadata on session + PaymentIntent', () => {
    const p = buildCheckoutSessionParams(base)
    expect(p).toMatchObject({
      mode: 'payment',
      'line_items[0][price_data][unit_amount]': '123456',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][quantity]': '1',
      'payment_method_types[0]': 'card',
      'payment_method_types[1]': 'us_bank_account',
      'metadata[invoiceId]': 'inv_1',
      'metadata[accountId]': 'acc_1',
      'payment_intent_data[metadata][invoiceId]': 'inv_1',
      'payment_intent_data[metadata][accountId]': 'acc_1',
      client_reference_id: 'inv_1',
      success_url: base.successUrl,
      cancel_url: base.cancelUrl,
    })
    expect(p['metadata[entityId]']).toBeUndefined() // empty values are not sent
  })

  it('card only / ACH only follow the invoice choice; never falls back to an unallowed method', () => {
    expect(stripeMethodTypes({ card: true, ach: false }, 'USD')).toEqual(['card'])
    expect(stripeMethodTypes({ card: false, ach: true }, 'usd')).toEqual(['us_bank_account'])
    expect(() => buildCheckoutSessionParams({ ...base, methods: { card: false, ach: false } })).toThrow(CheckoutInputError)
  })

  it('ACH is USD-only: a CAD invoice gets card only, or no checkout at all', () => {
    expect(stripeMethodTypes({ card: true, ach: true }, 'CAD')).toEqual(['card'])
    expect(() => buildCheckoutSessionParams({ ...base, currency: 'CAD', methods: { card: false, ach: true } })).toThrow(/no online payment method/)
    expect(effectiveOnlineMethods({ achEnabled: true }, { acceptOnlinePayments: true, allowCardPayments: true, allowAchPayments: true, currency: 'CAD' })).toBeNull()
    expect(effectiveOnlineMethods({ achEnabled: true }, { acceptOnlinePayments: true, allowCardPayments: true, allowAchPayments: true, currency: 'USD' })).toEqual({ card: false, ach: true })
  })

  it('INV-1: refuses non-integer, zero or negative amounts and bad currencies', () => {
    expect(() => buildCheckoutSessionParams({ ...base, amountCents: 10.5 })).toThrow(CheckoutInputError)
    expect(() => buildCheckoutSessionParams({ ...base, amountCents: 0 })).toThrow(CheckoutInputError)
    expect(() => buildCheckoutSessionParams({ ...base, amountCents: -5 })).toThrow(CheckoutInputError)
    expect(() => buildCheckoutSessionParams({ ...base, currency: 'US' })).toThrow(CheckoutInputError)
  })
})

describe('checkoutIdempotencyKey', () => {
  const t = new Date('2026-10-14T10:00:00Z')
  it('double-click: identical request on the same day → identical key', () => {
    const a = checkoutIdempotencyKey(buildCheckoutSessionParams(base), t)
    const b = checkoutIdempotencyKey(buildCheckoutSessionParams({ ...base }), new Date('2026-10-14T23:59:59Z'))
    expect(a).toBe(b)
    expect(a).toMatch(/^track2-checkout-[0-9a-f]{40}$/)
    expect(a.length).toBeLessThanOrEqual(255) // Stripe's limit
  })
  it('a different balance, method set or day → a different key (no Stripe idempotency_error)', () => {
    const a = checkoutIdempotencyKey(buildCheckoutSessionParams(base), t)
    expect(checkoutIdempotencyKey(buildCheckoutSessionParams({ ...base, amountCents: 100000 }), t)).not.toBe(a)
    expect(checkoutIdempotencyKey(buildCheckoutSessionParams({ ...base, methods: { card: true, ach: false } }), t)).not.toBe(a)
    expect(checkoutIdempotencyKey(buildCheckoutSessionParams(base), new Date('2026-10-15T00:00:01Z'))).not.toBe(a)
  })
  it('key order does not matter', () => {
    const p = buildCheckoutSessionParams(base)
    const reversed = Object.fromEntries(Object.entries(p).reverse())
    expect(checkoutIdempotencyKey(reversed, t)).toBe(checkoutIdempotencyKey(p, t))
  })
})

describe('parseStripeError', () => {
  it('keeps type/code/message only', () => {
    expect(parseStripeError('{"error":{"type":"invalid_request_error","code":"amount_too_small","message":"Amount must be at least $0.50 usd","param":"x"}}')).toEqual({
      type: 'invalid_request_error',
      code: 'amount_too_small',
      message: 'Amount must be at least $0.50 usd',
    })
    expect(parseStripeError('<html>bad gateway</html>')).toEqual({ type: null, code: null, message: null })
  })
})

describe('checkoutReturnState: the return page never shows an error', () => {
  const s = (status: string, paymentStatus: string, invoiceId = 'inv_1') => ({ id: 'cs_1', status, paymentStatus, invoiceId, amountCents: 100, paymentIntentId: 'pi_1' })
  it.each([
    [{ session: s('complete', 'paid'), invoiceStatus: 'open' }, 'paid'], // webhook not here yet — still "received"
    [{ session: s('complete', 'unpaid'), invoiceStatus: 'open' }, 'processing'], // ACH
    [{ session: null, invoiceStatus: 'open' }, 'confirming'], // Stripe lookup failed / no session id
    [{ session: null, invoiceStatus: 'paid' }, 'paid'], // webhook already landed
    [{ session: s('open', 'unpaid'), invoiceStatus: 'open' }, 'not_completed'],
    [{ session: s('expired', 'unpaid'), invoiceStatus: 'open' }, 'not_completed'],
    [{ session: s('complete', 'paid', 'inv_OTHER'), invoiceStatus: 'open' }, 'confirming'], // someone else's session id is not trusted
  ])('%o → %s', (input, expected) => {
    expect(checkoutReturnState({ canceled: false, invoiceId: 'inv_1', ...input })).toBe(expected)
  })
  it('cancel → canceled; Pay hidden only while paid / processing / confirming', () => {
    expect(checkoutReturnState({ canceled: true, invoiceStatus: 'open', session: null, invoiceId: 'inv_1' })).toBe('canceled')
    expect(['paid', 'processing', 'confirming', 'not_completed', 'canceled', null].map((x) => hidesPayButton(x as never))).toEqual([true, true, true, false, false, false])
  })
})

describe('pendingBankPayment', () => {
  const now = new Date('2026-10-14T12:00:00Z')
  const at = (iso: string) => new Date(iso)
  it('a processing ACH payment with nothing after it is pending', () => {
    const r = pendingBankPayment([{ stage: 'payment.processing', externalId: 'pi_2', occurredAt: at('2026-10-12T00:00:00Z'), detail: { amountCents: 5000 } }], now)
    expect(r).toEqual({ paymentIntentId: 'pi_2', amountCents: 5000, since: at('2026-10-12T00:00:00Z') })
  })
  it('settled by recorded / failed later on the same PaymentIntent', () => {
    for (const stage of ['payment.recorded', 'payment.failed', 'payment.flagged']) {
      expect(
        pendingBankPayment(
          [
            { stage: 'payment.processing', externalId: 'pi_2', occurredAt: at('2026-10-12T00:00:00Z'), detail: {} },
            { stage, externalId: 'pi_2', occurredAt: at('2026-10-13T00:00:00Z'), detail: {} },
          ],
          now,
        ),
      ).toBeNull()
    }
  })
  it('an earlier card decline on the same PaymentIntent does not settle a later ACH debit; stale (>10 days) is ignored', () => {
    expect(
      pendingBankPayment(
        [
          { stage: 'payment.failed', externalId: 'pi_2', occurredAt: at('2026-10-11T00:00:00Z'), detail: {} },
          { stage: 'payment.processing', externalId: 'pi_2', occurredAt: at('2026-10-12T00:00:00Z'), detail: {} },
        ],
        now,
      ),
    ).not.toBeNull()
    expect(pendingBankPayment([{ stage: 'payment.processing', externalId: 'pi_2', occurredAt: at('2026-09-01T00:00:00Z'), detail: {} }], now)).toBeNull()
  })
})
