import { describe, it, expect } from 'vitest'
import {
  formatDayMonYear, weeksLeft, projectDateRange, budgetSummary, billableRatesMissing, initials, rollup, isBillableTask, preTaxCents,
  type TaskPersonCell,
} from './projectAnalysis'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
const now = new Date('2026-10-12T15:30:00.000Z')

describe('project header dates', () => {
  it('formats DD Mon YYYY', () => {
    expect(formatDayMonYear(d('2026-01-01'))).toBe('01 Jan 2026')
    expect(formatDayMonYear(d('2026-12-31'))).toBe('31 Dec 2026')
  })

  it('counts whole weeks left (Harvest: 11 weeks from 12 Oct to 31 Dec)', () => {
    expect(weeksLeft(d('2026-12-31'), now)).toBe(11)
    expect(weeksLeft(d('2026-10-18'), now)).toBe(0)
    expect(weeksLeft(d('2026-10-19'), now)).toBe(1)
    expect(weeksLeft(d('2026-01-01'), now)).toBe(0)
  })

  it('builds the range line, with the suffix only while the end is ahead', () => {
    expect(projectDateRange(d('2026-01-01'), d('2026-12-31'), now)).toBe('01 Jan 2026 - 31 Dec 2026 (11 weeks left)')
    expect(projectDateRange(d('2025-01-01'), d('2025-12-31'), now)).toBe('01 Jan 2025 - 31 Dec 2025')
    expect(projectDateRange(d('2026-10-13'), d('2026-10-20'), now)).toBe('13 Oct 2026 - 20 Oct 2026 (1 week left)')
    expect(projectDateRange(d('2026-01-01'), null, now)).toBe('Starts 01 Jan 2026')
    expect(projectDateRange(null, d('2026-12-31'), now)).toBe('Ends 31 Dec 2026 (11 weeks left)')
    expect(projectDateRange(null, null, now)).toBeNull()
  })
})

describe('budgetSummary', () => {
  it('hours budget: remaining minutes and percentages (Harvest example 118.25h budget, 112.55h spent)', () => {
    const s = budgetSummary({ budgetMethod: 'hours_total', budgetValue: 7095 }, { minutes: 6753, billableCents: 0 })!
    expect(s).toMatchObject({ unit: 'hours', budget: 7095, spent: 6753, remaining: 342, pctRemaining: 5, pctSpent: 95, over: false })
  })

  it('over budget clamps percentages and flags over', () => {
    const s = budgetSummary({ budgetMethod: 'hours_per_task', budgetValue: 600 }, { minutes: 900, billableCents: 0 })!
    expect(s).toMatchObject({ remaining: -300, pctRemaining: 0, pctSpent: 100, over: true })
  })

  it('fee budget compares against the billable amount (cents)', () => {
    const s = budgetSummary({ budgetMethod: 'fee_total', budgetValue: 1_000_000 }, { minutes: 999, billableCents: 250_000 })!
    expect(s).toMatchObject({ unit: 'money', remaining: 750_000, pctRemaining: 75 })
  })

  it('no budget, empty value, or cost budget → null', () => {
    expect(budgetSummary({ budgetMethod: 'none', budgetValue: null }, { minutes: 1, billableCents: 1 })).toBeNull()
    expect(budgetSummary({ budgetMethod: 'hours_total', budgetValue: 0 }, { minutes: 1, billableCents: 1 })).toBeNull()
    expect(budgetSummary({ budgetMethod: 'cost_total', budgetValue: 5000 }, { minutes: 1, billableCents: 1 })).toBeNull()
  })
})

describe('billableRatesMissing', () => {
  const tm = { projectType: 'time_and_materials', billableRateMethod: 'person', projectHourlyRateCents: null }
  it('flags T&M projects with no rate method or no project rate', () => {
    expect(billableRatesMissing({ ...tm, billableRateMethod: null }, 0)).toBe(true)
    expect(billableRatesMissing({ ...tm, billableRateMethod: 'none' }, 0)).toBe(true)
    expect(billableRatesMissing({ ...tm, billableRateMethod: 'project' }, 0)).toBe(true)
    expect(billableRatesMissing({ ...tm, billableRateMethod: 'project', projectHourlyRateCents: 15000 }, 0)).toBe(false)
  })
  it('flags billable time without a resolved rate', () => {
    expect(billableRatesMissing(tm, 0)).toBe(false)
    expect(billableRatesMissing(tm, 30)).toBe(true)
  })
  it('never flags fixed-fee or non-billable projects', () => {
    expect(billableRatesMissing({ ...tm, projectType: 'fixed_fee', billableRateMethod: null }, 60)).toBe(false)
    expect(billableRatesMissing({ ...tm, projectType: 'non_billable', billableRateMethod: null }, 60)).toBe(false)
  })
})

describe('initials', () => {
  it('takes first and last initials', () => {
    expect(initials('Jane Q. Doe')).toBe('JD')
    expect(initials('  prince ')).toBe('PR')
    expect(initials('')).toBe('?')
  })
})

describe('rollup', () => {
  const cells: TaskPersonCell[] = [
    { taskId: 't1', taskName: 'Design', userId: 'u1', userName: 'Ann', minutes: 60, billableMinutes: 60, billableCents: 10000 },
    { taskId: 't1', taskName: 'Design', userId: 'u2', userName: 'Bob', minutes: 30, billableMinutes: 0, billableCents: 0 },
    { taskId: 't2', taskName: 'Dev', userId: 'u1', userName: 'Ann', minutes: 120, billableMinutes: 120, billableCents: 20000 },
  ]
  it('by task: totals per task with people as children', () => {
    const r = rollup(cells, 'task')
    expect(r.map((x) => [x.id, x.minutes, x.billableMinutes, x.billableCents])).toEqual([['t1', 90, 60, 10000], ['t2', 120, 120, 20000]])
    expect(r[0].children.map((c) => c.name)).toEqual(['Ann', 'Bob'])
  })
  it('by person: totals per person with tasks as children', () => {
    const r = rollup(cells, 'person')
    expect(r.map((x) => [x.id, x.minutes, x.billableCents])).toEqual([['u1', 180, 30000], ['u2', 30, 0]])
    expect(r[0].children.map((c) => c.name)).toEqual(['Design', 'Dev'])
  })
})

describe('isBillableTask', () => {
  it('uses the assignment flag, else whether any time was billable', () => {
    expect(isBillableTask('time_and_materials', true, 0)).toBe(true)
    expect(isBillableTask('time_and_materials', false, 60)).toBe(false)
    expect(isBillableTask('time_and_materials', null, 60)).toBe(true)
    expect(isBillableTask('time_and_materials', undefined, 0)).toBe(false)
    expect(isBillableTask('non_billable', true, 60)).toBe(false)
  })
})

describe('preTaxCents', () => {
  it('is subtotal less discount', () => {
    expect(preTaxCents({ subtotalCents: 100_000, discountCents: 5_000 })).toBe(95_000)
  })
})
