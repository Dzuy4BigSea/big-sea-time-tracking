import { describe, it, expect } from 'vitest'
import { budgetSeries, chartScale, niceCeil, fmtAmount, fmtTick, remainingText } from './budgetChart'

const H = 60 // minutes per hour

describe('budgetSeries', () => {
  it('runs a cumulative total from prior spend and flags the first bucket past the budget', () => {
    const s = budgetSeries([10 * H, 20 * H, 0, 30 * H], { budget: 80 * H, prior: 25 * H })
    expect(s.map((p) => p.cumulative / H)).toEqual([35, 55, 55, 85])
    expect(s.map((p) => p.remaining! / H)).toEqual([45, 25, 25, -5])
    expect(s.map((p) => p.over)).toEqual([false, false, false, true])
    expect(s[1].spent).toBe(20 * H)
  })

  it('is exactly at budget without being over', () => {
    const [p] = budgetSeries([80 * H], { budget: 80 * H })
    expect(p.remaining).toBe(0)
    expect(p.over).toBe(false)
  })

  it('measures each bucket alone for a monthly-reset budget (prior ignored)', () => {
    const s = budgetSeries([15 * H, 25 * H], { budget: 20 * H, prior: 999, resetsEachPeriod: true })
    expect(s.map((p) => p.cumulative / H)).toEqual([15, 25])
    expect(s.map((p) => p.remaining! / H)).toEqual([5, -5])
    expect(s.map((p) => p.over)).toEqual([false, true])
  })

  it('has no remaining without a budget, and marks buckets after lastIndex as future', () => {
    const s = budgetSeries([1, 2, 3], { budget: null, lastIndex: 0 })
    expect(s.map((p) => p.remaining)).toEqual([null, null, null])
    expect(s.map((p) => p.over)).toEqual([false, false, false])
    expect(s.map((p) => p.future)).toEqual([false, true, true])
    expect(budgetSeries([1], { budget: 5, lastIndex: -1 })[0].future).toBe(true)
  })

  it('works in cents for fee budgets', () => {
    const s = budgetSeries([300_00, 250_00], { budget: 500_00 })
    expect(s.map((p) => p.remaining)).toEqual([200_00, -50_00])
  })
})

describe('chartScale', () => {
  it('extends the axis to include the budget line', () => {
    expect(chartScale([10 * H, 12 * H], 80 * H, 'hours')).toEqual({ max: 100 * H, ticks: 4 })
  })

  it('uses the data when it exceeds the budget, with round tick steps', () => {
    expect(chartScale([45 * H], 30 * H, 'hours')).toEqual({ max: 50 * H, ticks: 5 })
    expect(chartScale([22 * H], null, 'hours')).toEqual({ max: 25 * H, ticks: 5 })
    expect(chartScale([18 * H], null, 'hours')).toEqual({ max: 20 * H, ticks: 4 })
  })

  it('scales money in dollars and never collapses to zero', () => {
    expect(chartScale([1_234_00], 1_500_00, 'money')).toEqual({ max: 2_000_00, ticks: 4 })
    expect(chartScale([], null, 'hours').max).toBeGreaterThan(0)
  })

  it('niceCeil rounds up to 1/2/2.5/5/10 × 10ⁿ', () => {
    expect([0, 0.7, 3, 21, 240, 600].map(niceCeil)).toEqual([1, 1, 5, 25, 250, 1000])
  })
})

describe('labels', () => {
  it('formats amounts, ticks and remaining/over text', () => {
    expect(fmtAmount(80 * H, 'hours')).toBe('80.00 hours')
    expect(fmtAmount(1_250_00, 'money')).toBe('$1,250.00')
    expect(fmtTick(12.5 * H, 'hours')).toBe('12.5h')
    expect(fmtTick(500_00, 'money')).toBe('$500')
    expect(fmtTick(2_500_00, 'money')).toBe('$2.5k')
    expect(remainingText(15.5 * H, 'hours')).toBe('Remaining: 15.50 hours')
    expect(remainingText(-4 * H, 'hours')).toBe('Over budget by 4.00 hours')
    expect(remainingText(-50_00, 'money')).toBe('Over budget by $50.00')
  })
})
