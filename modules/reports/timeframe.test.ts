import { describe, it, expect } from 'vitest'
import { resolveTimeframe, needsFallbackAnchor, timeframeQuery, inTimeframe, buildHref, parsePeriod } from './timeframe'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
const ymd = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null)

describe('resolveTimeframe', () => {
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
