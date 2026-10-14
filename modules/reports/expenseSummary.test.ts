import { describe, it, expect } from 'vitest'
import { parseExpenseTab, detailedRange, detailedExpenseQuery, expenseWhere, groupColumns, BILLED_SQL } from './expenseSummary'
import { parseDetailed } from './detailed'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('parseExpenseTab (AC-EXP-103)', () => {
  it('defaults to clients and accepts the four tabs', () => {
    expect(parseExpenseTab(undefined)).toBe('clients')
    expect(parseExpenseTab('bogus')).toBe('clients')
    for (const t of ['clients', 'projects', 'categories', 'team']) expect(parseExpenseTab(t)).toBe(t)
  })
})

describe('drill-down to the Detailed expense report (AC-EXP-104)', () => {
  it('carries the timeframe as a custom range', () => {
    expect(detailedRange({ from: d('2026-10-12'), till: d('2026-10-18') })).toEqual({ range: 'custom', from: '2026-10-12', to: '2026-10-18' })
    expect(detailedRange({ from: null, till: null })).toEqual({ range: 'all' })
  })
  it('filters by the row, and round-trips through the detailed report parser', () => {
    const tf = { from: d('2026-10-01'), till: d('2026-10-31') }
    const cases = [
      ['clients', 'clients'],
      ['projects', 'projects'],
      ['categories', 'items'],
      ['team', 'users'],
    ] as const
    for (const [tab, field] of cases) {
      const q = detailedExpenseQuery(tf, tab, 'abc123')
      const f = parseDetailed('expense', q)
      expect(f[field]).toEqual(['abc123'])
      expect(f.range).toBe('custom')
      expect([f.from, f.to]).toEqual(['2026-10-01', '2026-10-31'])
    }
  })
})

describe('expenseWhere scope (AC-EXP-101/102, INV-5)', () => {
  it('always scopes to the account', () => {
    const w = expenseWhere({ accountId: 'acc1', onlyUserId: null }, { from: null, till: null })
    expect(w.sql).toContain('"accountId"')
    expect(w.values).toEqual(['acc1'])
    expect(w.sql).not.toContain('"userId"')
  })
  it('limits members to their own expenses and applies the timeframe', () => {
    const w = expenseWhere({ accountId: 'acc1', onlyUserId: 'u1' }, { from: d('2026-10-01'), till: d('2026-10-31') })
    expect(w.sql).toContain('e."userId" = ?')
    expect(w.values).toEqual(['acc1', 'u1', d('2026-10-01'), d('2026-10-31')])
  })
})

describe('SQL shape', () => {
  it('groups by an id for every tab', () => {
    for (const t of ['clients', 'projects', 'categories', 'team'] as const) expect(groupColumns(t).id.sql).toMatch(/\.id$/)
  })
  it('bills markup per expense', () => {
    expect(BILLED_SQL.sql).toContain('markupPercent')
  })
})
