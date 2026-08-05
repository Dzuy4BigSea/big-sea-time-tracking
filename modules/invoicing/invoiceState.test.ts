import { describe, it, expect } from 'vitest'
import {
  applyInvoiceAction,
  canTransition,
  deriveStatusAfterPayment,
  displayBadge,
  InvalidTransitionError,
  type InvoiceState,
} from './invoiceState'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function draft(overrides: Partial<InvoiceState> = {}): InvoiceState {
  return { status: 'draft', totalCents: 97200, paidCents: 0, lineItemCount: 2, sentAt: null, number: null, ...overrides }
}
function open(overrides: Partial<InvoiceState> = {}): InvoiceState {
  return { status: 'open', totalCents: 97200, paidCents: 0, lineItemCount: 2, sentAt: d('2026-07-10'), number: '1001', ...overrides }
}

describe('invoice state machine', () => {
  it('AC-INV-005: send is rejected when there are no line items', () => {
    expect(() => applyInvoiceAction(draft({ lineItemCount: 0 }), 'send')).toThrow(InvalidTransitionError)
  })

  it('AC-INV-006: send opens the invoice and emits number/sentAt/lock/token effects', () => {
    const r = applyInvoiceAction(draft(), 'send', { lastInvoiceNumberSeq: 1001 })
    expect(r.status).toBe('open')
    expect(r.effects.assignNumber).toBe('1002')
    expect(r.effects.nextInvoiceNumberSeq).toBe(1002)
    expect(r.effects.setSentAt).toBe(true)
    expect(r.effects.lockEntries).toBe(true)
    expect(r.effects.issuePublicToken).toBe(true)
  })

  it('AC-INV-007: invoice numbers are sequential with no gaps', () => {
    const first = applyInvoiceAction(draft(), 'send', { lastInvoiceNumberSeq: 1000 })
    const second = applyInvoiceAction(draft(), 'send', { lastInvoiceNumberSeq: first.effects.nextInvoiceNumberSeq })
    expect(first.effects.assignNumber).toBe('1001')
    expect(second.effects.assignNumber).toBe('1002')
  })

  it('AC-INV-008: a partial payment keeps the invoice open and accrues paidCents', () => {
    const r = applyInvoiceAction(open(), 'record_payment', { amountCents: 50000 })
    expect(r.status).toBe('open')
    expect(r.paidCents).toBe(50000)
  })

  it('AC-INV-009: full payment marks the invoice paid', () => {
    const r = applyInvoiceAction(open({ paidCents: 50000 }), 'record_payment', { amountCents: 47200 })
    expect(r.status).toBe('paid')
    expect(r.paidCents).toBe(97200)
  })

  it('AC-INV-010: overpayment is rejected unless explicitly allowed', () => {
    expect(() => applyInvoiceAction(open(), 'record_payment', { amountCents: 100000 })).toThrow(/overpayment/)
    const ok = applyInvoiceAction(open(), 'record_payment', { amountCents: 100000, allowOverpayment: true })
    expect(ok.status).toBe('paid')
  })

  it('AC-INV-011: deleting a payment re-derives paid → open', () => {
    const r = applyInvoiceAction(
      { status: 'paid', totalCents: 97200, paidCents: 97200, lineItemCount: 2, sentAt: d('2026-07-10'), number: '1001' },
      'delete_payment',
      { amountCents: 47200 },
    )
    expect(r.status).toBe('open')
    expect(r.paidCents).toBe(50000)
  })

  it('AC-INV-013: mark as draft reverts, releases entries, keeps the number', () => {
    const r = applyInvoiceAction(open(), 'mark_as_draft')
    expect(r.status).toBe('draft')
    expect(r.effects.releaseEntries).toBe(true)
    expect(r.effects.retainNumber).toBe(true)
  })

  it('AC-INV-013c: write off → written_off; delete allowed on a sent invoice', () => {
    expect(applyInvoiceAction(open(), 'write_off').status).toBe('written_off')
    const del = applyInvoiceAction(open(), 'delete')
    expect(del.effects.deleteInvoice).toBe(true)
    expect(del.effects.releaseEntries).toBe(true)
  })

  it('AC-INV-015: illegal transitions are rejected', () => {
    expect(() => applyInvoiceAction(draft(), 'record_payment', { amountCents: 100 })).toThrow(InvalidTransitionError)
    expect(() => applyInvoiceAction(open({ status: 'paid' }), 'mark_as_draft')).toThrow(InvalidTransitionError)
    expect(canTransition('closed', 'send')).toBe(false)
    expect(canTransition('written_off', 'record_payment')).toBe(false)
  })

  it('deriveStatusAfterPayment: full pays, partial stays open, zero-total stays open', () => {
    expect(deriveStatusAfterPayment(1000, 1000)).toBe('paid')
    expect(deriveStatusAfterPayment(1000, 999)).toBe('open')
    expect(deriveStatusAfterPayment(0, 0)).toBe('open')
  })
})

describe('displayBadge', () => {
  const base = { totalCents: 1000, paidCents: 0, isPending: false }
  it('maps stored status + dates to the badge', () => {
    expect(displayBadge({ ...base, status: 'draft', sentAt: null, dueDate: null }, d('2026-08-01'))).toBe('draft')
    expect(displayBadge({ ...base, status: 'paid', sentAt: d('2026-07-01'), dueDate: d('2026-07-31') }, d('2026-08-01'))).toBe('paid')
    // open, not past due → sent
    expect(displayBadge({ ...base, status: 'open', sentAt: d('2026-07-20'), dueDate: d('2026-08-19') }, d('2026-08-01'))).toBe('sent')
    // open, past due, still owed → late
    expect(displayBadge({ ...base, status: 'open', sentAt: d('2026-07-01'), dueDate: d('2026-07-15') }, d('2026-08-01'))).toBe('late')
    // open + pending flag → pending
    expect(displayBadge({ ...base, status: 'open', sentAt: null, dueDate: null, isPending: true }, d('2026-08-01'))).toBe('pending')
  })
})
