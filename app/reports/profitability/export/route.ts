import { requireUser } from '@/lib/session'
import { csvStreamResponse } from '@/lib/csvStream'
import { profitabilityExport } from '@/modules/reports/exports'

export const dynamic = 'force-dynamic'

/** Profitability report → CSV (one row per client/project, same timeframe as the screen). Reports permission required. */
export async function GET(req: Request) {
  const me = await requireUser()
  const built = await profitabilityExport(me, new URL(req.url).searchParams)
  if (!built.ok) return new Response(built.message, { status: built.status })
  return csvStreamResponse(built.spec.filename, built.spec.headers, built.spec.batches)
}
