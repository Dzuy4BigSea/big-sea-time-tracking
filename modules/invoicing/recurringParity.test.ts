import { describe, it, expect } from 'vitest'
import {
  RECURRING_PRESETS,
  advanceIssueDate,
  isValidFirstIssueDate,
  matchesRecurringSearch,
  nextFutureIssueDate,
  parseSchedule,
  parseTemplateLines,
  scheduleToForm,
} from './recurring'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
const iso = (x: Date) => x.toISOString().slice(0, 10)

describe('month-end anchor (AC-REC-102)', () => {
  it('a 31st template issues on the last day of short months and back on the 31st', () => {
    const out: string[] = []
    let x = d('2026-01-31')
    for (let i = 0; i < 4; i++) {
      out.push(iso(x))
      x = advanceIssueDate(x, 'monthly', 1, 31)
    }
    expect(out).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })
  it('leap years, quarterly and yearly keep the anchor', () => {
    expect(iso(advanceIssueDate(d('2028-01-31'), 'monthly', 1, 31))).toBe('2028-02-29')
    expect(iso(advanceIssueDate(d('2026-02-28'), 'quarterly', 1, 31))).toBe('2026-05-31')
    expect(iso(advanceIssueDate(d('2028-02-29'), 'yearly', 1, 29))).toBe('2029-02-28')
    expect(iso(advanceIssueDate(d('2029-02-28'), 'yearly', 1, 29))).toBe('2030-02-28')
  })
  it('without an anchor (legacy rows) behaves as before', () => {
    expect(iso(advanceIssueDate(d('2026-02-28'), 'monthly'))).toBe('2026-03-28')
  })
  it('catch-up keeps the anchor', () => {
    expect(iso(nextFutureIssueDate(d('2026-02-28'), 'monthly', 1, d('2026-04-02'), 31))).toBe('2026-04-30')
  })
  it('weekly and custom ignore the anchor', () => {
    expect(iso(advanceIssueDate(d('2026-01-31'), 'weekly', 1, 31))).toBe('2026-02-07')
    expect(iso(advanceIssueDate(d('2026-01-31'), 'custom', 3, 31))).toBe('2026-02-03')
  })
})

describe('first issue date (AC-REC-101)', () => {
  it('must be after today (account calendar day)', () => {
    const today = d('2026-10-14')
    expect(isValidFirstIssueDate(d('2026-10-15'), today)).toBe(true)
    expect(isValidFirstIssueDate(d('2026-10-14'), today)).toBe(false)
    expect(isValidFirstIssueDate(d('2026-10-01'), today)).toBe(false)
    expect(isValidFirstIssueDate(null, today)).toBe(false)
  })
})

describe('how often (AC-REC-104)', () => {
  it('lists presets in order', () => {
    expect(RECURRING_PRESETS.map((p) => p.label)).toEqual([
      'Weekly',
      'Every 2 weeks',
      'Every 4 weeks',
      'Monthly',
      'Every 2 months',
      'Quarterly',
      'Every 6 months',
      'Yearly',
      'Every 2 years',
    ])
  })
  it('parses presets and custom', () => {
    expect(parseSchedule('every_6_months', '', '')).toEqual({ frequency: 'monthly', intervalCount: 6 })
    expect(parseSchedule('custom', '10', 'days')).toEqual({ frequency: 'custom', intervalCount: 10 })
    expect(parseSchedule('custom', '3', 'weeks')).toEqual({ frequency: 'weekly', intervalCount: 3 })
    expect(parseSchedule('custom', '5', 'months')).toEqual({ frequency: 'monthly', intervalCount: 5 })
    expect(parseSchedule('custom', '0', 'days')).toBe('invalid')
    expect(parseSchedule('custom', 'x', 'days')).toBe('invalid')
    expect(parseSchedule('nope', '', '')).toBe('invalid')
  })
  it('round-trips stored schedules to the form', () => {
    expect(scheduleToForm('monthly', 1).preset).toBe('monthly')
    expect(scheduleToForm('quarterly', 2).preset).toBe('every_6_months')
    expect(scheduleToForm('monthly', 3).preset).toBe('quarterly')
    expect(scheduleToForm('monthly', 12).preset).toBe('yearly')
    expect(scheduleToForm('weekly', 3)).toEqual({ preset: 'custom', customN: 3, customUnit: 'weeks' })
    expect(scheduleToForm('custom', 10)).toEqual({ preset: 'custom', customN: 10, customUnit: 'days' })
    expect(scheduleToForm('monthly', 5)).toEqual({ preset: 'custom', customN: 5, customUnit: 'months' })
  })
})

describe('template lines (AC-REC-106)', () => {
  it('sums integer cents per line, skipping blank rows', () => {
    const r = parseTemplateLines(['Retainer', '', 'Hosting'], ['1', '', '2.5'], ['2,500.00', '', '$19.99'])
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.lines).toEqual([
      { description: 'Retainer', quantity: 1, unitPriceCents: 250000, amountCents: 250000 },
      { description: 'Hosting', quantity: 2.5, unitPriceCents: 1999, amountCents: 4998 },
    ])
    expect(r.amountCents).toBe(254998)
  })
  it('rejects missing description, bad quantity, missing price, empty template', () => {
    expect(parseTemplateLines([''], ['1'], ['10'])).toEqual({ error: 'Line 1: add a description.' })
    expect(parseTemplateLines(['A'], ['-1'], ['10'])).toEqual({ error: 'Line 1: quantity must be a number above 0.' })
    expect(parseTemplateLines(['A'], ['1'], [''])).toEqual({ error: 'Line 1: enter a unit price.' })
    expect(parseTemplateLines([''], [''], [''])).toEqual({ error: 'Add at least one line item.' })
  })
  it('carries taxable / linked project through by row', () => {
    const r = parseTemplateLines(['', 'Fee'], ['', '1'], ['', '100'], [{}, { taxable: true, linkedProjectId: 'p1' }])
    expect('error' in r ? null : r.lines[0]).toEqual({ description: 'Fee', quantity: 1, unitPriceCents: 10000, amountCents: 10000, taxable: true, linkedProjectId: 'p1' })
  })
  it('blank quantity means 1', () => {
    const r = parseTemplateLines(['A'], [''], ['5'])
    expect('error' in r ? null : r.amountCents).toBe(500)
  })
})

describe('recurring search (AC-REC-108)', () => {
  const p = { subject: 'Hosting retainer', notes: 'Net 15 terms', templateLineItems: [{ description: 'WP Engine plan' }] }
  it('matches subject, notes and line descriptions, case-insensitive', () => {
    expect(matchesRecurringSearch(p, 'HOSTING')).toBe(true)
    expect(matchesRecurringSearch(p, 'net 15')).toBe(true)
    expect(matchesRecurringSearch(p, 'engine')).toBe(true)
    expect(matchesRecurringSearch(p, 'zzz')).toBe(false)
    expect(matchesRecurringSearch(p, '  ')).toBe(true)
  })
})
