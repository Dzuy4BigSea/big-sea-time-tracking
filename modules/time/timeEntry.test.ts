import { describe, it, expect } from 'vitest'
import {
  computeTimerMinutes,
  canEditEntry,
  canDeleteEntry,
  assertEditable,
  assertDeletable,
  LockedEntryError,
  startTimerPlan,
  MAX_TIMER_MINUTES,
  AUTO_STOP_NOTE,
  isRunawayTimer,
  appendAutoStopNote,
  isUniqueViolation,
  isDuplicateStart,
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

describe('timer cap (runaway timers)', () => {
  it('caps a single run at MAX_TIMER_MINUTES (12h)', () => {
    expect(MAX_TIMER_MINUTES).toBe(720)
    expect(computeTimerMinutes(t('2026-07-10T09:00:00Z'), t('2026-07-10T21:00:00Z'))).toBe(720)
    expect(computeTimerMinutes(t('2026-07-10T09:00:00Z'), t('2026-07-12T09:00:00Z'))).toBe(720)
    expect(computeTimerMinutes(t('2026-07-10T09:00:00Z'), t('2026-07-10T20:59:00Z'))).toBe(719)
  })
  it('startTimerPlan books at most the cap on the stopped timer', () => {
    expect(startTimerPlan({ id: 'old', timerStartedAt: t('2026-07-09T09:00:00Z') }, t('2026-07-10T09:00:00Z')).stopMinutes).toBe(720)
  })
  it('isRunawayTimer is true only past 12h', () => {
    expect(isRunawayTimer(t('2026-07-10T09:00:00Z'), t('2026-07-10T21:00:00Z'))).toBe(false)
    expect(isRunawayTimer(t('2026-07-10T09:00:00Z'), t('2026-07-10T21:00:01Z'))).toBe(true)
  })
  it('appendAutoStopNote appends once', () => {
    expect(appendAutoStopNote(null)).toBe(AUTO_STOP_NOTE)
    expect(appendAutoStopNote('  design review ')).toBe(`design review ${AUTO_STOP_NOTE}`)
    expect(appendAutoStopNote(`x ${AUTO_STOP_NOTE}`)).toBe(`x ${AUTO_STOP_NOTE}`)
  })
})

describe('timer race handling', () => {
  it('isUniqueViolation recognizes Prisma P2002 only', () => {
    expect(isUniqueViolation({ code: 'P2002', meta: { target: 'one_running_timer_per_user' } })).toBe(true)
    expect(isUniqueViolation({ code: 'P2025' })).toBe(false)
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
  it('isDuplicateStart: same project/task started moments ago is a double-submit', () => {
    const running = { projectId: 'p', taskId: 'k', timerStartedAt: t('2026-07-10T09:00:00Z') }
    expect(isDuplicateStart(running, { projectId: 'p', taskId: 'k', now: t('2026-07-10T09:00:03Z') })).toBe(true)
    expect(isDuplicateStart(running, { projectId: 'p', taskId: 'k', now: t('2026-07-10T09:05:00Z') })).toBe(false)
    expect(isDuplicateStart(running, { projectId: 'p', taskId: 'other', now: t('2026-07-10T09:00:03Z') })).toBe(false)
    expect(isDuplicateStart(null, { projectId: 'p', taskId: 'k', now: t('2026-07-10T09:00:03Z') })).toBe(false)
  })
})
