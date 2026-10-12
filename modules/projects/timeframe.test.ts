import { describe, it, expect } from 'vitest'
import { defaultPeriodFor, resolveTimeframe, shiftAnchor, timeframeLabel, timeframeQuery, customSeed, parseYmd } from './timeframe'

const now = new Date('2026-10-12T15:30:00.000Z') // a Monday
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
const tf = (params: Record<string, string>, extra: Parameters<typeof resolveTimeframe>[1] = {}) =>
  resolveTimeframe(params, { now, ...extra })

describe('defaultPeriodFor', () => {
  it('monthly-resetting budget → month', () => {
    expect(defaultPeriodFor({ projectType: 'time_and_materials', budgetMethod: 'hours_total', budgetResetsMonthly: true })).toBe('month')
  })
  it('total budget, no budget, or fixed fee → all time', () => {
    expect(defaultPeriodFor({ projectType: 'time_and_materials', budgetMethod: 'hours_total', budgetResetsMonthly: false })).toBe('all')
    expect(defaultPeriodFor({ projectType: 'time_and_materials', budgetMethod: 'none', budgetResetsMonthly: true })).toBe('all')
    expect(defaultPeriodFor({ projectType: 'fixed_fee', budgetMethod: 'fee_total', budgetResetsMonthly: true })).toBe('all')
  })
})

describe('resolveTimeframe', () => {
  it('uses the default period when none is given', () => {
    expect(tf({}).period).toBe('all')
    const m = tf({}, { defaultPeriod: 'month' })
    expect([m.period, iso(m.start), iso(m.end)]).toEqual(['month', '2026-10-01', '2026-11-01'])
  })
  it('all time is unbounded', () => {
    const a = tf({ period: 'all' })
    expect([a.start, a.end]).toEqual([null, null])
  })
  it('week honors week start', () => {
    const mon = tf({ period: 'week', date: '2026-10-15' })
    expect([iso(mon.start), iso(mon.end)]).toEqual(['2026-10-12', '2026-10-19'])
    const sun = tf({ period: 'week', date: '2026-10-15' }, { weekStartsOn: 'sunday' })
    expect([iso(sun.start), iso(sun.end)]).toEqual(['2026-10-11', '2026-10-18'])
  })
  it('quarter and year', () => {
    const q = tf({ period: 'quarter', date: '2026-08-20' })
    expect([iso(q.start), iso(q.end)]).toEqual(['2026-07-01', '2026-10-01'])
    const y = tf({ period: 'year', date: '2025-06-01' })
    expect([iso(y.start), iso(y.end)]).toEqual(['2025-01-01', '2026-01-01'])
  })
  it('custom is inclusive of `to`, swaps reversed dates, and allows open ends', () => {
    const c = tf({ period: 'custom', from: '2026-03-10', to: '2026-03-01' })
    expect([iso(c.start), iso(c.end)]).toEqual(['2026-03-01', '2026-03-11'])
    const open = tf({ period: 'custom', from: '2026-03-10' })
    expect([iso(open.start), open.end]).toEqual(['2026-03-10', null])
  })
  it('ignores invalid dates', () => {
    expect(parseYmd('2026-02-30')).toBeNull()
    const m = tf({ period: 'month', date: 'garbage' })
    expect(iso(m.start)).toBe('2026-10-01')
  })
  it('maps legacy month/year links to period=month (or year)', () => {
    const a = tf({ month: '2025-03', year: '2026' })
    expect([a.period, iso(a.start), iso(a.end)]).toEqual(['month', '2025-03-01', '2025-04-01'])
    const b = tf({ month: '7', year: '2024' })
    expect([b.period, iso(b.start)]).toEqual(['month', '2024-07-01'])
    const c = tf({ year: '2023' })
    expect([c.period, iso(c.start), iso(c.end)]).toEqual(['year', '2023-01-01', '2024-01-01'])
  })
  it('explicit period wins over legacy params', () => {
    expect(tf({ period: 'all', month: '2025-03' }).period).toBe('all')
  })
})

describe('shiftAnchor', () => {
  it('moves bounded periods', () => {
    expect(shiftAnchor(tf({ period: 'week', date: '2026-10-12' }), -1)).toBe('2026-10-05')
    expect(shiftAnchor(tf({ period: 'month', date: '2026-01-15' }), -1)).toBe('2025-12-01')
    expect(shiftAnchor(tf({ period: 'quarter', date: '2026-11-01' }), 1)).toBe('2027-01-01')
    expect(shiftAnchor(tf({ period: 'year', date: '2026-11-01' }), 1)).toBe('2027-01-01')
  })
  it('is null for unbounded periods', () => {
    expect(shiftAnchor(tf({ period: 'all' }), 1)).toBeNull()
    expect(shiftAnchor(tf({ period: 'custom', from: '2026-01-01', to: '2026-01-31' }), 1)).toBeNull()
  })
})

describe('labels and query round-trip', () => {
  it('labels each period', () => {
    expect(timeframeLabel(tf({ period: 'week', date: '2026-10-12' }))).toBe('Oct 12 – 18, 2026')
    expect(timeframeLabel(tf({ period: 'week', date: '2026-09-29' }))).toBe('Sep 28 – Oct 4, 2026')
    expect(timeframeLabel(tf({ period: 'week', date: '2026-12-30' }))).toBe('Dec 28, 2026 – Jan 3, 2027')
    expect(timeframeLabel(tf({ period: 'month', date: '2026-10-12' }))).toBe('Oct 2026')
    expect(timeframeLabel(tf({ period: 'quarter', date: '2026-10-12' }))).toBe('Q4 2026')
    expect(timeframeLabel(tf({ period: 'year', date: '2026-10-12' }))).toBe('2026')
    expect(timeframeLabel(tf({ period: 'all' }))).toBe('All time')
    expect(timeframeLabel(tf({ period: 'custom', from: '2026-01-01', to: '2026-02-15' }))).toBe('Jan 1, 2026 – Feb 15, 2026')
  })
  it('timeframeQuery reproduces the same range', () => {
    for (const p of <Record<string, string>[]>[
      { period: 'week', date: '2026-10-14' },
      { period: 'quarter', date: '2026-05-05' },
      { period: 'custom', from: '2026-01-01', to: '2026-02-15' },
      { period: 'all' },
    ]) {
      const a = tf(p)
      const b = tf(timeframeQuery(a))
      expect([b.period, iso(b.start), iso(b.end)]).toEqual([a.period, iso(a.start), iso(a.end)])
    }
  })
  it('customSeed prefills from the current selection', () => {
    expect(customSeed(tf({ period: 'month', date: '2026-02-03' }), now)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(customSeed(tf({ period: 'all' }), now)).toEqual({ from: '2026-10-01', to: '2026-10-12' })
  })
})
