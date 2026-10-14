import { describe, it, expect } from 'vitest'
import {
  parseMoneyCents,
  parseQuantityHundredths,
  unitTotalCents,
  expenseTotalFromInput,
  unitsFromTotal,
  defaultBillableFor,
  billedCents,
  groupByWeek,
  pageLowerBound,
} from './expenses'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('parseMoneyCents', () => {
  it('parses dollars to integer cents without float drift', () => {
    expect(parseMoneyCents('42.50')).toBe(4250)
    expect(parseMoneyCents('$1,234.5')).toBe(123450)
    expect(parseMoneyCents('0.29')).toBe(29)
    expect(parseMoneyCents('19.99')).toBe(1999)
    expect(parseMoneyCents('42')).toBe(4200)
    expect(parseMoneyCents('.5')).toBe(50)
  })
  it('rounds a third decimal half-up', () => {
    expect(parseMoneyCents('1.005')).toBe(101)
    expect(parseMoneyCents('1.004')).toBe(100)
  })
  it('rejects empty, zero, negative and junk', () => {
    for (const v of ['', ' ', '0', '0.00', '-5', 'abc', '1.2.3', null, undefined, '.']) expect(parseMoneyCents(v)).toBeNull()
  })
})

describe('unit-priced categories (AC-EXP-002, AC-EXP-116)', () => {
  it('100 miles at $0.55 = $55.00', () => {
    expect(expenseTotalFromInput({ unitName: 'miles', unitPriceCents: 55 }, { units: '100' })).toEqual({ totalCents: 5500 })
  })
  it('100 mi at $0.65 = 6500 (09 AC-EXP-002)', () => {
    expect(expenseTotalFromInput({ unitName: 'mi', unitPriceCents: 65 }, { units: '100' })).toEqual({ totalCents: 6500 })
  })
  it('fractional quantities round half-up to cents', () => {
    expect(parseQuantityHundredths('12.5')).toBe(1250)
    expect(unitTotalCents(1250, 55)).toBe(688) // 6.875 → 6.88
    expect(unitTotalCents(1, 55)).toBe(1) // 0.55¢ → 1¢
  })
  it('SSL Certificate: 1 year at $65 = $65', () => {
    expect(expenseTotalFromInput({ unitName: 'year', unitPriceCents: 6500 }, { units: '1', amount: '999' })).toEqual({ totalCents: 6500 })
  })
  it('flat categories use the amount and ignore units', () => {
    expect(expenseTotalFromInput({ unitName: null, unitPriceCents: null }, { amount: '29.00', units: '3' })).toEqual({ totalCents: 2900 })
  })
  it('explains a bad quantity using the unit name', () => {
    const r = expenseTotalFromInput({ unitName: 'miles', unitPriceCents: 55 }, { units: '' })
    expect('error' in r && r.error).toMatch(/miles/)
  })
  it('back-derives the quantity for editing', () => {
    expect(unitsFromTotal(5500, 55)).toBe('100')
    expect(unitsFromTotal(688, 55)).toBe('12.51')
    expect(unitsFromTotal(6500, 6500)).toBe('1')
  })
})

describe('defaultBillableFor (AC-EXP-115)', () => {
  it('billable T&M / fixed fee projects default to billable', () => {
    expect(defaultBillableFor({ isBillable: true, projectType: 'time_and_materials' })).toBe(true)
    expect(defaultBillableFor({ isBillable: true, projectType: 'fixed_fee' })).toBe(true)
  })
  it('non-billable projects default to non-billable', () => {
    expect(defaultBillableFor({ isBillable: false, projectType: 'time_and_materials' })).toBe(false)
    expect(defaultBillableFor({ isBillable: true, projectType: 'non_billable' })).toBe(false)
  })
})

describe('billedCents', () => {
  it('$29.00 + 20% markup = $34.80 (AC-EXP-001)', () => {
    expect(billedCents(2900, 20)).toBe(3480)
    expect(billedCents(2900, null)).toBe(2900)
  })
})

describe('groupByWeek (AC-EXP-111)', () => {
  const rows = [
    { id: 'a', spentDate: d('2026-10-14'), totalCents: 100 }, // Wed
    { id: 'b', spentDate: d('2026-10-12'), totalCents: 200 }, // Mon
    { id: 'c', spentDate: d('2026-10-11'), totalCents: 300 }, // Sun
    { id: 'd', spentDate: d('2026-10-05'), totalCents: 400 }, // Mon
  ]
  it('groups Monday-start weeks newest first with totals', () => {
    const g = groupByWeek(rows, 'monday')
    expect(g.map((w) => w.weekStart.toISOString().slice(0, 10))).toEqual(['2026-10-12', '2026-10-05'])
    expect(g.map((w) => w.totalCents)).toEqual([300, 700])
    expect(g[0].weekEnd.toISOString().slice(0, 10)).toBe('2026-10-18')
    expect(g[1].rows.map((r) => r.id)).toEqual(['c', 'd'])
  })
  it('honours a Sunday week start', () => {
    const g = groupByWeek(rows, 'sunday')
    expect(g.map((w) => w.weekStart.toISOString().slice(0, 10))).toEqual(['2026-10-11', '2026-10-04'])
    expect(g[0].rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('pageLowerBound (AC-EXP-112)', () => {
  const probe = [d('2026-10-14'), d('2026-10-13'), d('2026-10-08'), d('2026-10-01')].map((spentDate) => ({ spentDate }))
  it('null when the page holds everything', () => {
    expect(pageLowerBound(probe, 4, 'monday')).toBeNull()
  })
  it('cuts at the start of the week holding the last row, so weeks are never split', () => {
    expect(pageLowerBound(probe, 3, 'monday')?.toISOString().slice(0, 10)).toBe('2026-10-05')
    expect(pageLowerBound(probe, 2, 'monday')?.toISOString().slice(0, 10)).toBe('2026-10-12')
  })
})
