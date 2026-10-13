import { NextRequest } from 'next/server'
import { requireUser } from '@/lib/session'
import { csvStreamResponse } from '@/lib/csvStream'
import { projectTasksExport } from '@/modules/reports/exports'

export const dynamic = 'force-dynamic'

/** Per-task (and per-person) time breakdown for a project + timeframe → CSV (project → Tasks → Export).
 *  Takes the project page's timeframe params (period/anchor/from/to; ?date= and legacy ?month=/?year= still work). */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await requireUser()
  const built = await projectTasksExport(me, params.id, req.nextUrl.searchParams)
  if (!built.ok) return new Response(built.message, { status: built.status })
  return csvStreamResponse(built.spec.filename, built.spec.headers, built.spec.batches)
}
