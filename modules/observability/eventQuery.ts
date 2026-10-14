/**
 * Settings → Activity log: filter parsing, keyset pagination and the Prisma `where` for the
 * account-wide InvoiceEvent list. Pure (no Prisma import beyond types) so it is unit-tested.
 *
 * Ordering is (occurredAt DESC, id DESC); the cursor is the last row's (occurredAt, id), so pages
 * stay stable while new events arrive and every page is an index range scan on
 * InvoiceEvent(accountId, occurredAt) / (accountId, level, occurredAt).
 */
import type { Prisma } from '@prisma/client'

export const PAGE_SIZE = 50
export const PROBLEMS_DAYS = 30
export const LEVELS = ['info', 'warn', 'error'] as const
export const SOURCES = ['app', 'email', 'client', 'stripe', 'xero', 'cron'] as const
export type Level = (typeof LEVELS)[number]

export interface EventFilters {
  /** 'problems' = warn + error over the last PROBLEMS_DAYS (the default view); 'all' = every level. */
  view: 'problems' | 'all'
  levels: Level[]
  source: string | null
  stagePrefix: string | null
  /** Inclusive UTC instant bounds. */
  from: Date | null
  to: Date | null
  /** YYYY-MM-DD as typed, echoed back into the form. */
  fromYmd: string | null
  toYmd: string | null
  invoiceQuery: string | null
}

type Params = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim()
const YMD = /^\d{4}-\d{2}-\d{2}$/

/**
 * UTC instant of local midnight on `ymd` in `tz` (DST-safe to the minute for real zones).
 * Computes the zone offset at that wall-clock time via Intl.
 */
export function zonedMidnightUtc(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  const offsetAt = (ms: number) => {
    let zone = tz
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone })
    } catch {
      zone = 'UTC'
    }
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(ms))
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value)
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ms
  }
  let ts = guess - offsetAt(guess)
  ts = guess - offsetAt(ts) // second pass handles a DST change between the guess and the answer
  return new Date(ts)
}

export function parseFilters(params: Params, tz: string, now: Date = new Date()): EventFilters {
  const view = one(params.view) === 'all' ? 'all' : one(params.view) === 'problems' ? 'problems' : null
  const levelParam = one(params.level)
  const source = one(params.source)
  const stagePrefix = one(params.stage).replace(/[^a-z0-9._-]/gi, '').slice(0, 60)
  const fromYmd = YMD.test(one(params.from)) ? one(params.from) : null
  const toYmd = YMD.test(one(params.to)) ? one(params.to) : null
  const invoiceQuery = one(params.q).slice(0, 40) || null
  const anyFilter = !!(levelParam || source || stagePrefix || fromYmd || toYmd || invoiceQuery)
  // No params at all → the Problems view. Any explicit filter (or view=all) → the "all" view.
  const effectiveView: 'problems' | 'all' = view ?? (anyFilter ? 'all' : 'problems')

  let levels: Level[] = (levelParam.split(',').filter((l) => (LEVELS as readonly string[]).includes(l)) as Level[])
  if (levelParam === 'problems') levels = ['warn', 'error']
  if (effectiveView === 'problems' && !levels.length) levels = ['warn', 'error']

  let from = fromYmd ? zonedMidnightUtc(fromYmd, tz) : null
  if (effectiveView === 'problems' && !from) from = new Date(now.getTime() - PROBLEMS_DAYS * 86_400_000)
  // `to` is inclusive of that whole local day.
  let to: Date | null = null
  if (toYmd) {
    const [y, m, d] = toYmd.split('-').map(Number)
    const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
    to = new Date(zonedMidnightUtc(next, tz).getTime() - 1)
  }

  return {
    view: effectiveView,
    levels,
    source: (SOURCES as readonly string[]).includes(source) ? source : null,
    stagePrefix: stagePrefix || null,
    from,
    to,
    fromYmd,
    toYmd,
    invoiceQuery,
  }
}

export interface Cursor {
  occurredAt: Date
  id: string
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.occurredAt.toISOString()}|${c.id}`, 'utf8').toString('base64url')
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null
  try {
    const s = Buffer.from(raw, 'base64url').toString('utf8')
    const i = s.indexOf('|')
    if (i < 0) return null
    const occurredAt = new Date(s.slice(0, i))
    const id = s.slice(i + 1)
    if (Number.isNaN(occurredAt.getTime()) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null
    return { occurredAt, id }
  } catch {
    return null
  }
}

/**
 * The Prisma `where` for the filtered list. `invoiceIds` is the resolved invoice-number search
 * (null = no search; [] = search matched nothing → empty result). Always scoped to `accountId` (INV-5).
 */
export function buildEventWhere(
  accountId: string,
  f: EventFilters,
  opts: { invoiceIds?: string[] | null; cursor?: Cursor | null } = {},
): Prisma.InvoiceEventWhereInput {
  const and: Prisma.InvoiceEventWhereInput[] = [{ accountId }]
  if (f.levels.length && f.levels.length < LEVELS.length) and.push({ level: { in: f.levels } })
  if (f.source) and.push({ source: f.source })
  if (f.stagePrefix) and.push({ stage: { startsWith: f.stagePrefix } })
  if (f.from || f.to) and.push({ occurredAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } })
  if (opts.invoiceIds) and.push({ invoiceId: { in: opts.invoiceIds } })
  const c = opts.cursor
  if (c) and.push({ OR: [{ occurredAt: { lt: c.occurredAt } }, { occurredAt: c.occurredAt, id: { lt: c.id } }] })
  return { AND: and }
}

export const EVENT_ORDER: Prisma.InvoiceEventOrderByWithRelationInput[] = [{ occurredAt: 'desc' }, { id: 'desc' }]

/** Split a `take: PAGE_SIZE + 1` result into the page and the next cursor (null on the last page). */
export function pageOf<T extends { occurredAt: Date; id: string }>(rows: T[], size = PAGE_SIZE): { rows: T[]; next: string | null } {
  if (rows.length <= size) return { rows, next: null }
  const page = rows.slice(0, size)
  const last = page[page.length - 1]
  return { rows: page, next: encodeCursor({ occurredAt: last.occurredAt, id: last.id }) }
}

/** Query string for the current filters (+ optional cursor), for pager links and the CSV export. */
export function filtersToQuery(f: EventFilters, extra: Record<string, string | null | undefined> = {}): string {
  const p = new URLSearchParams()
  p.set('view', f.view)
  if (f.view === 'all' && f.levels.length) p.set('level', f.levels.join(','))
  if (f.source) p.set('source', f.source)
  if (f.stagePrefix) p.set('stage', f.stagePrefix)
  if (f.fromYmd) p.set('from', f.fromYmd)
  if (f.toYmd) p.set('to', f.toYmd)
  if (f.invoiceQuery) p.set('q', f.invoiceQuery)
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v)
  return p.toString()
}

export const CSV_HEADERS = ['occurred_at', 'level', 'source', 'stage', 'invoice_number', 'invoice_id', 'payment_id', 'message', 'external_id', 'http_status', 'duration_ms']

export function csvRow(
  e: { occurredAt: Date; level: string; source: string; stage: string; invoiceId: string | null; paymentId: string | null; message: string; externalId: string | null; httpStatus: number | null; durationMs: number | null },
  invoiceNumber: string | null,
): Array<string | number | null> {
  return [e.occurredAt.toISOString(), e.level, e.source, e.stage, invoiceNumber, e.invoiceId, e.paymentId, e.message, e.externalId, e.httpStatus, e.durationMs]
}
