import { describe, it, expect } from 'vitest'
import {
  parseStripeSigHeader,
  computeStripeSignature,
  verifyStripeWebhook,
  parseStripePaymentEvent,
} from './stripeWebhook'

const SECRET = 'whsec_test_secret'
const BODY = '{"id":"evt_1","type":"payment_intent.succeeded"}'
const NOW = 1_700_000_000

function signedHeader(ts: number, body: string, secret: string) {
  return `t=${ts},v1=${computeStripeSignature(ts, body, secret)}`
}

describe('stripe signature verification', () => {
  it('accepts a correctly signed, in-tolerance payload', () => {
    const header = signedHeader(NOW, BODY, SECRET)
    expect(verifyStripeWebhook(BODY, header, SECRET, NOW)).toBe(true)
  })

  it('rejects a wrong secret', () => {
    const header = signedHeader(NOW, BODY, 'whsec_wrong')
    expect(verifyStripeWebhook(BODY, header, SECRET, NOW)).toBe(false)
  })

  it('rejects a tampered body', () => {
    const header = signedHeader(NOW, BODY, SECRET)
    expect(verifyStripeWebhook(BODY + 'x', header, SECRET, NOW)).toBe(false)
  })

  it('rejects a stale timestamp (replay) beyond tolerance', () => {
    const header = signedHeader(NOW - 10_000, BODY, SECRET)
    expect(verifyStripeWebhook(BODY, header, SECRET, NOW, 300)).toBe(false)
  })

  it('rejects a malformed / missing header', () => {
    expect(verifyStripeWebhook(BODY, null, SECRET, NOW)).toBe(false)
    expect(verifyStripeWebhook(BODY, 'garbage', SECRET, NOW)).toBe(false)
    expect(parseStripeSigHeader('garbage')).toBeNull()
  })
})

describe('stripe event parsing', () => {
  it('parses payment_intent.succeeded with metadata', () => {
    const ev = parseStripePaymentEvent({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', latest_charge: 'ch_1', amount_received: 52500, currency: 'usd', metadata: { invoiceId: 'inv_1', accountId: 'acc_demo' } } },
    })
    expect(ev).toMatchObject({ paymentIntentId: 'pi_1', chargeId: 'ch_1', invoiceId: 'inv_1', accountId: 'acc_demo', amountReceivedCents: 52500, currency: 'USD' })
  })

  it('parses checkout.session.completed (paid)', () => {
    const ev = parseStripePaymentEvent({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_intent: 'pi_9', payment_status: 'paid', amount_total: 10000, currency: 'usd', metadata: { invoiceId: 'inv_9' } } },
    })
    expect(ev).toMatchObject({ chargeId: 'pi_9', invoiceId: 'inv_9', amountReceivedCents: 10000 })
  })

  it('ignores unrelated event types', () => {
    expect(parseStripePaymentEvent({ type: 'customer.created', data: { object: {} } })).toBeNull()
  })

  it('ignores an unpaid checkout session', () => {
    expect(
      parseStripePaymentEvent({ type: 'checkout.session.completed', data: { object: { payment_status: 'unpaid' } } }),
    ).toBeNull()
  })
})
