import { describe, it, expect } from 'vitest'
import { advanceIssueDate, addMonthsUtc, isDue, cadenceLabel, afterIssue, isCompleted, parseOccurrenceLimit } from './recurring'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('recurring schedule', () => {
  it('AC-REC-001: monthly advances one month', () => {
    expect(advanceIssueDate(d('2026-01-15'), 'monthly').toISOString().slice(0, 10)).toBe('2026-02-15')
  })

  it('monthly clamps day at month end (Jan 31 → Feb 28)', () => {
    expect(addMonthsUtc(d('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28')
  })

  it('weekly / quarterly / yearly / custom advance correctly', () => {
    expect(advanceIssueDate(d('2026-01-01'), 'weekly').toISOString().slice(0, 10)).toBe('2026-01-08')
    expect(advanceIssueDate(d('2026-01-01'), 'quarterly').toISOString().slice(0, 10)).toBe('2026-04-01')
    expect(advanceIssueDate(d('2026-01-01'), 'yearly').toISOString().slice(0, 10)).toBe('2027-01-01')
    expect(advanceIssueDate(d('2026-01-01'), 'custom', 10).toISOString().slice(0, 10)).toBe('2026-01-11')
  })

  it('respects intervalCount (every 2 months)', () => {
    expect(advanceIssueDate(d('2026-01-15'), 'monthly', 2).toISOString().slice(0, 10)).toBe('2026-03-15')
  })

  it('crosses year boundary', () => {
    expect(advanceIssueDate(d('2026-12-10'), 'monthly').toISOString().slice(0, 10)).toBe('2027-01-10')
  })

  it('AC-REC-002: paused profiles are never due', () => {
    expect(isDue(d('2026-01-01'), d('2026-06-01'), 'paused')).toBe(false)
  })

  it('isDue: active profile due when nextIssueDate <= asOf', () => {
    expect(isDue(d('2026-08-06'), d('2026-08-06'), 'active')).toBe(true)
    expect(isDue(d('2026-08-07'), d('2026-08-06'), 'active')).toBe(false)
    expect(isDue(null, d('2026-08-06'), 'active')).toBe(false)
  })

  it('cadence labels', () => {
    expect(cadenceLabel('monthly')).toBe('every month')
    expect(cadenceLabel('weekly', 2)).toBe('every 2 weeks')
  })
})

describe('occurrence limit (number of invoices to issue)', () => {
  it('blank limit recurs indefinitely: always due on schedule, never decrements', () => {
    expect(isDue(d('2026-08-06'), d('2026-08-06'), 'active', null)).toBe(true)
    expect(afterIssue(null)).toEqual({ remainingOccurrences: null, status: 'active' })
  })

  it('a used-up limit is never due, even if active', () => {
    expect(isDue(d('2026-08-06'), d('2026-08-06'), 'active', 0)).toBe(false)
    expect(isDue(d('2026-08-06'), d('2026-08-06'), 'active', 1)).toBe(true)
  })

  it('decrements per issue and pauses after the last one', () => {
    expect(afterIssue(3)).toEqual({ remainingOccurrences: 2, status: 'active' })
    expect(afterIssue(1)).toEqual({ remainingOccurrences: 0, status: 'paused' })
    expect(afterIssue(0)).toEqual({ remainingOccurrences: 0, status: 'paused' })
  })

  it('a limit of 3 issues exactly 3 invoices across catch-up runs', () => {
    let remaining: number | null = 3
    let status: 'active' | 'paused' = 'active'
    let next = d('2026-01-01')
    let issued = 0
    const asOf = d('2026-12-31')
    while (isDue(next, asOf, status, remaining)) {
      ;({ remainingOccurrences: remaining, status } = afterIssue(remaining))
      next = advanceIssueDate(next, 'monthly')
      issued++
    }
    expect(issued).toBe(3)
    expect(status).toBe('paused')
    expect(isCompleted(remaining)).toBe(true)
  })

  it('isCompleted only for a used-up count', () => {
    expect(isCompleted(null)).toBe(false)
    expect(isCompleted(2)).toBe(false)
    expect(isCompleted(0)).toBe(true)
  })

  it('parseOccurrenceLimit: blank = indefinite, whole numbers ≥ 1, else invalid', () => {
    expect(parseOccurrenceLimit('')).toBeNull()
    expect(parseOccurrenceLimit('  ')).toBeNull()
    expect(parseOccurrenceLimit(null)).toBeNull()
    expect(parseOccurrenceLimit('12')).toBe(12)
    expect(parseOccurrenceLimit(' 1 ')).toBe(1)
    expect(parseOccurrenceLimit('0')).toBe('invalid')
    expect(parseOccurrenceLimit('-2')).toBe('invalid')
    expect(parseOccurrenceLimit('2.5')).toBe('invalid')
    expect(parseOccurrenceLimit('abc')).toBe('invalid')
  })
})
