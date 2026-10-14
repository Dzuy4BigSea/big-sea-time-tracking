import { describe, it, expect } from 'vitest'
import {
  parseStripeSigHeader,
  computeStripeSignature,
  verifyStripeWebhook,
  parseStripePaymentEvent,
  stripeDuplicateKeys,
  currencyMatches,
  mapStripeMethodType,
  checkStripeSignature,
  classifyStripeEvent,
  stripeEventSummary,
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
    expect(ev).toMatchObject({ paymentIntentId: 'pi_9', idempotencyKey: 'pi_9', invoiceId: 'inv_9', amountReceivedCents: 10000 })
  })

  it('ignores unrelated event types', () => {
    expect(parseStripePaymentEvent({ type: 'customer.created', data: { object: {} } })).toBeNull()
  })

  it('ignores an unpaid checkout session', () => {
    expect(
      parseStripePaymentEvent({ type: 'checkout.session.completed', data: { object: { payment_status: 'unpaid' } } }),
    ).toBeNull()
  })

  it('one payment has the same idempotency key (the PaymentIntent id) across all event types', () => {
    const session = parseStripePaymentEvent({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_intent: 'pi_7', payment_status: 'paid', amount_total: 500, currency: 'usd', payment_method_types: ['card', 'us_bank_account'] } },
    })!
    const intent = parseStripePaymentEvent({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_7', latest_charge: 'ch_7', amount_received: 500, currency: 'usd' } },
    })!
    const charge = parseStripePaymentEvent({
      type: 'charge.succeeded',
      data: { object: { id: 'ch_7', payment_intent: 'pi_7', amount_captured: 500, currency: 'usd', payment_method_details: { type: 'card' } } },
    })!
    expect([session.idempotencyKey, intent.idempotencyKey, charge.idempotencyKey]).toEqual(['pi_7', 'pi_7', 'pi_7'])
    // legacy rows were keyed by charge id — the duplicate check covers both
    expect(stripeDuplicateKeys(intent)).toEqual(['pi_7', 'ch_7'])
    expect(charge.method).toBe('card')
    // card + ACH offered: a session already 'paid' at completion is a card (ACH settles later)
    expect(session.method).toBe('card')
  })

  it('falls back to the charge / session id when there is no PaymentIntent', () => {
    expect(parseStripePaymentEvent({ type: 'charge.succeeded', data: { object: { id: 'ch_9', amount: 100 } } })!.idempotencyKey).toBe('ch_9')
  })

  it('handles ACH: async_payment_succeeded and us_bank_account → bank_transfer', () => {
    const ev = parseStripePaymentEvent({
      type: 'checkout.session.async_payment_succeeded',
      data: { object: { id: 'cs_2', payment_intent: 'pi_2', payment_status: 'paid', amount_total: 900, currency: 'usd', payment_method_types: ['us_bank_account'] } },
    })!
    expect(ev.idempotencyKey).toBe('pi_2')
    expect(ev.method).toBe('bank_transfer')
    expect(mapStripeMethodType('card')).toBe('card')
    expect(mapStripeMethodType('us_bank_account')).toBe('bank_transfer')
    expect(mapStripeMethodType('klarna')).toBe('other')
  })

  it('currencyMatches is case-insensitive', () => {
    expect(currencyMatches('USD', 'usd')).toBe(true)
    expect(currencyMatches('USD', 'CAD')).toBe(false)
  })
})

describe('checkStripeSignature reasons', () => {
  const header = signedHeader(NOW, BODY, SECRET)
  it('valid', () => expect(checkStripeSignature(BODY, header, SECRET, NOW)).toEqual({ ok: true }))
  it('missing header / secret', () => {
    expect(checkStripeSignature(BODY, null, SECRET, NOW)).toEqual({ ok: false, reason: 'missing_header' })
    expect(checkStripeSignature(BODY, '', SECRET, NOW)).toEqual({ ok: false, reason: 'missing_header' })
    expect(checkStripeSignature(BODY, header, '', NOW)).toEqual({ ok: false, reason: 'no_secret' })
  })
  it('malformed header (no t, no v1, non-numeric t, non-hex v1)', () => {
    expect(checkStripeSignature(BODY, 'v1=abcd', SECRET, NOW)).toEqual({ ok: false, reason: 'malformed_header' })
    expect(checkStripeSignature(BODY, `t=${NOW}`, SECRET, NOW)).toEqual({ ok: false, reason: 'malformed_header' })
    expect(checkStripeSignature(BODY, `t=12x,v1=abcd`, SECRET, NOW)).toEqual({ ok: false, reason: 'malformed_header' })
    expect(checkStripeSignature(BODY, `t=${NOW},v1=zzzz`, SECRET, NOW)).toEqual({ ok: false, reason: 'malformed_header' })
  })
  it('expired (and future) timestamps are refused even with a valid HMAC', () => {
    expect(checkStripeSignature(BODY, signedHeader(NOW - 301, BODY, SECRET), SECRET, NOW)).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' })
    expect(checkStripeSignature(BODY, signedHeader(NOW + 301, BODY, SECRET), SECRET, NOW)).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' })
    expect(checkStripeSignature(BODY, signedHeader(NOW - 300, BODY, SECRET), SECRET, NOW).ok).toBe(true)
  })
  it('tampered body / wrong secret / truncated signature', () => {
    expect(checkStripeSignature(BODY.replace('evt_1', 'evt_2'), header, SECRET, NOW)).toEqual({ ok: false, reason: 'no_matching_signature' })
    expect(checkStripeSignature(BODY, header, 'whsec_other', NOW)).toEqual({ ok: false, reason: 'no_matching_signature' })
    expect(checkStripeSignature(BODY, `t=${NOW},v1=${computeStripeSignature(NOW, BODY, SECRET).slice(0, 32)}`, SECRET, NOW)).toEqual({ ok: false, reason: 'no_matching_signature' })
  })
  it('secret rotation: any matching v1 among several passes; v0 and unknown parts are ignored; spaces tolerated', () => {
    const good = computeStripeSignature(NOW, BODY, SECRET)
    expect(checkStripeSignature(BODY, `t=${NOW}, v1=${'0'.repeat(64)}, v1=${good}, v0=deadbeef, x=y`, SECRET, NOW).ok).toBe(true)
  })
})

describe('classifyStripeEvent: event → action', () => {
  const ev = (type: string, object: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: 'evt_x', type, livemode: false, created: NOW, data: { object }, ...extra })
  const meta = { invoiceId: 'inv_1', accountId: 'acc_1' }

  it.each([
    ['checkout.session.completed', { id: 'cs_1', payment_intent: 'pi_1', payment_status: 'paid', amount_total: 100, currency: 'usd', metadata: meta }, 'record'],
    ['checkout.session.completed', { id: 'cs_1', payment_intent: 'pi_1', payment_status: 'unpaid', amount_total: 100, currency: 'usd', metadata: meta }, 'processing'],
    ['checkout.session.completed', { id: 'cs_1', payment_status: 'no_payment_required', amount_total: 0, currency: 'usd' }, 'ignore'],
    ['checkout.session.async_payment_succeeded', { id: 'cs_1', payment_intent: 'pi_1', payment_status: 'paid', amount_total: 100, currency: 'usd', metadata: meta }, 'record'],
    ['checkout.session.async_payment_failed', { id: 'cs_1', payment_intent: 'pi_1', payment_status: 'unpaid', amount_total: 100, currency: 'usd', metadata: meta }, 'failed'],
    ['payment_intent.succeeded', { id: 'pi_1', amount_received: 100, currency: 'usd', metadata: meta }, 'record'],
    ['payment_intent.payment_failed', { id: 'pi_1', amount: 100, currency: 'usd', last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds', message: 'Your card has insufficient funds.' } }, 'failed'],
    ['charge.succeeded', { id: 'ch_1', payment_intent: 'pi_1', amount_captured: 100, currency: 'usd', payment_method_details: { type: 'card' } }, 'record'],
    ['charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', amount_refunded: 50, refunded: false, currency: 'usd' }, 'refunded'],
    ['charge.dispute.created', { id: 'dp_1', charge: 'ch_1', payment_intent: 'pi_1', amount: 100, reason: 'fraudulent', currency: 'usd' }, 'disputed'],
    ['customer.created', { id: 'cus_1' }, 'ignore'],
    ['payment_intent.succeeded', { id: 'pi_1', amount_received: 0, currency: 'usd' }, 'ignore'],
    ['payment_intent.succeeded', { id: 'pi_1', amount_received: 10.5, currency: 'usd' }, 'ignore'], // INV-1: never a fractional amount
  ])('%s → %s', (type, object, action) => {
    expect(classifyStripeEvent(ev(type, object)).action).toBe(action)
  })

  it('keeps only small, safe facts (decline code, never the cardholder message)', () => {
    const c = classifyStripeEvent(ev('payment_intent.payment_failed', { id: 'pi_1', amount: 100, currency: 'usd', last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds', message: 'secret-ish text' } }))
    expect(c.facts).toMatchObject({ eventId: 'evt_x', paymentIntentId: 'pi_1', amountCents: 100, currency: 'USD', failureCode: 'insufficient_funds', livemode: false, createdSec: NOW })
    expect(JSON.stringify(stripeEventSummary(c.facts))).not.toContain('secret-ish')
  })

  it('refund extent and dispute reason', () => {
    expect(classifyStripeEvent(ev('charge.refunded', { id: 'ch_1', amount_refunded: 100, refunded: true })).facts.status).toBe('fully_refunded')
    const d = classifyStripeEvent(ev('charge.dispute.created', { id: 'dp_1', charge: 'ch_1', amount: 100, reason: 'fraudulent' })).facts
    expect(d).toMatchObject({ chargeId: 'ch_1', status: 'fraudulent', amountCents: 100 })
  })

  it('async success is a bank transfer even when card was also offered', () => {
    const c = classifyStripeEvent(ev('checkout.session.async_payment_succeeded', { id: 'cs_1', payment_intent: 'pi_1', payment_status: 'paid', amount_total: 100, currency: 'usd', payment_method_types: ['card', 'us_bank_account'] }))
    expect(c.payment?.method).toBe('bank_transfer')
  })
})
