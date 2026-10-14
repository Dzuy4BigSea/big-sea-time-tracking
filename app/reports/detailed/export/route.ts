import { requireUser } from '@/lib/session'
import { csvStreamResponse } from '@/lib/csvStream'
import { detailedTimeExport } from '@/modules/reports/exports'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // all-time exports stream ~200 batches

/**
 * Detailed time report → CSV, same filters and order as the screen, every matching entry (no row cap).
 * Streamed in keyset-paginated batches (modules/reports/exports.ts).
 */
export async function GET(req: Request) {
  const me = await requireUser()
  const built = await detailedTimeExport(me, new URL(req.url).searchParams)
  if (!built.ok) return new Response(built.message, { status: built.status })
  return csvStreamResponse(built.spec.filename, built.spec.headers, built.spec.batches)
}
