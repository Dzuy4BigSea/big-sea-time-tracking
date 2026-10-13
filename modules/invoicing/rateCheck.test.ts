import { describe, it, expect } from 'vitest'
import { resolvePoolRates, needsRate, missingRatesMessage, type PoolEntryRateContext, type RateLookups } from './rateCheck'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const empty = (): RateLookups => ({ taskAssignments: new Map(), userAssignments: new Map(), personRates: new Map() })

function e(p: Partial<PoolEntryRateContext> & { id: string }): PoolEntryRateContext {
  return {
    spentDate: d('2026-07-02'),
    billableRateCents: null,
    projectId: 'prj',
    projectName: 'Website',
    projectType: 'time_and_materials',
    billableRateMethod: 'person',
    projectHourlyRateCents: null,
    taskId: 'tsk',
    taskName: 'Design',
    taskDefaultBillable: true,
    taskDefaultHourlyRateCents: null,
    userId: 'usr',
    userName: 'Frank Lee',
    ...p,
  }
}

describe('rate check at generation', () => {
  it('needsRate: T&M with null/0 rate only', () => {
    expect(needsRate({ projectType: 'time_and_materials', billableRateCents: null })).toBe(true)
    expect(needsRate({ projectType: 'time_and_materials', billableRateCents: 0 })).toBe(true)
    expect(needsRate({ projectType: 'time_and_materials', billableRateCents: 100 })).toBe(false)
    expect(needsRate({ projectType: 'fixed_fee', billableRateCents: 0 })).toBe(false)
  })

  it('re-resolves a missing rate from the effective-dated person rate as of spentDate', () => {
    const lookups = empty()
    lookups.personRates.set('usr', [
      { hourlyRateCents: 10000, startDate: null, endDate: d('2026-06-30') },
      { hourlyRateCents: 12000, startDate: d('2026-07-01'), endDate: null },
    ])
    const { resolved, missing } = resolvePoolRates([e({ id: 'a' }), e({ id: 'b', spentDate: d('2026-06-15') })], lookups)
    expect(missing).toEqual([])
    expect(resolved.get('a')).toBe(12000)
    expect(resolved.get('b')).toBe(10000)
  })

  it('reports distinct project/person/task combos still lacking a rate', () => {
    const { resolved, missing } = resolvePoolRates(
      [e({ id: 'a' }), e({ id: 'b' }), e({ id: 'c', taskId: 't2', taskName: 'Dev' }), e({ id: 'd', billableRateCents: 9000 })],
      empty(),
    )
    expect(resolved.size).toBe(0)
    expect(missing).toEqual([
      { projectName: 'Website', userName: 'Frank Lee', taskName: 'Design' },
      { projectName: 'Website', userName: 'Frank Lee', taskName: 'Dev' },
    ])
    expect(missingRatesMessage(missing)).toMatch(/Website \/ Frank Lee \/ Design; Website \/ Frank Lee \/ Dev/)
  })

  it('a "none" rate method is always missing', () => {
    const { missing } = resolvePoolRates([e({ id: 'a', billableRateMethod: 'none' })], empty())
    expect(missing).toHaveLength(1)
  })
})
