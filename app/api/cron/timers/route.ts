import { prisma } from '@/lib/prisma'
import { autoStopRunawayTimers } from '@/modules/time/timer'
import { MAX_TIMER_MINUTES } from '@/modules/time/timeEntry'
import { runIntegrationsHealth } from '@/modules/observability/healthRunner'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Runaway-timer sweep: stops any timer running longer than MAX_TIMER_MINUTES (12h), books the
 * capped minutes, appends "(auto-stopped after 12h)" to the notes and writes an audit row.
 * Invoked by Vercel Cron (see vercel.json). Vercel injects `Authorization: Bearer $CRON_SECRET`
 * when the CRON_SECRET env var is set; we require it (fail closed) so it is not publicly triggerable.
 *
 * It also runs the daily billing-chain health check (modules/observability/healthRunner), so that
 * runs without another cron entry (Hobby plan limits). A failing check never fails the timer sweep:
 * the outcome is in the `health` field and recorded as InvoiceEvents.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const asOf = new Date()
  const stopped = await autoStopRunawayTimers(prisma, asOf)

  let health: { ok: boolean; totals?: { total: number; ok: number; warn: number; error: number }; error?: string }
  try {
    const h = await runIntegrationsHealth({ now: asOf, source: 'cron' })
    health = { ok: h.ok, totals: h.totals }
  } catch (e) {
    health = { ok: false, error: (e as Error)?.message?.slice(0, 200) ?? 'health check failed' }
  }

  return Response.json({ ok: true, timersStopped: stopped, maxMinutes: MAX_TIMER_MINUTES, asOf: asOf.toISOString(), health })
}
