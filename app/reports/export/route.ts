import { requireUser } from '@/lib/session'
import { csvStreamResponse } from '@/lib/csvStream'
import { timeReportExport } from '@/modules/reports/exports'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // all-time exports stream ~200 batches

/**
 * Time report export (Reports → Export → CSV). Account-scoped; reports permission required. Streams
 * keyset-paginated batches (modules/reports/exports.ts), so "All time" never loads the whole table.
 */
export async function GET(req: Request) {
  const me = await requireUser()
  const built = await timeReportExport(me, new URL(req.url).searchParams)
  if (!built.ok) return new Response(built.message, { status: built.status })
  return csvStreamResponse(built.spec.filename, built.spec.headers, built.spec.batches)
}
