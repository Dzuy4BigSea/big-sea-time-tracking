import { prisma } from '@/lib/prisma'
import { autoStopRunawayTimers } from '@/modules/time/timer'
import { MAX_TIMER_MINUTES } from '@/modules/time/timeEntry'

export const dynamic = 'force-dynamic'

/**
 * Runaway-timer sweep: stops any timer running longer than MAX_TIMER_MINUTES (12h), books the
 * capped minutes, appends "(auto-stopped after 12h)" to the notes and writes an audit row.
 * Invoked by Vercel Cron (see vercel.json). Vercel injects `Authorization: Bearer $CRON_SECRET`
 * when the CRON_SECRET env var is set; we require it (fail closed) so it is not publicly triggerable.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const asOf = new Date()
  const stopped = await autoStopRunawayTimers(prisma, asOf)
  return Response.json({ ok: true, timersStopped: stopped, maxMinutes: MAX_TIMER_MINUTES, asOf: asOf.toISOString() })
}
