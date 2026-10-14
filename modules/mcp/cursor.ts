/**
 * Opaque pagination cursors (Harvest MCP contract: pass `next_cursor` back as `cursor` with every
 * other parameter identical; never construct one). A cursor carries the paging position plus a
 * fingerprint of the filters it was issued for, so a cursor replayed with different filters is
 * refused (`validation_failed`) instead of silently returning a wrong page.
 */
import { createHash } from 'node:crypto'
import { invalid } from './errors'

const VERSION = 1

/** Stable fingerprint of the filter parameters (order-insensitive keys; cursor/limit excluded by callers). */
export function filterFingerprint(filters: Record<string, unknown>): string {
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]))
        : v
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== null))
  return createHash('sha256').update(JSON.stringify(norm(clean))).digest('base64url').slice(0, 12)
}

export function encodeCursor<P extends Record<string, unknown>>(position: P, fingerprint: string): string {
  return Buffer.from(JSON.stringify({ v: VERSION, f: fingerprint, p: position }), 'utf8').toString('base64url')
}

/** Decode a cursor issued for `fingerprint`; throws validation_failed when malformed or reused with other filters. */
export function decodeCursor<P extends Record<string, unknown>>(cursor: string, fingerprint: string): P {
  if (!cursor) throw invalid('cursor: must not be empty — omit it on the first request.')
  let parsed: { v?: unknown; f?: unknown; p?: unknown }
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw invalid('cursor: not a valid cursor — pass back the exact next_cursor from the previous response.')
  }
  if (!parsed || parsed.v !== VERSION || typeof parsed.p !== 'object' || parsed.p === null) {
    throw invalid('cursor: not a valid cursor — pass back the exact next_cursor from the previous response.')
  }
  if (parsed.f !== fingerprint) {
    throw invalid('cursor: was issued for different filters — keep every other parameter identical when paginating.')
  }
  return parsed.p as P
}

/** Offset cursors for small/medium lists (projects, invoices, expenses, users). */
export function offsetFromCursor(cursor: string | undefined, fingerprint: string): number {
  if (cursor === undefined) return 0
  const p = decodeCursor<{ o?: unknown }>(cursor, fingerprint)
  if (typeof p.o !== 'number' || !Number.isInteger(p.o) || p.o < 0) throw invalid('cursor: not a valid cursor.')
  return p.o
}

/**
 * Page bookkeeping for a query that fetched `limit + 1` rows: trims the extra row and builds the
 * Harvest-style `{ truncated, next_cursor }`.
 */
export function pageOf<T>(rows: T[], limit: number, nextPosition: (last: T) => Record<string, unknown>, fingerprint: string) {
  const truncated = rows.length > limit
  const page = truncated ? rows.slice(0, limit) : rows
  return {
    page,
    truncated,
    next_cursor: truncated && page.length ? encodeCursor(nextPosition(page[page.length - 1]), fingerprint) : null,
  }
}
