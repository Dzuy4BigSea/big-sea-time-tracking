import { describe, it, expect } from 'vitest'
import { usesPersonRates, initialsOf, rateCell, ratesByUser } from './teamCard'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('usesPersonRates', () => {
  it('only for T&M projects with the person method', () => {
    expect(usesPersonRates('time_and_materials', 'person')).toBe(true)
    expect(usesPersonRates('time_and_materials', 'project')).toBe(false)
    expect(usesPersonRates('time_and_materials', null)).toBe(false)
    expect(usesPersonRates('fixed_fee', 'person')).toBe(false)
  })
})

describe('initialsOf', () => {
  it('takes first letters', () => {
    expect(initialsOf('ada', 'Lovelace')).toBe('AL')
    expect(initialsOf('', '')).toBe('?')
  })
})

describe('rateCell', () => {
  const rates = [
    { hourlyRateCents: 9000, startDate: null, endDate: d('2025-12-31') },
    { hourlyRateCents: 9500, startDate: d('2026-01-01'), endDate: null },
  ]
  it('prefers the per-project override', () => {
    expect(rateCell(12000, rates, d('2026-10-12'))).toEqual({ kind: 'custom', cents: 12000 })
  })
  it('falls back to the default in force today', () => {
    expect(rateCell(null, rates, d('2026-10-12'))).toEqual({ kind: 'default', cents: 9500 })
    expect(rateCell(null, rates, d('2025-06-01'))).toEqual({ kind: 'default', cents: 9000 })
  })
  it('is missing when nothing applies', () => {
    expect(rateCell(null, undefined, d('2026-10-12'))).toEqual({ kind: 'missing' })
    expect(rateCell(null, [{ hourlyRateCents: 1, startDate: d('2027-01-01'), endDate: null }], d('2026-10-12'))).toEqual({ kind: 'missing' })
  })
})

describe('ratesByUser', () => {
  it('groups rows per user', () => {
    const m = ratesByUser([
      { userId: 'a', hourlyRateCents: 1, startDate: null, endDate: null },
      { userId: 'b', hourlyRateCents: 2, startDate: null, endDate: null },
      { userId: 'a', hourlyRateCents: 3, startDate: null, endDate: null },
    ])
    expect(m.get('a')?.map((r) => r.hourlyRateCents)).toEqual([1, 3])
    expect(m.get('b')).toHaveLength(1)
  })
})
