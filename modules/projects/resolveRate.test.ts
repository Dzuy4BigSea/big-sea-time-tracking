import { describe, it, expect } from 'vitest'
import { resolveRate, effectiveRate, type RateResolutionInput } from './resolveRate'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/** Minimal valid input; override per test. Defaults to a billable T&M project-rate project. */
function input(overrides: Partial<RateResolutionInput> = {}): RateResolutionInput {
  return {
    spentDate: d('2026-07-02'),
    project: { projectType: 'time_and_materials', billableRateMethod: 'project', projectHourlyRateCents: 15000 },
    task: { defaultBillable: true, defaultHourlyRateCents: 16000 },
    ...overrides,
  }
}

describe('resolveRate', () => {
  it('AC-PROJ-001: project billable rate resolves and amount = rate x hours', () => {
    const r = resolveRate(input())
    expect(r.isBillable).toBe(true)
    expect(r.billableRateCents).toBe(15000)
    expect(r.rateMissing).toBe(false)
    // 90 min at $150/h = $225.00
    const amountCents = Math.round((r.billableRateCents! * 90) / 60)
    expect(amountCents).toBe(22500)
  })

  it('AC-PROJ-002: task-rate assignment override beats the global task default', () => {
    const r = resolveRate(
      input({
        project: { projectType: 'time_and_materials', billableRateMethod: 'task', projectHourlyRateCents: null },
        task: { defaultBillable: true, defaultHourlyRateCents: 10000 }, // $100 default
        taskAssignment: { billable: null, hourlyRateCents: 12000 }, // $120 override
      }),
    )
    expect(r.billableRateCents).toBe(12000)
  })

  it('AC-PROJ-002b: task method with no override falls back to the task default', () => {
    const r = resolveRate(
      input({
        project: { projectType: 'time_and_materials', billableRateMethod: 'task', projectHourlyRateCents: null },
        task: { defaultBillable: true, defaultHourlyRateCents: 10000 },
        taskAssignment: { billable: null, hourlyRateCents: null },
      }),
    )
    expect(r.billableRateCents).toBe(10000)
  })

  it('AC-PROJ-003: person method with no per-project override uses the person effective rate; missing → rateMissing', () => {
    const withRate = resolveRate(
      input({
        project: { projectType: 'time_and_materials', billableRateMethod: 'person', projectHourlyRateCents: null },
        personBillableRates: [{ hourlyRateCents: 12000, startDate: d('2026-01-01'), endDate: null }],
      }),
    )
    expect(withRate.billableRateCents).toBe(12000)

    const noRate = resolveRate(
      input({
        project: { projectType: 'time_and_materials', billableRateMethod: 'person', projectHourlyRateCents: null },
        personBillableRates: [],
      }),
    )
    expect(noRate.isBillable).toBe(true)
    expect(noRate.billableRateCents).toBeNull()
    expect(noRate.rateMissing).toBe(true)
  })

  it('AC-PROJ-003b: person per-project override WINS over the person default', () => {
    const r = resolveRate(
      input({
        project: { projectType: 'time_and_materials', billableRateMethod: 'person', projectHourlyRateCents: null },
        projectUserAssignment: { hourlyRateCents: 13000 }, // override
        personBillableRates: [{ hourlyRateCents: 12000, startDate: d('2026-01-01'), endDate: null }],
      }),
    )
    expect(r.billableRateCents).toBe(13000)
  })

  it('AC-PROJ-004: non-billable project → not billable, no rate, regardless of task', () => {
    const r = resolveRate(
      input({
        project: { projectType: 'non_billable', billableRateMethod: null, projectHourlyRateCents: null },
        task: { defaultBillable: true, defaultHourlyRateCents: 16000 },
      }),
    )
    expect(r.isBillable).toBe(false)
    expect(r.billableRateCents).toBeNull()
    expect(r.rateMissing).toBe(false)
  })

  it('AC-PROJ-004b: T&M with "No billable rate" → billable but rate null + rateMissing', () => {
    const r = resolveRate(
      input({
        project: { projectType: 'time_and_materials', billableRateMethod: 'none', projectHourlyRateCents: null },
      }),
    )
    expect(r.isBillable).toBe(true)
    expect(r.billableRateCents).toBeNull()
    expect(r.rateMissing).toBe(true)
  })

  it('AC-PROJ-005: effective-dated person rate resolves by the entry date', () => {
    const rates = [
      { hourlyRateCents: 15000, startDate: null, endDate: d('2026-06-30') },
      { hourlyRateCents: 17500, startDate: d('2026-07-01'), endDate: null },
    ]
    const june = resolveRate(
      input({
        spentDate: d('2026-06-15'),
        project: { projectType: 'time_and_materials', billableRateMethod: 'person', projectHourlyRateCents: null },
        personBillableRates: rates,
      }),
    )
    const july = resolveRate(
      input({
        spentDate: d('2026-07-15'),
        project: { projectType: 'time_and_materials', billableRateMethod: 'person', projectHourlyRateCents: null },
        personBillableRates: rates,
      }),
    )
    expect(june.billableRateCents).toBe(15000)
    expect(july.billableRateCents).toBe(17500)
  })

  it('AC-PROJ-010: fixed-fee project → billable with rate 0 (fee invoiced separately)', () => {
    const r = resolveRate(
      input({
        project: { projectType: 'fixed_fee', billableRateMethod: null, projectHourlyRateCents: null },
      }),
    )
    expect(r.isBillable).toBe(true)
    expect(r.billableRateCents).toBe(0)
    expect(r.rateMissing).toBe(false)
  })

  it('task assignment can force a billable-by-default task to non-billable', () => {
    const r = resolveRate(input({ taskAssignment: { billable: false, hourlyRateCents: null } }))
    expect(r.isBillable).toBe(false)
    expect(r.billableRateCents).toBeNull()
  })

  it('project-rate method with no project rate set → rateMissing', () => {
    const r = resolveRate(
      input({ project: { projectType: 'time_and_materials', billableRateMethod: 'project', projectHourlyRateCents: null } }),
    )
    expect(r.rateMissing).toBe(true)
    expect(r.billableRateCents).toBeNull()
  })
})

describe('effectiveRate', () => {
  it('picks the row whose range contains the date; boundaries inclusive', () => {
    const rates = [
      { hourlyRateCents: 100, startDate: null, endDate: d('2026-06-30') },
      { hourlyRateCents: 200, startDate: d('2026-07-01'), endDate: null },
    ]
    expect(effectiveRate(rates, d('2026-06-30'))).toBe(100)
    expect(effectiveRate(rates, d('2026-07-01'))).toBe(200)
    expect(effectiveRate([], d('2026-07-01'))).toBeNull()
    expect(effectiveRate(undefined, d('2026-07-01'))).toBeNull()
  })
})
