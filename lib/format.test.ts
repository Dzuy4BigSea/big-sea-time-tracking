import { describe, it, expect } from 'vitest'
import { formatDateTimeAt } from './format'

describe('formatDateTimeAt', () => {
  it('formats in the account timezone, Harvest activity style', () => {
    // 15:37 UTC = 11:37am Eastern (EDT) on 09/23/2026
    expect(formatDateTimeAt(new Date('2026-09-23T15:37:00Z'), 'America/New_York')).toBe('09/23/2026 at 11:37am')
    expect(formatDateTimeAt(new Date('2026-09-24T01:05:00Z'), 'America/New_York')).toBe('09/23/2026 at 9:05pm')
  })
  it('falls back to Eastern for an unknown zone', () => {
    expect(formatDateTimeAt(new Date('2026-09-23T15:37:00Z'), 'Not/AZone')).toBe('09/23/2026 at 11:37am')
  })
})
