import { describe, it, expect } from 'vitest'
import { hoursOf, minutesFromHours, roundedHoursOf, parseClock, minutesFromClockPair, durationMinutes, centsFromAmount, paymentTermFrom, harvestInvoiceState } from './format'
import { matchesSearch, matchesPrefix } from './search'
import { auditActionFor, auditDetail, auditSummary } from './audit'
import { ToolError } from './errors'

describe('API unit conversion', () => {
  it('hours ↔ minutes', () => {
    expect(hoursOf(90)).toBe(1.5)
    expect(hoursOf(20)).toBe(0.33)
    expect(minutesFromHours(1.5)).toBe(90)
    expect(minutesFromHours(0.25)).toBe(15)
    expect(() => minutesFromHours(0)).toThrow(/greater than 0/)
    expect(() => minutesFromHours(-1)).toThrow()
    expect(() => minutesFromHours(0.001)).toThrow(/rounds to 0 minutes/)
    expect(() => minutesFromHours(25)).toThrow(/24 hours/)
  })

  it('rounded hours only when the account rounds', () => {
    expect(roundedHoursOf(52, 'none')).toBeUndefined()
    expect(roundedHoursOf(52, 'nearest_15')).toBe(0.75)
    expect(roundedHoursOf(52, 'nearest_6')).toBe(0.9)
  })

  it('parses clock times', () => {
    expect(parseClock('9:00am')).toBe(540)
    expect(parseClock('9am')).toBe(540)
    expect(parseClock('12:15am')).toBe(15)
    expect(parseClock('12pm')).toBe(720)
    expect(parseClock('2:05 PM')).toBe(845)
    expect(parseClock('14:30')).toBe(870)
    expect(parseClock('9')).toBeNull()
    expect(parseClock('25:00')).toBeNull()
    expect(parseClock('13pm')).toBeNull()
  })

  it('derives durations from hours or a clock pair, never both', () => {
    expect(minutesFromClockPair('9:00am', '11:00am')).toBe(120)
    expect(() => minutesFromClockPair('11am', '9am')).toThrow(/after/)
    expect(() => minutesFromClockPair('9am', undefined)).toThrow(/together/)
    expect(durationMinutes({ hours: 2 }, true)).toBe(120)
    expect(durationMinutes({ started_time: '9:00', ended_time: '9:45' }, true)).toBe(45)
    expect(durationMinutes({}, false)).toBeUndefined()
    expect(() => durationMinutes({}, true)).toThrow(/Provide hours/)
    expect(() => durationMinutes({ hours: 1, started_time: '9am', ended_time: '10am' }, true)).toThrow(/not both/)
  })

  it('money is converted to integer cents (INV-1)', () => {
    expect(centsFromAmount(42.5, 'x')).toBe(4250)
    expect(centsFromAmount(0.1 + 0.2, 'x')).toBe(30)
    expect(() => centsFromAmount(0, 'x')).toThrow()
    expect(centsFromAmount(0, 'x', { allowZero: true })).toBe(0)
    expect(() => centsFromAmount(-1, 'x')).toThrow(/negative/)
  })

  it('payment terms and invoice states', () => {
    expect(paymentTermFrom('net 30')).toBe('net_30')
    expect(paymentTermFrom('Net-15')).toBe('net_15')
    expect(paymentTermFrom('upon receipt')).toBe('due_on_receipt')
    expect(() => paymentTermFrom('net 90')).toThrow(/not supported/)
    expect(harvestInvoiceState('written_off')).toBe('closed')
    expect(harvestInvoiceState('open')).toBe('open')
  })
})

describe('search helpers', () => {
  it('ignores punctuation and spacing', () => {
    expect(matchesSearch('acme-co', 'Acme Co.')).toBe(true)
    expect(matchesSearch('B-BRE038', 'Brooks', 'B-BRE038')).toBe(true)
    expect(matchesSearch('zzz', 'Acme')).toBe(false)
    expect(matchesSearch(undefined, 'x')).toBe(true)
  })
  it('prefix-matches names and emails', () => {
    expect(matchesPrefix('mar', 'Maria', 'Mora', 'Maria Mora', 'maria@x.com')).toBe(true)
    expect(matchesPrefix('mor', 'Maria', 'Mora')).toBe(true)
    expect(matchesPrefix('ria', 'Maria', 'Mora')).toBe(false)
  })
})

describe('MCP audit rows', () => {
  it('maps tools to audit actions', () => {
    expect(auditActionFor('log_time')).toBe('create')
    expect(auditActionFor('assign_user_to_project')).toBe('create')
    expect(auditActionFor('delete_time_entry')).toBe('delete')
    expect(auditActionFor('unassign_user_from_project')).toBe('delete')
    expect(auditActionFor('update_project')).toBe('update')
    expect(auditActionFor('stop_timer')).toBe('update')
  })
  it('records outcome, result id and truncated args', () => {
    const ok = auditDetail('log_time', { hours: 1 }, { ok: true, result: { id: 'te1' } })
    expect(ok).toMatchObject({ via: 'mcp', tool: 'log_time', ok: true, resultId: 'te1', args: '{"hours":1}' })
    const err = new ToolError('forbidden', 'nope')
    expect(auditDetail('log_time', { notes: 'x'.repeat(5000) }, { ok: false, error: err })).toMatchObject({ ok: false, error: 'forbidden' })
    expect((auditDetail('log_time', { notes: 'x'.repeat(5000) }, { ok: false, error: err }).args as string).length).toBeLessThan(2100)
    expect(auditSummary('log_time', { ok: false, error: err })).toBe('MCP log_time refused (forbidden)')
  })
})
