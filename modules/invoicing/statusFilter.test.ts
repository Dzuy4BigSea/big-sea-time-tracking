import { describe, it, expect } from 'vitest'
import { STATUS_FILTERS, badgeDateLabel, parseStatusFilter, statusFilterWhere, tabWhere } from './statusFilter'
import { applyInvoiceAction, canTransition, daysPastDue, displayBadge, isPastDue } from './invoiceState'
import { todayIn } from '@/lib/tz'
import { deriveStatusBanner } from './statusBanner'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('status filter (AC-STAT-005)', () => {
  it('lists Harvest options in order', () => {
    expect(STATUS_FILTERS.map((f) => f.value)).toEqual(['all', 'open', 'closed', 'draft', 'sent', 'late'])
  })
  it('parses unknown values to all', () => {
    expect(parseStatusFilter('late')).toBe('late')
    expect(parseStatusFilter('bogus')).toBe('all')
    expect(parseStatusFilter(undefined)).toBe('all')
  })
  it('maps each filter to a where fragment using the calendar day', () => {
    const today = new Date('2026-10-14T21:45:00Z')
    expect(statusFilterWhere('open', today)).toEqual({ status: { in: ['draft', 'open'] } })
    expect(statusFilterWhere('closed', today)).toEqual({ status: { in: ['paid', 'written_off', 'closed'] } })
    expect(statusFilterWhere('draft', today)).toEqual({ status: 'draft' })
    expect(statusFilterWhere('sent', today)).toEqual({ status: 'open', OR: [{ dueDate: null }, { dueDate: { gte: d('2026-10-14') } }] })
    expect(statusFilterWhere('late', today)).toEqual({ status: 'open', dueDate: { lt: d('2026-10-14') } })
    expect(statusFilterWhere('all', today)).toEqual({})
  })
})

describe('Open tab includes drafts (AC-STAT-004)', () => {
  it('open tab = draft + open; all tab = no status restriction', () => {
    expect(tabWhere('open')).toEqual({ status: { in: ['draft', 'open'] } })
    expect(tabWhere('all')).toEqual({})
  })
})

describe('Late boundary (AC-STAT-001/002)', () => {
  const base = { status: 'open' as const, sentAt: d('2026-10-01'), totalCents: 1000, paidCents: 0 }
  it('the due day itself is Sent in the list and the banner, even late in the day', () => {
    const today = new Date('2026-10-15T23:30:00Z')
    expect(isPastDue(d('2026-10-15'), today)).toBe(false)
    expect(displayBadge({ ...base, dueDate: d('2026-10-15') }, today)).toBe('sent')
    expect(deriveStatusBanner({ ...base, dueDate: d('2026-10-15'), lastPaymentOn: null, currency: 'USD' }, today).headline).toBe('Sent')
  })
  it('the day after is Late in both', () => {
    const today = new Date('2026-10-16T00:10:00Z')
    expect(displayBadge({ ...base, dueDate: d('2026-10-15') }, today)).toBe('late')
    expect(deriveStatusBanner({ ...base, dueDate: d('2026-10-15'), lastPaymentOn: null, currency: 'USD' }, today).headline).toBe('Late')
  })
  it('a $0 open invoice past due is Late (Harvest-observed)', () => {
    const today = d('2026-10-13')
    const zero = { ...base, totalCents: 0, paidCents: 0, dueDate: d('2026-09-02') }
    expect(displayBadge(zero, today)).toBe('late')
    expect(deriveStatusBanner({ ...zero, lastPaymentOn: null, currency: 'USD' }, today).kind).toBe('late')
  })
  it('partly paid stays Sent / Late (AC-STAT-003)', () => {
    expect(displayBadge({ ...base, paidCents: 400, dueDate: d('2026-11-05') }, d('2026-10-13'))).toBe('sent')
    expect(displayBadge({ ...base, paidCents: 400, dueDate: d('2026-09-25') }, d('2026-10-13'))).toBe('late')
  })
})

describe('Late on the account day, not the server UTC day (AC-STAT-001)', () => {
  const ET = 'America/New_York'
  const base = { status: 'open' as const, sentAt: d('2026-10-01'), totalCents: 1000, paidCents: 0 }
  // 23:30 ET on Oct 15 is already 03:30 UTC on Oct 16: the raw clock would read Late on the due day.
  const dueDay2330ET = new Date('2026-10-16T03:30:00Z')
  const nextDay2330ET = new Date('2026-10-17T03:30:00Z')

  it('due day at 23:30 ET is Sent (public page / project tab / list share the rule)', () => {
    const today = todayIn(ET, dueDay2330ET)
    expect(today.toISOString().slice(0, 10)).toBe('2026-10-15')
    expect(isPastDue(d('2026-10-15'), today)).toBe(false)
    expect(displayBadge({ ...base, dueDate: d('2026-10-15') }, today)).toBe('sent')
    expect(daysPastDue(d('2026-10-15'), today)).toBe(0)
    // The old behavior (server's raw now) got it wrong — guard against regressing to it.
    expect(displayBadge({ ...base, dueDate: d('2026-10-15') }, dueDay2330ET)).toBe('late')
  })
  it('the day after at 23:30 ET is Late, 1 day past due', () => {
    const today = todayIn(ET, nextDay2330ET)
    expect(displayBadge({ ...base, dueDate: d('2026-10-15') }, today)).toBe('late')
    expect(daysPastDue(d('2026-10-15'), today)).toBe(1)
  })
  it('partly paid and $0 open invoices follow the same day boundary', () => {
    const today = todayIn(ET, nextDay2330ET)
    expect(displayBadge({ ...base, paidCents: 400, dueDate: d('2026-10-16') }, today)).toBe('sent')
    expect(displayBadge({ ...base, paidCents: 400, dueDate: d('2026-10-15') }, today)).toBe('late')
    expect(displayBadge({ ...base, totalCents: 0, dueDate: d('2026-10-15') }, today)).toBe('late')
  })
})

describe('daysPastDue (A/R aging, reminder copy)', () => {
  it('counts whole calendar days after the due day, 0 when not past due or no due date', () => {
    expect(daysPastDue(null, d('2026-10-15'))).toBe(0)
    expect(daysPastDue(d('2026-10-20'), d('2026-10-15'))).toBe(0)
    expect(daysPastDue(d('2026-10-15'), d('2026-10-15'))).toBe(0)
    expect(daysPastDue(d('2026-09-15'), d('2026-10-15'))).toBe(30)
    expect(daysPastDue(d('2026-09-14'), d('2026-10-15'))).toBe(31)
  })
  it('agrees with isPastDue across a DST change (ET falls back Nov 1)', () => {
    const today = todayIn('America/New_York', new Date('2026-11-03T04:30:00Z')) // Nov 2, 23:30 EST
    expect(today.toISOString().slice(0, 10)).toBe('2026-11-02')
    expect(daysPastDue(d('2026-10-31'), today)).toBe(2)
    expect(isPastDue(d('2026-11-02'), today)).toBe(false)
  })
})

describe('badge date (AC-STAT-006)', () => {
  const fmt = (x: Date) => x.toISOString().slice(0, 10)
  it('sent shows sent date, paid shows paid-on date, others nothing', () => {
    expect(badgeDateLabel('sent', d('2026-10-09'), null, fmt)).toBe('Sent 2026-10-09')
    expect(badgeDateLabel('paid', d('2026-10-01'), d('2026-09-10'), fmt)).toBe('Paid 2026-09-10')
    expect(badgeDateLabel('late', d('2026-10-01'), null, fmt)).toBeNull()
    expect(badgeDateLabel('draft', null, null, fmt)).toBeNull()
  })
})

describe('reopen written off (AC-STAT-007)', () => {
  const st = { totalCents: 1000, paidCents: 300, lineItemCount: 1, sentAt: d('2026-09-01'), number: '42' }
  it('written_off → open through the guarded machine, keeping payments', () => {
    expect(canTransition('written_off', 'reopen')).toBe(true)
    const r = applyInvoiceAction({ ...st, status: 'written_off' }, 'reopen')
    expect(r.status).toBe('open')
    expect(r.paidCents).toBe(300)
  })
  it('reopen is illegal from any other status', () => {
    for (const s of ['draft', 'open', 'paid', 'closed'] as const) {
      expect(() => applyInvoiceAction({ ...st, status: s }, 'reopen')).toThrow(/Illegal invoice transition/)
    }
  })
})
