import { describe, it, expect } from 'vitest'
import { summarizeInvoiceTrace, emailChip, openedChip, stripeChip, xeroChip, truncateId, type TraceEventLike } from './invoiceTraceSummary'

const t = (min: number) => new Date(Date.UTC(2026, 9, 1, 12, min))
const ev = (stage: string, min: number, extra: Partial<TraceEventLike> = {}): TraceEventLike => ({
  stage,
  source: stage.split('.')[0] === 'payment' ? 'stripe' : stage.split('.')[0] === 'invoice' ? 'app' : stage.split('.')[0],
  level: 'info',
  occurredAt: t(min),
  ...extra,
})

describe('emailChip', () => {
  it('no events → Not sent', () => {
    expect(emailChip([])).toMatchObject({ value: 'Not sent', tone: 'neutral', at: null })
  })
  it('sent but no provider outcome → Not yet delivered', () => {
    expect(emailChip([ev('invoice.sent', 0), ev('email.accepted', 1)])).toMatchObject({ value: 'Not yet delivered', tone: 'warn' })
  })
  it('delivered', () => {
    expect(emailChip([ev('invoice.sent', 0), ev('email.delivered', 2)])).toMatchObject({ value: 'Delivered', tone: 'ok', at: t(2) })
  })
  it('bounce after delivery (resend to bad address) → latest wins', () => {
    expect(emailChip([ev('email.delivered', 2), ev('email.bounced', 5, { level: 'error' })])).toMatchObject({ value: 'Bounced', tone: 'error' })
  })
  it('delivery after an earlier bounce → Delivered', () => {
    expect(emailChip([ev('email.bounced', 2), ev('email.delivered', 5)]).value).toBe('Delivered')
  })
  it('dropped → Bounced (dropped)', () => {
    expect(emailChip([ev('email.dropped', 2)]).value).toBe('Bounced (dropped)')
  })
  it('spam report is sticky', () => {
    expect(emailChip([ev('email.spam_report', 2), ev('email.delivered', 9)])).toMatchObject({ value: 'Spam report', tone: 'error' })
  })
  it('send error with no outcome → Send failed', () => {
    expect(emailChip([ev('invoice.sent', 0), ev('email.accepted', 1, { level: 'error' })]).value).toBe('Send failed')
  })
})

describe('openedChip', () => {
  it('first open date', () => {
    expect(openedChip([ev('invoice.viewed', 9, { source: 'client' }), ev('email.opened', 4)])).toMatchObject({ value: 'Yes', at: t(4) })
  })
  it('no opens', () => {
    expect(openedChip([ev('email.delivered', 1)])).toMatchObject({ value: 'No', at: null })
  })
})

describe('stripeChip', () => {
  it('none', () => expect(stripeChip([]).value).toBe('No'))
  it('checkout started', () => expect(stripeChip([ev('payment.checkout_started', 1, { source: 'client' })]).value).toBe('Checkout started'))
  it('failed after start', () => {
    expect(stripeChip([ev('payment.checkout_started', 1), ev('payment.failed', 2, { level: 'error' })])).toMatchObject({ value: 'Failed', tone: 'error' })
  })
  it('retry after failure succeeded → Paid', () => {
    expect(stripeChip([ev('payment.failed', 1, { level: 'error' }), ev('payment.checkout_started', 2), ev('payment.recorded', 3)])).toMatchObject({ value: 'Paid', at: t(3) })
  })
  it('payment.recorded from the app (manual payment) does not count as Stripe', () => {
    expect(stripeChip([ev('payment.recorded', 3, { source: 'app' })]).value).toBe('No')
  })
  it('refund after payment', () => expect(stripeChip([ev('payment.recorded', 3), ev('payment.refunded', 8)]).value).toBe('Refunded'))
  it('dispute wins', () => expect(stripeChip([ev('payment.recorded', 3), ev('payment.disputed', 8)]).tone).toBe('error'))
})

describe('xeroChip', () => {
  it('not synced', () => expect(xeroChip([ev('email.delivered', 1)]).value).toBe('Not synced'))
  it('synced', () => expect(xeroChip([ev('xero.invoice_synced', 1)])).toMatchObject({ value: 'Synced', tone: 'ok' }))
  it('payment synced', () => expect(xeroChip([ev('xero.invoice_synced', 1), ev('xero.payment_synced', 4)]).value).toBe('Synced (payment)'))
  it('later error wins', () => expect(xeroChip([ev('xero.invoice_synced', 1), ev('xero.error', 4, { level: 'error' })]).value).toBe('Error'))
  it('error then successful retry → Synced', () => expect(xeroChip([ev('xero.error', 1, { level: 'error' }), ev('xero.invoice_synced', 4)]).value).toBe('Synced'))
})

it('summarizeInvoiceTrace returns the four chips in order', () => {
  expect(summarizeInvoiceTrace([]).map((c) => c.key)).toEqual(['email', 'opened', 'stripe', 'xero'])
})

it('truncateId middle-truncates long ids', () => {
  expect(truncateId('short')).toBe('short')
  const s = truncateId('pi_3PqABCDEFGHIJKLMNOPQRSTUVWXYZ')
  expect(s.length).toBeLessThanOrEqual(19)
  expect(s.startsWith('pi_3')).toBe(true)
  expect(s).toContain('…')
})
