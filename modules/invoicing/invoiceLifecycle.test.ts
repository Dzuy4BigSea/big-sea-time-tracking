import { describe, it, expect } from 'vitest'
import { sendDates } from './invoiceLifecycle'
import { todayIn } from '@/lib/tz'
import { expenseBilledCents } from './generateInvoice'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('sendDates', () => {
  it('defaults issue date to today in the account timezone and due date from the term', () => {
    // 01:30 UTC on Aug 7 is still Aug 6 in New York.
    const today = todayIn('America/New_York', new Date('2026-08-07T01:30:00Z'))
    const r = sendDates({ issueDate: null, dueDate: null, paymentTerm: 'net_30' }, today)
    expect(r.issueDate).toEqual(d('2026-08-06'))
    expect(r.dueDate).toEqual(d('2026-09-05'))
  })

  it('keeps dates already set on the invoice (re-send after mark as draft)', () => {
    const r = sendDates({ issueDate: d('2026-07-01'), dueDate: d('2026-07-15'), paymentTerm: 'net_30' }, d('2026-08-06'))
    expect(r).toEqual({ issueDate: d('2026-07-01'), dueDate: d('2026-07-15') })
  })

  it('only the due date missing → derived from the kept issue date', () => {
    const r = sendDates({ issueDate: d('2026-07-01'), dueDate: null, paymentTerm: 'net_15' }, d('2026-08-06'))
    expect(r.dueDate).toEqual(d('2026-07-16'))
  })
})

describe('expenseBilledCents', () => {
  it('applies markup in integer cents, half-up', () => {
    expect(expenseBilledCents(10000, null)).toBe(10000)
    expect(expenseBilledCents(10000, 15)).toBe(11500)
    expect(expenseBilledCents(333, 10)).toBe(366) // 33.3 → 33
    expect(expenseBilledCents(1005, 10)).toBe(1106) // 100.5 → 101 (half-up)
  })
})
