import { describe, it, expect } from 'vitest'
import {
  computeTimerMinutes,
  canEditEntry,
  canDeleteEntry,
  assertEditable,
  assertDeletable,
  LockedEntryError,
  startTimerPlan,
} from './timeEntry'

const t = (iso: string) => new Date(iso)

describe('computeTimerMinutes', () => {
  it('AC-TIME-003: a 1h30m run yields 90 minutes (no rounding at storage)', () => {
    expect(computeTimerMinutes(t('2026-07-10T09:00:00Z'), t('2026-07-10T10:30:00Z'))).toBe(90)
  })
  it('rounds to the nearest minute and never goes negative', () => {
    expect(computeTimerMinutes(t('2026-07-10T09:00:00Z'), t('2026-07-10T09:00:40Z'))).toBe(1)
    expect(computeTimerMinutes(t('2026-07-10T09:00:00Z'), t('2026-07-10T09:00:20Z'))).toBe(0)
    expect(computeTimerMinutes(t('2026-07-10T10:00:00Z'), t('2026-07-10T09:00:00Z'))).toBe(0)
  })
})

describe('edit/delete lock guards', () => {
  it('AC-TIME-006: approved entries cannot be edited', () => {
    expect(canEditEntry('approved')).toBe(false)
    expect(() => assertEditable('approved')).toThrow(LockedEntryError)
  })
  it('AC-TIME-007: invoiced entries cannot be edited or deleted', () => {
    expect(canEditEntry('invoiced')).toBe(false)
    expect(canDeleteEntry('invoiced')).toBe(false)
    expect(() => assertEditable('invoiced')).toThrow(LockedEntryError)
    expect(() => assertDeletable('invoiced')).toThrow(LockedEntryError)
  })
  it('open entries are editable and deletable', () => {
    expect(canEditEntry('open')).toBe(true)
    expect(canDeleteEntry('open')).toBe(true)
    expect(() => assertEditable('open')).not.toThrow()
  })
})

describe('startTimerPlan', () => {
  it('AC-TIME-002/014: starting a timer stops the currently running one', () => {
    const plan = startTimerPlan(
      { id: 'te_running', timerStartedAt: t('2026-07-10T09:00:00Z') },
      t('2026-07-10T09:45:00Z'),
    )
    expect(plan.stopEntryId).toBe('te_running')
    expect(plan.stopMinutes).toBe(45)
  })
  it('no running timer → nothing to stop', () => {
    const plan = startTimerPlan(null, t('2026-07-10T09:45:00Z'))
    expect(plan.stopEntryId).toBeNull()
    expect(plan.stopMinutes).toBe(0)
  })
})
