import { describe, expect, it } from 'vitest'
import { parseEmployeeId, parseRoleTags, parseTimezone, timezoneOptions } from './personBasic'

describe('personBasic (AC-TEAM-021)', () => {
  it('parses role tags', () => {
    expect(parseRoleTags('Design, dev ,design,, Project   lead')).toEqual(['Design', 'dev', 'Project lead'])
    expect(parseRoleTags('')).toEqual([])
    expect(parseRoleTags(Array.from({ length: 30 }, (_, i) => `r${i}`).join(','))).toHaveLength(20)
  })
  it('parses employee id', () => {
    expect(parseEmployeeId('  E-12 ')).toBe('E-12')
    expect(parseEmployeeId('   ')).toBeNull()
  })
  it('accepts only real timezones', () => {
    expect(parseTimezone('America/New_York')).toBe('America/New_York')
    expect(parseTimezone('Mars/Olympus')).toBeNull()
    expect(parseTimezone('')).toBeNull()
  })
  it('lists timezones', () => {
    expect(timezoneOptions()).toContain('America/New_York')
  })
})
