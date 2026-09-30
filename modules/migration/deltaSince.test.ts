import { describe, expect, it } from 'vitest'
import { isCleanPull, resolveDeltaSince, type SnapshotLike } from './deltaSince'

const snap = (o: Partial<SnapshotLike>): SnapshotLike => ({
  status: 'complete',
  mode: 'full',
  createdAt: new Date('2026-08-06T12:00:00Z'),
  meta: null,
  ...o,
})

describe('isCleanPull', () => {
  it('treats no errors as clean', () => expect(isCleanPull([])).toBe(true))
  it('ignores the estimates 403', () => expect(isCleanPull(['estimates|'])).toBe(true))
  it('is not clean when real data failed', () => expect(isCleanPull(['estimates|', 'time_entries|2024'])).toBe(false))
})

describe('resolveDeltaSince', () => {
  it('prefers the saved lastPulledAt', () => {
    expect(resolveDeltaSince('2026-09-01T00:00:00Z', [snap({})])).toBe('2026-09-01T00:00:00Z')
  })

  it('falls back to a partial full backup start (the estimates-403 case)', () => {
    const s = snap({ status: 'partial', meta: { startedAt: '2026-08-06T10:00:00Z' } })
    expect(resolveDeltaSince(null, [s])).toBe('2026-08-06T10:00:00Z')
  })

  it('uses createdAt when meta has no startedAt', () => {
    expect(resolveDeltaSince(undefined, [snap({ status: 'partial' })])).toBe('2026-08-06T12:00:00.000Z')
  })

  it('picks the newest finished full backup, ignoring running and incremental ones', () => {
    const snaps = [
      snap({ createdAt: new Date('2026-08-01T00:00:00Z'), meta: { startedAt: 'old' } }),
      snap({ createdAt: new Date('2026-08-06T00:00:00Z'), status: 'partial', meta: { startedAt: 'newest-full' } }),
      snap({ createdAt: new Date('2026-08-10T00:00:00Z'), status: 'running', meta: { startedAt: 'running' } }),
      snap({ createdAt: new Date('2026-08-12T00:00:00Z'), mode: 'incremental', meta: { startedAt: 'incr' } }),
    ]
    expect(resolveDeltaSince(null, snaps)).toBe('newest-full')
  })

  it('returns null with no finished full backup', () => {
    expect(resolveDeltaSince(null, [snap({ status: 'running' }), snap({ status: 'error' })])).toBeNull()
  })
})
