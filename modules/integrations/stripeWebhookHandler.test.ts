/**
 * Route-level tests for the Stripe webhook: real signed bodies through handleStripeWebhook with an
 * in-memory "database" that enforces the same unique keys as Postgres (Payment.stripeChargeId,
 * InvoiceEvent(source, externalEventId)).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { PaymentMethod } from '@prisma/client'
import { handleStripeWebhook, type StripeWebhookPorts, type WebhookInvoice } from './stripeWebhookHandler'
import { computeStripeSignature } from './stripeWebhook'
import type { InvoiceTraceEvent } from '@/modules/observability/invoiceTrace'
import { applyInvoiceAction, deriveStatusAfterPayment, InvalidTransitionError, type StoredStatus } from '@/modules/invoicing/invoiceState'
import type { StripeRecordOutcome } from '@/modules/invoicing/recordStripePayment'

const ACC = 'acc_1'
const SECRET = 'whsec_entity_a'
const SECRET_B = 'whsec_entity_b'
const NOW = 1_760_000_000

interface Pay { id: string; invoiceId: string; amountCents: number; key: string; method: PaymentMethod; paidOn: Date }

function world() {
  const invoices = new Map<string, WebhookInvoice & { stripePaymentIntentId?: string | null }>()
  const payments: Pay[] = []
  const traces: InvoiceTraceEvent[] = []
  const audits: string[] = []
  const syncs: Array<{ ok: boolean; message?: string | null }> = []
  const after: string[] = []
  let failNextRecord: Error | null = null
  let beforeRecordHook: (() => Promise<void>) | null = null

  const ports: StripeWebhookPorts = {
    nowSec: () => NOW,
    listConnections: async (accountId) =>
      accountId === ACC
        ? [
            { entityId: 'ent_a', status: 'connected', secrets: { webhookSecret: SECRET } },
            { entityId: 'ent_b', status: 'connected', secrets: { webhookSecret: SECRET_B } },
            { entityId: 'ent_c', status: 'disconnected', secrets: { webhookSecret: 'whsec_disconnected' } },
          ]
        : [],
    async trace(e) {
      if (e.externalEventId && traces.some((t) => t.source === e.source && t.externalEventId === e.externalEventId)) return 'duplicate'
      traces.push(e)
      return 'recorded'
    },
    async findInvoice(accountId, by) {
      if (accountId !== ACC) return null
      if (by.invoiceId && invoices.has(by.invoiceId)) return { ...invoices.get(by.invoiceId)! }
      for (const inv of invoices.values()) if (by.paymentIntentId && inv.stripePaymentIntentId === by.paymentIntentId) return { ...inv }
      return null
    },
    async findPayment(_a, keys) {
      const p = payments.find((x) => keys.includes(x.key))
      return p ? { id: p.id, invoiceId: p.invoiceId, amountCents: p.amountCents } : null
    },
    paidOnFor: async (_a, at) => new Date(at.toISOString().slice(0, 10) + 'T00:00:00Z'),
    async recordPayment(input): Promise<StripeRecordOutcome> {
      if (beforeRecordHook) {
        const h = beforeRecordHook
        beforeRecordHook = null
        await h()
      }
      if (failNextRecord) {
        const e = failNextRecord
        failNextRecord = null
        throw e
      }
      const inv = invoices.get(input.invoiceId)!
      if (payments.some((p) => p.key === input.key)) return { outcome: 'duplicate' } // unique index
      try {
        applyInvoiceAction({ status: inv.status as StoredStatus, totalCents: inv.totalCents, paidCents: inv.paidCents, lineItemCount: 1, sentAt: new Date(), number: '1' }, 'record_payment', { amountCents: input.amountCents, allowOverpayment: true })
      } catch (e) {
        if (e instanceof InvalidTransitionError) return { outcome: 'not_open', reason: e.message }
        throw e
      }
      const id = `pay_${payments.length + 1}`
      payments.push({ id, invoiceId: input.invoiceId, amountCents: input.amountCents, key: input.key, method: input.method, paidOn: input.paidOn })
      inv.paidCents += input.amountCents
      inv.status = deriveStatusAfterPayment(inv.totalCents, inv.paidCents)
      if (input.paymentIntentId) inv.stripePaymentIntentId = input.paymentIntentId
      return { outcome: 'recorded', paymentId: id, paidCents: inv.paidCents, totalCents: inv.totalCents, status: inv.status }
    },
    logSync: async (i) => void syncs.push(i),
    audit: async (_a, _i, s) => void audits.push(s),
    afterRecorded: async (_a, invoiceId, amount) => void after.push(`${invoiceId}:${amount}`),
    formatMoney: (c, cur) => `${cur.toUpperCase()} ${(c / 100).toFixed(2)}`,
  }
  return {
    ports,
    invoices,
    payments,
    traces,
    audits,
    syncs,
    after,
    failRecordOnce: (e: Error) => void (failNextRecord = e),
    beforeRecord: (h: () => Promise<void>) => void (beforeRecordHook = h),
    stages: () => traces.map((t) => t.stage),
  }
}

let n = 0
function event(type: string, object: Record<string, unknown>, id = `evt_${++n}`) {
  return { id, object: 'event', type, livemode: false, created: NOW - 5, data: { object } }
}
function signed(body: unknown, secret = SECRET, ts = NOW) {
  const raw = JSON.stringify(body)
  return { rawBody: raw, signatureHeader: `t=${ts},v1=${computeStripeSignature(ts, raw, secret)}` }
}
async function deliver(w: ReturnType<typeof world>, body: unknown, secret = SECRET, accountId = ACC) {
  return handleStripeWebhook(w.ports, { accountId, ...signed(body, secret) })
}

const meta = { invoiceId: 'inv_1', accountId: ACC }
const sessionPaid = (extra: Record<string, unknown> = {}) =>
  event('checkout.session.completed', { id: 'cs_1', object: 'checkout.session', payment_intent: 'pi_1', payment_status: 'paid', status: 'complete', amount_total: 50000, currency: 'usd', payment_method_types: ['card'], metadata: meta, ...extra })
const piSucceeded = (extra: Record<string, unknown> = {}) =>
  event('payment_intent.succeeded', { id: 'pi_1', object: 'payment_intent', latest_charge: 'ch_1', amount_received: 50000, currency: 'usd', status: 'succeeded', metadata: meta, ...extra })
const chargeSucceeded = () =>
  event('charge.succeeded', { id: 'ch_1', object: 'charge', payment_intent: 'pi_1', amount_captured: 50000, currency: 'usd', status: 'succeeded', payment_method_details: { type: 'card' }, metadata: meta })

let w: ReturnType<typeof world>
beforeEach(() => {
  w = world()
  w.invoices.set('inv_1', { id: 'inv_1', status: 'open', currency: 'USD', totalCents: 50000, paidCents: 0 })
})

describe('authentication (AC-STRIPE-004)', () => {
  it('rejects a bad signature with 400, traces webhook_rejected (warn, no body), records nothing', async () => {
    const body = sessionPaid()
    const { rawBody } = signed(body)
    const r = await handleStripeWebhook(w.ports, { accountId: ACC, rawBody, signatureHeader: `t=${NOW},v1=${'a'.repeat(64)}` })
    expect(r.status).toBe(400)
    expect(w.payments).toHaveLength(0)
    expect(w.traces).toHaveLength(1)
    expect(w.traces[0]).toMatchObject({ stage: 'payment.webhook_rejected', level: 'warn', detail: { reason: 'no_matching_signature' } })
    expect(JSON.stringify(w.traces[0])).not.toContain('cs_1') // no body stored
  })

  it('rejects missing and expired signatures', async () => {
    const raw = JSON.stringify(sessionPaid())
    expect((await handleStripeWebhook(w.ports, { accountId: ACC, rawBody: raw, signatureHeader: null })).status).toBe(400)
    const old = signed(sessionPaid(), SECRET, NOW - 3600)
    expect((await handleStripeWebhook(w.ports, { accountId: ACC, ...old })).status).toBe(400)
    expect(w.traces.map((t) => (t.detail as { reason: string }).reason)).toEqual(['missing_header', 'timestamp_out_of_tolerance'])
    expect(w.payments).toHaveLength(0)
  })

  it('a tampered body (amount edited after signing) is refused', async () => {
    const s = signed(sessionPaid())
    const r = await handleStripeWebhook(w.ports, { accountId: ACC, rawBody: s.rawBody.replace('50000', '5'), signatureHeader: s.signatureHeader })
    expect(r.status).toBe(400)
    expect(w.payments).toHaveLength(0)
  })

  it('unknown / unconnected account → 400; a disconnected entity’s secret does not verify', async () => {
    expect((await deliver(w, sessionPaid(), SECRET, 'acc_nope')).status).toBe(400)
    expect((await deliver(w, sessionPaid(), 'whsec_disconnected')).status).toBe(400)
    expect(w.payments).toHaveLength(0)
  })

  it('routes per entity: an event signed by entity B’s secret verifies and records which entity sent it', async () => {
    const r = await deliver(w, sessionPaid(), SECRET_B)
    expect(r.status).toBe(200)
    expect(w.traces.find((t) => t.stage === 'payment.webhook_received')?.detail).toMatchObject({ entityId: 'ent_b' })
  })
})

describe('recording exactly once (AC-STRIPE-002/003)', () => {
  it('checkout.session.completed (paid) records one payment for amount/currency from Stripe, marks paid, then receipt + Xero', async () => {
    const r = await deliver(w, sessionPaid())
    expect(r).toEqual({ status: 200, body: { received: true, recorded: true } })
    expect(w.payments).toEqual([expect.objectContaining({ invoiceId: 'inv_1', amountCents: 50000, key: 'pi_1', method: 'card' })])
    expect(w.payments[0].paidOn.toISOString().slice(0, 10)).toBe(new Date((NOW - 5) * 1000).toISOString().slice(0, 10)) // event time, not "now"
    expect(w.invoices.get('inv_1')!.status).toBe('paid')
    expect(w.stages()).toEqual(['payment.webhook_received', 'payment.recorded'])
    const rec = w.traces[1]
    expect(rec).toMatchObject({ paymentId: 'pay_1', externalId: 'pi_1', invoiceId: 'inv_1', source: 'stripe' })
    expect(rec.detail).toMatchObject({ amountCents: 50000, currency: 'USD', livemode: false, invoiceStatus: 'paid' })
    expect(w.after).toEqual(['inv_1:50000'])
  })

  it.each([
    ['completed → pi.succeeded → charge.succeeded', () => [sessionPaid(), piSucceeded(), chargeSucceeded()]],
    ['pi.succeeded → completed → charge.succeeded', () => [piSucceeded(), sessionPaid(), chargeSucceeded()]],
    ['charge.succeeded → pi.succeeded → completed', () => [chargeSucceeded(), piSucceeded(), sessionPaid()]],
  ])('ordering %s → one payment, the rest duplicate_ignored', async (_n, evs) => {
    const results = []
    for (const e of evs()) results.push(await deliver(w, e))
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(w.payments).toHaveLength(1)
    expect(w.invoices.get('inv_1')!.paidCents).toBe(50000)
    expect(w.stages().filter((s) => s === 'payment.recorded')).toHaveLength(1)
    expect(w.stages().filter((s) => s === 'payment.duplicate_ignored')).toHaveLength(2)
    expect(w.after).toHaveLength(1) // one receipt, one Xero copy
  })

  it('the same event delivered twice: second is a redelivery, no second payment, webhook_received de-duplicated', async () => {
    const e = sessionPaid()
    await deliver(w, e)
    const r2 = await deliver(w, e)
    expect(r2.body).toMatchObject({ duplicate: true })
    expect(w.payments).toHaveLength(1)
    expect(w.stages().filter((s) => s === 'payment.webhook_received')).toHaveLength(1)
  })

  it('concurrent duplicate deliveries: the loser hits the unique key → 200 duplicate', async () => {
    // Simulate the race: between our duplicate check and the insert, another delivery records it.
    w.beforeRecord(async () => {
      await w.ports.recordPayment({ invoiceId: 'inv_1', amountCents: 50000, paidOn: new Date(), method: 'card', key: 'pi_1', paymentIntentId: 'pi_1' })
    })
    const r = await deliver(w, piSucceeded())
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ duplicate: true })
    expect(w.payments).toHaveLength(1)
  })

  it('transient DB failure → 500 (Stripe retries) with a record_error trace; the retry records it', async () => {
    w.failRecordOnce(new Error('connection reset'))
    const e = piSucceeded()
    const r1 = await deliver(w, e)
    expect(r1.status).toBe(500)
    expect(w.traces.find((t) => t.stage === 'payment.record_error')).toMatchObject({ level: 'error', httpStatus: 500 })
    const r2 = await deliver(w, e) // Stripe redelivers the same event id
    expect(r2.status).toBe(200)
    expect(w.payments).toHaveLength(1)
    expect(w.stages()).toContain('payment.recorded')
  })

  it('a payment that is not ours (no invoice metadata, unknown PaymentIntent) → 200, nothing recorded or flagged', async () => {
    const r = await deliver(w, event('payment_intent.succeeded', { id: 'pi_other', amount_received: 999, currency: 'usd' }))
    expect(r.body).toMatchObject({ ignored: true })
    expect(w.payments).toHaveLength(0)
    expect(w.stages()).toEqual(['payment.webhook_received'])
  })

  it('partial payment keeps the invoice open with the right balance (AC-STRIPE-006)', async () => {
    await deliver(w, piSucceeded({ amount_received: 20000 }))
    expect(w.invoices.get('inv_1')).toMatchObject({ status: 'open', paidCents: 20000 })
  })
})

describe('ACH delayed settlement', () => {
  const sessionUnpaid = () =>
    event('checkout.session.completed', { id: 'cs_2', payment_intent: 'pi_2', payment_status: 'unpaid', status: 'complete', amount_total: 50000, currency: 'usd', payment_method_types: ['card', 'us_bank_account'], metadata: meta })

  it('completed with payment_status unpaid → NOT paid; processing trace + activity note; async success records as bank transfer', async () => {
    const r1 = await deliver(w, sessionUnpaid())
    expect(r1.body).toMatchObject({ processing: true })
    expect(w.payments).toHaveLength(0)
    expect(w.invoices.get('inv_1')!.status).toBe('open')
    expect(w.traces.find((t) => t.stage === 'payment.processing')).toMatchObject({ externalId: 'pi_2', invoiceId: 'inv_1' })
    expect(w.audits.some((a) => a.includes('3–5 business days'))).toBe(true)

    await deliver(w, event('checkout.session.async_payment_succeeded', { id: 'cs_2', payment_intent: 'pi_2', payment_status: 'paid', amount_total: 50000, currency: 'usd', payment_method_types: ['card', 'us_bank_account'], metadata: meta }))
    expect(w.payments).toEqual([expect.objectContaining({ key: 'pi_2', method: 'bank_transfer' })])
    expect(w.invoices.get('inv_1')!.status).toBe('paid')
  })

  it('async_payment_failed → payment.failed (warn), invoice stays open, a person is told', async () => {
    await deliver(w, sessionUnpaid())
    const r = await deliver(w, event('checkout.session.async_payment_failed', { id: 'cs_2', payment_intent: 'pi_2', payment_status: 'unpaid', amount_total: 50000, currency: 'usd', metadata: meta }))
    expect(r.status).toBe(200)
    expect(w.traces.find((t) => t.stage === 'payment.failed')).toMatchObject({ level: 'warn', invoiceId: 'inv_1', externalId: 'pi_2' })
    expect(w.invoices.get('inv_1')).toMatchObject({ status: 'open', paidCents: 0 })
    expect(w.audits.some((a) => a.includes('failed to clear'))).toBe(true)
  })

  it('payment_intent.payment_failed (card declined) → warn trace with decline code, no activity-log noise', async () => {
    const r = await deliver(w, event('payment_intent.payment_failed', { id: 'pi_3', amount: 50000, currency: 'usd', status: 'requires_payment_method', last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' }, metadata: meta }))
    expect(r.status).toBe(200)
    const t = w.traces.find((x) => x.stage === 'payment.failed')!
    expect(t.message).toContain('insufficient_funds')
    expect(w.audits).toHaveLength(0)
    expect(w.invoices.get('inv_1')!.status).toBe('open')
  })
})

describe('flagged: money we must not apply automatically (200, never 500)', () => {
  it.each([
    ['paid', 'invoice_paid'],
    ['draft', 'invoice_draft'],
    ['written_off', 'invoice_written_off'],
    ['closed', 'invoice_closed'],
  ])('invoice %s → flagged once across all the events for that payment', async (status, code) => {
    w.invoices.get('inv_1')!.status = status
    for (const e of [sessionPaid(), piSucceeded(), chargeSucceeded()]) expect((await deliver(w, e)).status).toBe(200)
    expect(w.payments).toHaveLength(0)
    const flags = w.traces.filter((t) => t.stage === 'payment.flagged')
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({ level: 'warn', detail: { reason: code } })
    expect(w.audits.filter((a) => a.includes('NOT applied'))).toHaveLength(1)
  })

  it('currency mismatch → flagged, not recorded', async () => {
    w.invoices.get('inv_1')!.currency = 'CAD'
    const r = await deliver(w, sessionPaid())
    expect(r.body).toMatchObject({ flagged: true })
    expect(w.payments).toHaveLength(0)
    expect(w.traces.find((t) => t.stage === 'payment.flagged')?.detail).toMatchObject({ reason: 'currency_mismatch' })
  })

  it('invoice leaves open between read and locked write → flagged (not 500)', async () => {
    w.beforeRecord(async () => {
      w.invoices.get('inv_1')!.status = 'written_off'
    })
    const r = await deliver(w, sessionPaid())
    expect(r.status).toBe(200)
    expect(w.traces.find((t) => t.stage === 'payment.flagged')?.detail).toMatchObject({ reason: 'invoice_not_open' })
  })

  it('overpayment → recorded (money is real) AND flagged', async () => {
    w.invoices.get('inv_1')!.paidCents = 40000 // balance 10000, client pays an old 50000 session
    const r = await deliver(w, sessionPaid())
    expect(r.body).toMatchObject({ recorded: true })
    expect(w.payments).toHaveLength(1)
    expect(w.traces.find((t) => t.stage === 'payment.flagged')).toMatchObject({ level: 'warn', detail: { reason: 'overpayment', overCents: 40000 } })
  })

  it('metadata names an invoice that does not exist → flagged, 200', async () => {
    const r = await deliver(w, piSucceeded({ metadata: { invoiceId: 'inv_gone', accountId: ACC } }))
    expect(r.body).toMatchObject({ flagged: true })
    expect(w.traces.find((t) => t.stage === 'payment.flagged')?.detail).toMatchObject({ reason: 'invoice_not_found' })
  })

  it('metadata from another Track2 account → ignored', async () => {
    const r = await deliver(w, piSucceeded({ metadata: { invoiceId: 'inv_1', accountId: 'acc_other' } }))
    expect(r.body).toMatchObject({ ignored: true })
    expect(w.payments).toHaveLength(0)
  })
})

describe('refunds and disputes: error trace, invoice untouched', () => {
  beforeEach(async () => {
    await deliver(w, sessionPaid())
  })

  it('charge.refunded → payment.refunded (error) linked to the payment; invoice and payment unchanged', async () => {
    const r = await deliver(w, event('charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', amount_refunded: 50000, refunded: true, currency: 'usd' }))
    expect(r.status).toBe(200)
    expect(w.traces.find((t) => t.stage === 'payment.refunded')).toMatchObject({ level: 'error', invoiceId: 'inv_1', paymentId: 'pay_1' })
    expect(w.invoices.get('inv_1')).toMatchObject({ status: 'paid', paidCents: 50000 })
    expect(w.payments).toHaveLength(1)
    expect(w.audits.some((a) => a.includes('refund'))).toBe(true)
  })

  it('charge.dispute.created → payment.disputed (error); redelivery does not repeat the activity note', async () => {
    const e = event('charge.dispute.created', { id: 'dp_1', charge: 'ch_x', payment_intent: 'pi_1', amount: 50000, reason: 'fraudulent', currency: 'usd' })
    await deliver(w, e)
    await deliver(w, e)
    expect(w.traces.filter((t) => t.stage === 'payment.disputed')).toHaveLength(1)
    expect(w.traces.find((t) => t.stage === 'payment.disputed')).toMatchObject({ level: 'error', invoiceId: 'inv_1' })
    expect(w.audits.filter((a) => a.includes('dispute'))).toHaveLength(1)
    expect(w.invoices.get('inv_1')!.status).toBe('paid')
  })
})

describe('events we do not act on', () => {
  it('2xx straight away, one webhook_received trace', async () => {
    const r = await deliver(w, event('customer.updated', { id: 'cus_1', email: 'x@y.z' }))
    expect(r).toEqual({ status: 200, body: { received: true, ignored: true } })
    expect(w.stages()).toEqual(['payment.webhook_received'])
    expect(JSON.stringify(w.traces)).not.toContain('x@y.z')
  })
})
