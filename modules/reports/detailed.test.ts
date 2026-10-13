import { describe, it, expect } from 'vitest'
import { parseDetailed, detailedQuery, detailedTimeframe, rangeOptions, parseIds } from './detailed'

const now = new Date('2026-10-13T15:00:00.000Z') // a Tuesday
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

describe('parseDetailed', () => {
  it('defaults to This week, everything, grouped by date', () => {
    expect(parseDetailed('time', {})).toEqual({
      kind: 'time', range: 'this_week', from: null, to: null, clients: [], projects: [], items: [], users: [],
      billable: 'all', invoiced: 'all', group: 'date', activeOnly: false, archived: false,
    })
  })

  it('reads ids, toggles and grouping', () => {
    const f = parseDetailed('time', { range: 'last_month', clients: 'c1,c2', tasks: 't1', users: 'u1', billable: 'billable', invoiced: 'uninvoiced', group: 'project', active: '1', archived: '1' })
    expect(f).toMatchObject({ range: 'last_month', clients: ['c1', 'c2'], items: ['t1'], users: ['u1'], billable: 'billable', invoiced: 'uninvoiced', group: 'project', activeOnly: true, archived: true })
  })

  it('uses categories (not tasks) for expenses, and rejects groups that do not apply', () => {
    expect(parseDetailed('expense', { categories: 'k1', tasks: 't1' }).items).toEqual(['k1'])
    expect(parseDetailed('expense', { group: 'task' }).group).toBe('date')
    expect(parseDetailed('time', { group: 'category' }).group).toBe('date')
  })

  it('ignores junk values', () => {
    const f = parseDetailed('time', { range: 'forever', from: 'yesterday', billable: 'maybe', clients: "c1,'; drop table,c1" })
    expect(f).toMatchObject({ range: 'this_week', from: null, billable: 'all', clients: ['c1'] })
  })

  it('keeps from/to only for a custom range', () => {
    expect(parseDetailed('time', { range: 'custom', from: '2026-01-01', to: '2026-03-31' })).toMatchObject({ from: '2026-01-01', to: '2026-03-31' })
    expect(parseDetailed('time', { range: 'this_month', from: '2026-01-01' }).from).toBeNull()
  })
})

describe('detailedQuery', () => {
  it('drops defaults and round-trips', () => {
    expect(detailedQuery(parseDetailed('time', {}))).toEqual({})
    const q = { range: 'custom', from: '2026-01-01', to: '2026-01-31', clients: 'a,b', tasks: 't', group: 'user', invoiced: 'invoiced', active: '1' }
    expect(detailedQuery(parseDetailed('time', q))).toEqual(q)
  })
})

describe('detailedTimeframe', () => {
  it('resolves This week / Last week against today (Monday start)', () => {
    const tw = detailedTimeframe({ range: 'this_week', from: null, to: null }, { now })
    expect([ymd(tw.from), ymd(tw.till)]).toEqual(['2026-10-12', '2026-10-18'])
    const lw = detailedTimeframe({ range: 'last_week', from: null, to: null }, { now })
    expect([ymd(lw.from), ymd(lw.till)]).toEqual(['2026-10-05', '2026-10-11'])
  })
  it('handles last month / last semimonth / last year', () => {
    const lm = detailedTimeframe({ range: 'last_month', from: null, to: null }, { now })
    expect([ymd(lm.from), ymd(lm.till)]).toEqual(['2026-09-01', '2026-09-30'])
    const ls = detailedTimeframe({ range: 'last_semimonth', from: null, to: null }, { now })
    expect([ymd(ls.from), ymd(ls.till)]).toEqual(['2026-09-16', '2026-09-30'])
    const ly = detailedTimeframe({ range: 'last_year', from: null, to: null }, { now })
    expect([ymd(ly.from), ymd(ly.till)]).toEqual(['2025-01-01', '2025-12-31'])
  })
  it('passes All time and custom through', () => {
    expect(detailedTimeframe({ range: 'all', from: null, to: null }, { now }).from).toBeNull()
    const c = detailedTimeframe({ range: 'custom', from: '2026-01-01', to: '2026-02-15' }, { now })
    expect([ymd(c.from), ymd(c.till)]).toEqual(['2026-01-01', '2026-02-15'])
  })
})

describe('rangeOptions', () => {
  it('names the months like Harvest', () => {
    const labels = rangeOptions(now).map((o) => o.label)
    expect(labels).toContain('This month (October)')
    expect(labels).toContain('Last month (September)')
    expect(labels[0]).toBe('This week')
    expect(labels.slice(-2)).toEqual(['All time', 'Custom'])
  })
  it('wraps January back to December', () => {
    expect(rangeOptions(new Date('2026-01-10T00:00:00Z')).map((o) => o.label)).toContain('Last month (December)')
  })
})

describe('parseIds', () => {
  it('accepts repeated params and de-duplicates', () => {
    expect(parseIds(['a,b', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })
})
