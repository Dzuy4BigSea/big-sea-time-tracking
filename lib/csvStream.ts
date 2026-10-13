/**
 * Streaming CSV responses. Large exports (388k time entries) are produced batch by batch from a
 * keyset-paginated query, so neither the server nor the DB ever holds the whole table at once.
 * Cell escaping matches lib/csv.ts (RFC-4180) and the output starts with the same UTF-8 BOM.
 */

function escapeCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function csvLine(cells: unknown[]): string {
  return cells.map(escapeCell).join(',')
}

/**
 * A text/csv Response whose body is pulled from `batches` (each yields rows of cells). The header line
 * is sent first; each batch is encoded and flushed as one chunk. Errors mid-stream abort the download
 * (the browser shows a failed download rather than a silently truncated file).
 */
export function csvStreamResponse(
  filename: string,
  headers: string[],
  batches: () => AsyncIterable<unknown[][]>,
): Response {
  const enc = new TextEncoder()
  let iter: AsyncIterator<unknown[][]> | null = null
  let first = true
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (first) {
          first = false
          controller.enqueue(enc.encode('﻿' + csvLine(headers)))
          iter = batches()[Symbol.asyncIterator]()
          return
        }
        // Every pull must enqueue or close, or the stream stalls: skip over empty batches.
        for (;;) {
          const next = await iter!.next()
          if (next.done) {
            controller.close()
            return
          }
          if (next.value.length) {
            controller.enqueue(enc.encode(next.value.map((r) => '\r\n' + csvLine(r)).join('')))
            return
          }
        }
      } catch (e) {
        controller.error(e)
      }
    },
    async cancel() {
      await iter?.return?.()
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/** Batch size for keyset-paginated exports. */
export const EXPORT_BATCH = 2000
