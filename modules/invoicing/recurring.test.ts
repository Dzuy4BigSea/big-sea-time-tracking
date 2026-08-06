import { describe, it, expect } from 'vitest'
import { advanceIssueDate, addMonthsUtc, isDue, cadenceLabel } from './recurring'

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
