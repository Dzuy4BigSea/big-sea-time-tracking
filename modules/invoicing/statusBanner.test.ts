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

  it('sent, not yet due: blue "Sent" with days until due and amount due', () => {
    const b = deriveStatusBanner(inv(), TODAY)
    expect(b.kind).toBe('sent')
    expect(b.tone).toBe('info')
    expect(b.daysUntilDue).toBe(10)
    expect(b.headline).toBe('Sent')
    expect(b.detail).toBe('Due in 10 days · $1,200.00 due on 07/30/2026')
  })

  it('sent, due today', () => {
    const b = deriveStatusBanner(inv({ dueDate: d('2026-07-20') }), TODAY)
    expect(b.headline).toBe('Sent')
    expect(b.detail).toMatch(/^Due today/)
  })

  it('past due with a balance: red "Late" with days late', () => {
    const b = deriveStatusBanner(inv({ dueDate: d('2026-07-08') }), TODAY)
    expect(b.kind).toBe('late')
    expect(b.tone).toBe('danger')
    expect(b.daysOverdue).toBe(12)
    expect(b.headline).toBe('Late')
    expect(b.detail).toBe('12 days late · $1,200.00 due · was due 07/08/2026')
  })

  it('singular day', () => {
    expect(deriveStatusBanner(inv({ dueDate: d('2026-07-19') }), TODAY).detail).toMatch(/^1 day late/)
    expect(deriveStatusBanner(inv({ dueDate: d('2026-07-21') }), TODAY).detail).toMatch(/^Due in 1 day /)
  })

  it('partially paid stays "Sent" (Harvest has no partial status); detail shows balance and paid-of-total', () => {
    const b = deriveStatusBanner(inv({ paidCents: 20000 }), TODAY)
    expect(b.kind).toBe('sent')
    expect(b.tone).toBe('info')
    expect(b.balanceCents).toBe(100000)
    expect(b.headline).toBe('Sent')
    expect(b.detail).toBe('Due in 10 days · $1,000.00 due on 07/30/2026 · $200.00 of $1,200.00 paid')
  })

  it('partially paid AND past due: Late, still mentions the partial payment', () => {
    const b = deriveStatusBanner(inv({ paidCents: 20000, dueDate: d('2026-07-01') }), TODAY)
    expect(b.kind).toBe('late')
    expect(b.detail).toContain('$200.00 of $1,200.00 paid')
  })

  it('sent with no due date', () => {
    const b = deriveStatusBanner(inv({ dueDate: null }), TODAY)
    expect(b.kind).toBe('sent')
    expect(b.headline).toBe('Sent')
    expect(b.detail).toBe('Sent 06/30/2026 · $1,200.00 due')
  })

  it('paid: success tone with the paid-on date', () => {
    const b = deriveStatusBanner(
      inv({ status: 'paid', paidCents: 120000, lastPaymentOn: d('2026-07-15'), dueDate: d('2026-07-01') }),
      TODAY,
    )
    expect(b.kind).toBe('paid')
    expect(b.tone).toBe('success')
    expect(b.headline).toBe('Paid')
    expect(b.detail).toBe('Paid on 07/15/2026 · $1,200.00 received')
    expect(b.daysOverdue).toBe(0)
  })

  it('paid without payment records omits the date', () => {
    expect(deriveStatusBanner(inv({ status: 'paid', paidCents: 120000 }), TODAY).detail).toBe('$1,200.00 received')
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

  it('open with no sent date and no due date: no "Sent <date>" in the detail', () => {
    expect(deriveStatusBanner(inv({ sentAt: null, dueDate: null }), TODAY).detail).toBe('$1,200.00 due')
  })
})
