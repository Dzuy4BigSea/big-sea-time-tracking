import { describe, it, expect } from 'vitest'
import { parseTimeTab, defaultTimeSort, pct, formatHours, billableShareTitle, sumTotals, splitByPersonType } from './timeReport'

describe('parseTimeTab', () => {
  it('reads Harvest ?tab= names', () => {
    expect(parseTimeTab({ tab: 'projects' })).toBe('projects')
    expect(parseTimeTab({ tab: 'users' })).toBe('users')
  })
  it('keeps the old ?group= params working', () => {
    expect(parseTimeTab({ group: 'teammates' })).toBe('users')
    expect(parseTimeTab({ group: 'teammate' })).toBe('users')
    expect(parseTimeTab({ group: 'tasks' })).toBe('tasks')
  })
  it('prefers tab over group and defaults to clients', () => {
    expect(parseTimeTab({ tab: 'tasks', group: 'projects' })).toBe('tasks')
    expect(parseTimeTab({ tab: 'bogus' })).toBe('clients')
    expect(parseTimeTab({})).toBe('clients')
  })
})

describe('defaultTimeSort', () => {
  it('sorts by name A→Z except tasks (hours desc)', () => {
    expect(defaultTimeSort('clients')).toEqual({ key: 'name', dir: 'asc' })
    expect(defaultTimeSort('users')).toEqual({ key: 'name', dir: 'asc' })
    expect(defaultTimeSort('tasks')).toEqual({ key: 'hours', dir: 'desc' })
  })
})

describe('formatting', () => {
  it('pct handles zero', () => {
    expect(pct(0, 0)).toBe(0)
    expect(pct(78, 870)).toBe(9)
  })
  it('formats hours with two decimals', () => {
    expect(formatHours(78)).toBe('1.30')
    expect(formatHours(74070)).toBe('1,234.50')
  })
  it('builds the bar tooltip', () => {
    expect(billableShareTitle(60, 60)).toBe('Billable hours: 100% / Non-billable hours: 0%')
    expect(billableShareTitle(0, 0)).toBe('Billable hours: 0% / Non-billable hours: 0%')
    expect(billableShareTitle(30, 120)).toBe('Billable hours: 25% / Non-billable hours: 75%')
  })
})

describe('splitByPersonType', () => {
  const r = (minutes: number, personType: string) => ({ minutes, billableMinutes: minutes, billableCents: 100, uninvoicedCents: 50, personType })
  it('groups employees then contractors with subtotals, dropping empty sections', () => {
    const out = splitByPersonType([r(60, 'contractor'), r(30, 'employee'), r(90, 'employee')])
    expect(out.map((s) => s.label)).toEqual(['Employees', 'Contractors'])
    expect(out[0].rows.map((x) => x.minutes)).toEqual([30, 90])
    expect(out[0].totals).toEqual({ minutes: 120, billableMinutes: 120, billableCents: 200, uninvoicedCents: 100 })
    expect(splitByPersonType([r(1, 'employee')]).map((s) => s.label)).toEqual(['Employees'])
  })
  it('sums totals', () => {
    expect(sumTotals([])).toEqual({ minutes: 0, billableMinutes: 0, billableCents: 0, uninvoicedCents: 0 })
  })
})
