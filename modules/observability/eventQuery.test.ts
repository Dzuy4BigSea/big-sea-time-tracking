import { describe, it, expect } from 'vitest'
import {
  parseFilters, buildEventWhere, encodeCursor, decodeCursor, pageOf, filtersToQuery, zonedMidnightUtc, csvRow, PAGE_SIZE,
} from './eventQuery'

const NY = 'America/New_York'
const now = new Date('2026-10-14T15:00:00Z')

describe('parseFilters', () => {
  it('no params → Problems view: warn+error, last 30 days', () => {
    const f = parseFilters({}, NY, now)
    expect(f.view).toBe('problems')
    expect(f.levels).toEqual(['warn', 'error'])
    expect(f.from?.toISOString()).toBe('2026-09-14T15:00:00.000Z')
    expect(f.to).toBeNull()
  })
  it('any explicit filter switches to the all view with no implicit date floor', () => {
    const f = parseFilters({ source: 'stripe' }, NY, now)
    expect(f).toMatchObject({ view: 'all', levels: [], source: 'stripe', from: null })
  })
  it('view=all with nothing else shows everything', () => {
    expect(parseFilters({ view: 'all' }, NY, now)).toMatchObject({ view: 'all', levels: [], from: null })
  })
  it('rejects unknown levels/sources and sanitises the stage prefix', () => {
    const f = parseFilters({ view: 'all', level: 'error,bogus', source: 'evil', stage: "email.'; drop" }, NY, now)
    expect(f.levels).toEqual(['error'])
    expect(f.source).toBeNull()
    expect(f.stagePrefix).toBe('email.drop')
  })
  it('date range is interpreted in the account timezone, `to` inclusive of the whole day', () => {
    const f = parseFilters({ from: '2026-10-01', to: '2026-10-02' }, NY, now)
    expect(f.from?.toISOString()).toBe('2026-10-01T04:00:00.000Z')
    expect(f.to?.toISOString()).toBe('2026-10-03T03:59:59.999Z')
  })
  it('ignores malformed dates', () => {
    expect(parseFilters({ view: 'all', from: '10/01/2026' }, NY, now).from).toBeNull()
  })
})

describe('zonedMidnightUtc', () => {
  it('handles both sides of the DST change', () => {
    expect(zonedMidnightUtc('2026-11-01', NY).toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(zonedMidnightUtc('2026-11-02', NY).toISOString()).toBe('2026-11-02T05:00:00.000Z')
  })
  it('falls back to UTC for a bad zone', () => {
    expect(zonedMidnightUtc('2026-11-02', 'Not/AZone').toISOString()).toBe('2026-11-02T00:00:00.000Z')
  })
})

describe('cursor', () => {
  it('round-trips', () => {
    const c = { occurredAt: new Date('2026-10-01T01:02:03.456Z'), id: 'clx123abc' }
    expect(decodeCursor(encodeCursor(c))).toEqual(c)
  })
  it('rejects garbage', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull()
    expect(decodeCursor(Buffer.from('2026-10-01T00:00:00Z|bad id;').toString('base64url'))).toBeNull()
    expect(decodeCursor(null)).toBeNull()
  })
})

describe('buildEventWhere', () => {
  it('always scopes to the account and applies the keyset predicate', () => {
    const f = parseFilters({}, NY, now)
    const cursor = { occurredAt: new Date('2026-10-10T00:00:00Z'), id: 'abc' }
    const w = buildEventWhere('acc_1', f, { cursor, invoiceIds: ['inv_1'] })
    expect(w.AND).toEqual([
      { accountId: 'acc_1' },
      { level: { in: ['warn', 'error'] } },
      { occurredAt: { gte: f.from } },
      { invoiceId: { in: ['inv_1'] } },
      { OR: [{ occurredAt: { lt: cursor.occurredAt } }, { occurredAt: cursor.occurredAt, id: { lt: 'abc' } }] },
    ])
  })
  it('all three levels selected → no level clause; stage prefix → startsWith', () => {
    const f = parseFilters({ view: 'all', level: 'info,warn,error', stage: 'xero.' }, NY, now)
    expect(buildEventWhere('a', f).AND).toEqual([{ accountId: 'a' }, { stage: { startsWith: 'xero.' } }])
  })
  it('an invoice search that matched nothing yields an empty IN (no rows), not "no filter"', () => {
    const f = parseFilters({ q: '9999' }, NY, now)
    expect(buildEventWhere('a', f, { invoiceIds: [] }).AND).toContainEqual({ invoiceId: { in: [] } })
  })
})

describe('pageOf', () => {
  const rows = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => ({ id: `e${String(100 - i).padStart(3, '0')}`, occurredAt: new Date(Date.UTC(2026, 9, 1, 0, 100 - i)) }))
  it('more rows than a page → next cursor from the last row shown', () => {
    const p = pageOf(rows)
    expect(p.rows).toHaveLength(PAGE_SIZE)
    expect(decodeCursor(p.next)).toEqual({ id: rows[PAGE_SIZE - 1].id, occurredAt: rows[PAGE_SIZE - 1].occurredAt })
  })
  it('last page → no cursor', () => {
    expect(pageOf(rows.slice(0, 3)).next).toBeNull()
  })
})

it('filtersToQuery round-trips through parseFilters', () => {
  const f = parseFilters({ view: 'all', level: 'warn,error', source: 'xero', stage: 'xero.', from: '2026-10-01', q: '7801' }, NY, now)
  const back = parseFilters(Object.fromEntries(new URLSearchParams(filtersToQuery(f))), NY, now)
  expect(back).toEqual(f)
})

it('csvRow emits ISO time and the invoice number', () => {
  const row = csvRow(
    { occurredAt: new Date('2026-10-01T00:00:00Z'), level: 'error', source: 'xero', stage: 'xero.error', invoiceId: 'i1', paymentId: null, message: 'boom', externalId: null, httpStatus: 400, durationMs: 12 },
    '7801',
  )
  expect(row).toEqual(['2026-10-01T00:00:00.000Z', 'error', 'xero', 'xero.error', '7801', 'i1', null, 'boom', null, 400, 12])
})
