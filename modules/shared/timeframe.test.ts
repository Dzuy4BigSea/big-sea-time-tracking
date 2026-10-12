import { describe, it, expect } from 'vitest'
import {
  resolveTimeframe, needsFallbackAnchor, timeframeQuery, inTimeframe, buildHref, parsePeriod, customSeed, defaultPeriodFor, endExclusive, PERIODS,
} from './timeframe'
import { parseYmd } from '@/lib/week'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
const ymd = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null)

describe('resolveTimeframe', () => {
  it('week honors a Sunday week start (account preference)', () => {
    // 2026-10-14 is a Wednesday
    const mon = resolveTimeframe({ period: 'week', anchor: '2026-10-14' })
    const sun = resolveTimeframe({ period: 'week', anchor: '2026-10-14' }, { weekStartsOn: 'sunday' })
    expect(mon.from?.toISOString().slice(0, 10)).toBe('2026-10-12')
    expect(sun.from?.toISOString().slice(0, 10)).toBe('2026-10-11')
    expect(sun.till?.toISOString().slice(0, 10)).toBe('2026-10-17')
  })

  it('defaults to all time with open bounds', () => {
    const tf = resolveTimeframe({})
    expect(tf).toMatchObject({ period: 'all', from: null, till: null, label: 'All time' })
  })

  it('honors the page default period', () => {
    expect(resolveTimeframe({}, { defaultPeriod: 'month', fallbackAnchor: d('2026-08-14') }).label).toBe('August 2026')
  })

  it('resolves a Monday-start week with prev/next anchors', () => {
    const tf = resolveTimeframe({ period: 'week', anchor: '2026-10-08' }) // Thursday
    expect(ymd(tf.from)).toBe('2026-10-05')
    expect(ymd(tf.till)).toBe('2026-10-11')
    expect(tf.prevAnchor).toBe('2026-09-28')
    expect(tf.nextAnchor).toBe('2026-10-12')
    expect(tf.label).toBe('10/5 – 10/11 2026')
  })

  it('resolves a month, including year rollover', () => {
    const tf = resolveTimeframe({ period: 'month', anchor: '2026-01-20' })
    expect(ymd(tf.from)).toBe('2026-01-01')
    expect(ymd(tf.till)).toBe('2026-01-31')
    expect(tf.prevAnchor).toBe('2025-12-01')
    expect(tf.nextAnchor).toBe('2026-02-01')
  })

  it('resolves a quarter', () => {
    const tf = resolveTimeframe({ period: 'quarter', anchor: '2026-08-01' })
    expect(tf.label).toBe('Q3 2026')
    expect(ymd(tf.from)).toBe('2026-07-01')
    expect(ymd(tf.till)).toBe('2026-09-30')
    expect(tf.prevAnchor).toBe('2026-04-01')
    expect(tf.nextAnchor).toBe('2026-10-01')
  })

  it('resolves a year', () => {
    const tf = resolveTimeframe({ period: 'year', anchor: '2024-02-29' })
    expect(tf.label).toBe('2024')
    expect(ymd(tf.from)).toBe('2024-01-01')
    expect(ymd(tf.till)).toBe('2024-12-31')
  })

  it('uses the fallback anchor when the anchor is missing or malformed', () => {
    const tf = resolveTimeframe({ period: 'month', anchor: 'nope' }, { fallbackAnchor: d('2025-03-09') })
    expect(tf.label).toBe('March 2025')
  })

  it('resolves a custom range and swaps reversed bounds', () => {
    const tf = resolveTimeframe({ period: 'custom', from: '2026-03-31', to: '2026-03-01' })
    expect(ymd(tf.from)).toBe('2026-03-01')
    expect(ymd(tf.till)).toBe('2026-03-31')
    expect(tf.label).toBe('3/1/2026 – 3/31/2026')
  })

  it('allows a one-sided custom range', () => {
    expect(resolveTimeframe({ period: 'custom', from: '2026-01-01' })).toMatchObject({ till: null, label: 'Since 1/1/2026' })
    expect(resolveTimeframe({ period: 'custom', to: '2026-01-01' })).toMatchObject({ from: null, label: 'Through 1/1/2026' })
  })

  it('falls back to all time for a custom range with no valid dates', () => {
    expect(resolveTimeframe({ period: 'custom', from: 'x' }).period).toBe('all')
  })

  it('ignores unknown periods', () => {
    expect(parsePeriod('decade')).toBe('all')
    expect(parsePeriod('decade', 'week')).toBe('week')
  })
})

describe('needsFallbackAnchor', () => {
  it('is true only for anchored periods without a valid anchor', () => {
    expect(needsFallbackAnchor({ period: 'month' })).toBe(true)
    expect(needsFallbackAnchor({ period: 'month', anchor: '2026-01-01' })).toBe(false)
    expect(needsFallbackAnchor({ period: 'all' })).toBe(false)
    expect(needsFallbackAnchor({ period: 'custom' })).toBe(false)
    expect(needsFallbackAnchor({}, 'week')).toBe(true)
  })
})

describe('timeframeQuery / buildHref', () => {
  it('round-trips through resolveTimeframe', () => {
    for (const params of [
      { period: 'week', anchor: '2026-10-08' },
      { period: 'quarter', anchor: '2026-05-05' },
      { period: 'custom', from: '2026-01-01', to: '2026-02-15' },
      { period: 'all' },
    ]) {
      const tf = resolveTimeframe(params)
      expect(resolveTimeframe(timeframeQuery(tf))).toEqual(tf)
    }
  })

  it('builds hrefs without empty params', () => {
    expect(buildHref('/reports', { group: 'tasks', anchor: null, sort: '' })).toBe('/reports?group=tasks')
    expect(buildHref('/reports', {})).toBe('/reports')
  })
})

describe('inTimeframe', () => {
  it('is inclusive and handles open bounds', () => {
    const tf = resolveTimeframe({ period: 'month', anchor: '2026-02-10' })
    expect(inTimeframe(tf, d('2026-02-01'))).toBe(true)
    expect(inTimeframe(tf, d('2026-02-28'))).toBe(true)
    expect(inTimeframe(tf, d('2026-03-01'))).toBe(false)
    expect(inTimeframe(resolveTimeframe({}), d('1999-01-01'))).toBe(true)
  })
})

/* ---------- Semimonth (Harvest: 1st–15th, then 16th–last day) ---------- */
describe('semimonth', () => {
  it('sits between Week and Month in the picker, labeled "Semimonth"', () => {
    expect(PERIODS.map((p) => p.label).slice(0, 3)).toEqual(['Week', 'Semimonth', 'Month'])
  })

  it('anchors in the first half → 1st–15th', () => {
    const tf = resolveTimeframe({ period: 'semimonth', anchor: '2026-10-12' })
    expect([ymd(tf.from), ymd(tf.till)]).toEqual(['2026-10-01', '2026-10-15'])
    expect(tf.label).toBe('10/1 – 10/15 2026')
    expect(tf.anchor).toBe('2026-10-01')
  })

  it('anchors in the second half → 16th–last day', () => {
    const tf = resolveTimeframe({ period: 'semimonth', anchor: '2026-10-20' })
    expect([ymd(tf.from), ymd(tf.till)]).toEqual(['2026-10-16', '2026-10-31'])
    expect(tf.label).toBe('10/16 – 10/31 2026')
  })

  it('handles the 15th/16th boundary and 30-day months', () => {
    expect(ymd(resolveTimeframe({ period: 'semimonth', anchor: '2026-09-15' }).till)).toBe('2026-09-15')
    const s = resolveTimeframe({ period: 'semimonth', anchor: '2026-09-16' })
    expect([ymd(s.from), ymd(s.till)]).toEqual(['2026-09-16', '2026-09-30'])
  })

  it('ends February on the 29th in a leap year (28th otherwise)', () => {
    expect(ymd(resolveTimeframe({ period: 'semimonth', anchor: '2028-02-20' }).till)).toBe('2028-02-29')
    expect(ymd(resolveTimeframe({ period: 'semimonth', anchor: '2027-02-20' }).till)).toBe('2027-02-28')
  })

  it('steps between halves with prev/next, crossing months and years', () => {
    const first = resolveTimeframe({ period: 'semimonth', anchor: '2026-10-01' })
    expect(first.prevAnchor).toBe('2026-09-16')
    expect(first.nextAnchor).toBe('2026-10-16')
    const prev = resolveTimeframe({ period: 'semimonth', anchor: first.prevAnchor! })
    expect([ymd(prev.from), ymd(prev.till)]).toEqual(['2026-09-16', '2026-09-30'])
    const second = resolveTimeframe({ period: 'semimonth', anchor: '2026-12-20' })
    expect(second.prevAnchor).toBe('2026-12-01')
    expect(second.nextAnchor).toBe('2027-01-01')
    expect(resolveTimeframe({ period: 'semimonth', anchor: '2027-01-05' }).prevAnchor).toBe('2026-12-16')
  })

  it('round-trips through timeframeQuery', () => {
    const tf = resolveTimeframe({ period: 'semimonth', anchor: '2026-10-20' })
    expect(resolveTimeframe(timeframeQuery(tf))).toEqual(tf)
  })
})

/* ---------- Project detail page (formerly modules/projects/timeframe.ts) ---------- */
describe('project page', () => {
  const now = new Date('2026-10-12T15:30:00.000Z') // a Monday
  const tf = (params: Record<string, string>, extra: Parameters<typeof resolveTimeframe>[1] = {}) => resolveTimeframe(params, { now, ...extra })

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

  it('uses the default period anchored on today (`now`) when none is given', () => {
    expect(tf({}).period).toBe('all')
    const m = tf({}, { defaultPeriod: 'month' })
    expect([m.period, ymd(m.from), ymd(m.till)]).toEqual(['month', '2026-10-01', '2026-10-31'])
  })

  it('accepts ?date= as an alias of ?anchor= (old project links); anchor wins', () => {
    const w = tf({ period: 'week', date: '2026-10-15' })
    expect([ymd(w.from), ymd(w.till)]).toEqual(['2026-10-12', '2026-10-18'])
    expect(timeframeQuery(w)).toEqual({ period: 'week', anchor: '2026-10-12' })
    expect(ymd(tf({ period: 'month', anchor: '2026-03-03', date: '2026-07-07' }).from)).toBe('2026-03-01')
  })

  it('quarter and year (inclusive bounds)', () => {
    const q = tf({ period: 'quarter', date: '2026-08-20' })
    expect([ymd(q.from), ymd(q.till)]).toEqual(['2026-07-01', '2026-09-30'])
    const y = tf({ period: 'year', date: '2025-06-01' })
    expect([ymd(y.from), ymd(y.till)]).toEqual(['2025-01-01', '2025-12-31'])
  })

  it('ignores invalid dates', () => {
    expect(parseYmd('2026-02-30')).toBeNull()
    expect(ymd(tf({ period: 'month', date: 'garbage' }).from)).toBe('2026-10-01')
    expect(ymd(tf({ period: 'month', anchor: '2026-02-30' }).from)).toBe('2026-10-01')
  })

  it('maps legacy month/year links to period=month (or year)', () => {
    const a = tf({ month: '2025-03', year: '2026' })
    expect([a.period, ymd(a.from), ymd(a.till)]).toEqual(['month', '2025-03-01', '2025-03-31'])
    const b = tf({ month: '7', year: '2024' })
    expect([b.period, ymd(b.from)]).toEqual(['month', '2024-07-01'])
    const b2 = tf({ month: '7' })
    expect([b2.period, ymd(b2.from)]).toEqual(['month', '2026-07-01'])
    const c = tf({ year: '2023' })
    expect([c.period, ymd(c.from), ymd(c.till)]).toEqual(['year', '2023-01-01', '2023-12-31'])
  })

  it('explicit period wins over legacy params; invalid legacy params fall through to the default', () => {
    expect(tf({ period: 'all', month: '2025-03' }).period).toBe('all')
    expect(tf({ month: '13' }, { defaultPeriod: 'month' }).label).toBe('October 2026')
  })

  it('legacy links and ?date= count as anchored for needsFallbackAnchor', () => {
    expect(needsFallbackAnchor({ month: '2025-03' })).toBe(false)
    expect(needsFallbackAnchor({ period: 'week', date: '2026-01-01' })).toBe(false)
  })

  it('prev/next step bounded periods and are null for all time / custom', () => {
    expect(tf({ period: 'week', date: '2026-10-12' }).prevAnchor).toBe('2026-10-05')
    expect(tf({ period: 'month', date: '2026-01-15' }).prevAnchor).toBe('2025-12-01')
    expect(tf({ period: 'quarter', date: '2026-11-01' }).nextAnchor).toBe('2027-01-01')
    expect(tf({ period: 'year', date: '2026-11-01' }).nextAnchor).toBe('2027-01-01')
    expect(tf({ period: 'all' }).nextAnchor).toBeNull()
    expect(tf({ period: 'custom', from: '2026-01-01', to: '2026-01-31' }).nextAnchor).toBeNull()
  })

  it('labels a week across a year boundary', () => {
    expect(tf({ period: 'week', date: '2026-12-30' }).label).toBe('12/28 – 1/3 2027')
  })

  it('endExclusive is the day after till (for timestamp columns)', () => {
    expect(ymd(endExclusive(tf({ period: 'month', anchor: '2026-02-03' })))).toBe('2026-03-01')
    expect(endExclusive(tf({ period: 'all' }))).toBeNull()
  })

  it('customSeed prefills from the current selection', () => {
    expect(customSeed(tf({ period: 'month', date: '2026-02-03' }), now)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(customSeed(tf({ period: 'all' }), now)).toEqual({ from: '2026-10-01', to: '2026-10-12' })
    expect(customSeed(tf({ period: 'custom', from: '2026-09-03' }), now)).toEqual({ from: '2026-09-03', to: '2026-10-12' })
  })
})
