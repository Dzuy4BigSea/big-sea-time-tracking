import { describe, it, expect } from 'vitest'
import { calendarDaysBetween, deriveStatusBanner, type StatusBannerInput } from './statusBanner'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const TODAY = new Date('2026-07-20T15:30:00.000Z')

function inv(o: Partial<StatusBannerInput> = {}): StatusBannerInput {
  return {
    status: 'open',
    dueDate: d('2026-07-30'),
    sentAt: d('2026-06-30'),
    totalCents: 120000,
    paidCents: 0,
    lastPaymentOn: null,
    currency: 'USD',
    ...o,
  }
}

describe('calendarDaysBetween', () => {
  it('counts whole UTC calendar days regardless of time of day', () => {
    expect(calendarDaysBetween(TODAY, d('2026-07-20'))).toBe(0)
    expect(calendarDaysBetween(TODAY, d('2026-07-21'))).toBe(1)
    expect(calendarDaysBetween(TODAY, d('2026-07-08'))).toBe(-12)
  })
})

describe('deriveStatusBanner', () => {
  it('draft: neutral, not sent yet, shows total', () => {
    const b = deriveStatusBanner(inv({ status: 'draft', sentAt: null }), TODAY)
    expect(b.kind).toBe('draft')
    expect(b.tone).toBe('neutral')
    expect(b.headline).toBe('Draft')
    expect(b.detail).toContain('Not sent yet')
    expect(b.detail).toContain('$1,200.00')
  })

  it('open, not yet due: info tone with days until due and amount due', () => {
    const b = deriveStatusBanner(inv(), TODAY)
    expect(b.kind).toBe('open')
    expect(b.tone).toBe('info')
    expect(b.daysUntilDue).toBe(10)
    expect(b.headline).toBe('Sent · due in 10 days')
    expect(b.detail).toBe('$1,200.00 due on 07/30/2026')
  })

  it('open, due today', () => {
    const b = deriveStatusBanner(inv({ dueDate: d('2026-07-20') }), TODAY)
    expect(b.kind).toBe('open')
    expect(b.headline).toBe('Sent · due today')
  })

  it('open, past due: danger tone with days overdue', () => {
    const b = deriveStatusBanner(inv({ dueDate: d('2026-07-08') }), TODAY)
    expect(b.kind).toBe('overdue')
    expect(b.tone).toBe('danger')
    expect(b.daysOverdue).toBe(12)
    expect(b.headline).toBe('Overdue by 12 days')
    expect(b.detail).toBe('$1,200.00 due · was due 07/08/2026')
  })

  it('singular day', () => {
    expect(deriveStatusBanner(inv({ dueDate: d('2026-07-19') }), TODAY).headline).toBe('Overdue by 1 day')
    expect(deriveStatusBanner(inv({ dueDate: d('2026-07-21') }), TODAY).headline).toBe('Sent · due in 1 day')
  })

  it('partially paid, not yet due: warning tone with balance and paid-of-total', () => {
    const b = deriveStatusBanner(inv({ paidCents: 20000 }), TODAY)
    expect(b.kind).toBe('partial')
    expect(b.tone).toBe('warning')
    expect(b.balanceCents).toBe(100000)
    expect(b.headline).toBe('Partially paid · due in 10 days')
    expect(b.detail).toBe('$1,000.00 due on 07/30/2026 · $200.00 of $1,200.00 paid')
  })

  it('partially paid AND past due: overdue wins, still mentions the partial payment', () => {
    const b = deriveStatusBanner(inv({ paidCents: 20000, dueDate: d('2026-07-01') }), TODAY)
    expect(b.kind).toBe('overdue')
    expect(b.detail).toContain('$200.00 of $1,200.00 paid')
  })

  it('open with no due date', () => {
    const b = deriveStatusBanner(inv({ dueDate: null }), TODAY)
    expect(b.kind).toBe('open')
    expect(b.headline).toBe('Sent 06/30/2026')
    expect(b.detail).toBe('$1,200.00 due')
  })

  it('paid: success tone with the paid-on date', () => {
    const b = deriveStatusBanner(
      inv({ status: 'paid', paidCents: 120000, lastPaymentOn: d('2026-07-15'), dueDate: d('2026-07-01') }),
      TODAY,
    )
    expect(b.kind).toBe('paid')
    expect(b.tone).toBe('success')
    expect(b.headline).toBe('Paid on 07/15/2026')
    expect(b.detail).toBe('$1,200.00 received')
    expect(b.daysOverdue).toBe(0)
  })

  it('paid without payment records falls back to "Paid in full"', () => {
    expect(deriveStatusBanner(inv({ status: 'paid', paidCents: 120000 }), TODAY).headline).toBe('Paid in full')
  })

  it('written off: muted, shows the amount written off', () => {
    const b = deriveStatusBanner(inv({ status: 'written_off', paidCents: 20000 }), TODAY)
    expect(b.kind).toBe('written_off')
    expect(b.tone).toBe('muted')
    expect(b.detail).toBe('$200.00 received · $1,000.00 written off')
  })

  it('closed: muted', () => {
    const b = deriveStatusBanner(inv({ status: 'closed' }), TODAY)
    expect(b.kind).toBe('closed')
    expect(b.tone).toBe('muted')
    expect(b.headline).toBe('Closed')
  })

  it('uses the invoice currency', () => {
    expect(deriveStatusBanner(inv({ currency: 'EUR' }), TODAY).detail).toContain('€1,200.00')
  })

  it('open but never sent: does not claim it was sent', () => {
    expect(deriveStatusBanner(inv({ sentAt: null }), TODAY).headline).toBe('Due in 10 days')
  })
})
