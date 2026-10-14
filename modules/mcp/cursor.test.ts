import { describe, it, expect } from 'vitest'
import { encodeCursor, decodeCursor, filterFingerprint, offsetFromCursor, pageOf } from './cursor'

describe('opaque cursors', () => {
  const fp = filterFingerprint({ t: 'time', from: '2026-10-01', to: '2026-10-31', userIds: ['a'] })

  it('round-trips a position for the same filters', () => {
    const c = encodeCursor({ d: '2026-10-12', id: 'cuid123' }, fp)
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeCursor(c, fp)).toEqual({ d: '2026-10-12', id: 'cuid123' })
  })

  it('fingerprints are order-insensitive and ignore undefined', () => {
    expect(filterFingerprint({ a: 1, b: [1, 2], c: undefined })).toBe(filterFingerprint({ b: [1, 2], a: 1 }))
    expect(filterFingerprint({ a: 1 })).not.toBe(filterFingerprint({ a: 2 }))
  })

  it('refuses a cursor replayed with different filters', () => {
    const c = encodeCursor({ o: 100 }, fp)
    const other = filterFingerprint({ t: 'time', from: '2026-09-01' })
    expect(() => decodeCursor(c, other)).toThrow(/different filters/)
  })

  it('refuses garbage and empty cursors', () => {
    expect(() => decodeCursor('not-a-cursor', fp)).toThrow(/not a valid cursor/)
    expect(() => decodeCursor('', fp)).toThrow(/must not be empty/)
    expect(() => decodeCursor(Buffer.from('{"v":99,"p":{}}').toString('base64url'), fp)).toThrow(/not a valid cursor/)
  })

  it('offset cursors', () => {
    expect(offsetFromCursor(undefined, fp)).toBe(0)
    expect(offsetFromCursor(encodeCursor({ o: 200 }, fp), fp)).toBe(200)
    expect(() => offsetFromCursor(encodeCursor({ o: -1 }, fp), fp)).toThrow()
  })

  it('pageOf trims the look-ahead row and emits next_cursor only when truncated', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const p = pageOf(rows, 2, (last) => ({ id: last.id }), fp)
    expect(p.page).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(p.truncated).toBe(true)
    expect(decodeCursor(p.next_cursor!, fp)).toEqual({ id: 'b' })
    const q = pageOf(rows.slice(0, 2), 2, (last) => ({ id: last.id }), fp)
    expect(q).toEqual({ page: rows.slice(0, 2), truncated: false, next_cursor: null })
  })
})
