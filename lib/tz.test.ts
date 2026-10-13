import { describe, expect, it } from 'vitest'
import { todayIn, todayYmdIn, zonedParts, formatTimeIn } from './tz'

describe('todayIn', () => {
  it('keeps an Eastern evening on the same day (23:30 EDT = 03:30Z next day)', () => {
    const now = new Date('2026-10-14T03:30:00Z')
    expect(todayYmdIn('America/New_York', now)).toBe('2026-10-13')
    expect(todayIn('America/New_York', now).toISOString()).toBe('2026-10-13T00:00:00.000Z')
  })

  it('handles EST (winter) offsets', () => {
    expect(todayYmdIn('America/New_York', new Date('2026-12-02T04:30:00Z'))).toBe('2026-12-01')
    expect(todayYmdIn('America/New_York', new Date('2026-12-02T05:30:00Z'))).toBe('2026-12-02')
  })

  it('falls back to New York for missing or invalid zones', () => {
    const now = new Date('2026-10-14T03:30:00Z')
    expect(todayYmdIn(null, now)).toBe('2026-10-13')
    expect(todayYmdIn('Not/AZone', now)).toBe('2026-10-13')
  })

  it('respects other zones', () => {
    expect(todayYmdIn('UTC', new Date('2026-10-14T03:30:00Z'))).toBe('2026-10-14')
  })
})

describe('zonedParts / formatTimeIn', () => {
  it('returns wall-clock hour in the zone', () => {
    expect(zonedParts(new Date('2026-10-13T16:05:00Z'), 'America/New_York').hour).toBe(12)
    expect(formatTimeIn(new Date('2026-10-13T16:05:00Z'), 'America/New_York')).toBe('12:05 PM')
  })
})
