import { describe, it, expect } from 'vitest'
import { parseDurationToMinutes, applyRounding, formatMinutes } from './duration'

describe('parseDurationToMinutes', () => {
  it('AC-TIME-005: 1:30, 1.5, and 90m all parse to 90 minutes', () => {
    expect(parseDurationToMinutes('1:30')).toBe(90)
    expect(parseDurationToMinutes('1.5')).toBe(90)
    expect(parseDurationToMinutes('90m')).toBe(90)
  })

  it('treats a bare number as decimal hours (Harvest behavior)', () => {
    expect(parseDurationToMinutes('2')).toBe(120)
    expect(parseDurationToMinutes('0.25')).toBe(15)
  })

  it('parses compound forms and trims whitespace', () => {
    expect(parseDurationToMinutes('1h30m')).toBe(90)
    expect(parseDurationToMinutes('  45m ')).toBe(45)
    expect(parseDurationToMinutes('2h')).toBe(120)
  })

  it('returns null for unparseable input', () => {
    expect(parseDurationToMinutes('')).toBeNull()
    expect(parseDurationToMinutes('abc')).toBeNull()
    expect(parseDurationToMinutes('1:99')).toBeNull()
  })
})

describe('applyRounding', () => {
  it('none returns minutes unchanged', () => {
    expect(applyRounding(52, 'none')).toBe(52)
  })

  it('AC-TIME-004: nearest_15 rounds to the nearest quarter hour, ties up', () => {
    expect(applyRounding(53, 'nearest_15')).toBe(60) // 53 -> 60 (nearer 60)
    expect(applyRounding(52, 'nearest_15')).toBe(45) // 52 -> 45 (nearer 45)
    expect(applyRounding(7, 'nearest_15')).toBe(0) // 7  -> 0
    expect(applyRounding(8, 'nearest_15')).toBe(15) // 8  -> 15
  })

  it('nearest_6 rounds to tenths of an hour', () => {
    expect(applyRounding(4, 'nearest_6')).toBe(6)
    expect(applyRounding(2, 'nearest_6')).toBe(0)
  })
})

describe('formatMinutes', () => {
  it('hh_mm pads minutes', () => {
    expect(formatMinutes(90)).toBe('1:30')
    expect(formatMinutes(65)).toBe('1:05')
    expect(formatMinutes(0)).toBe('0:00')
  })

  it('decimal shows two places', () => {
    expect(formatMinutes(90, 'decimal')).toBe('1.50')
  })
})
