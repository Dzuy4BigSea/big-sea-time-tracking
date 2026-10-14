import { runIntegrationsHealth, compactSummary } from '@/modules/observability/healthRunner'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Billing-chain health check (OPS.md "Billing chain: trace, checks, tests"): read-only provider
 * checks (SendGrid, Stripe, Xero) + our own trace for every account. Records one InvoiceEvent per
 * check and emails admins about errors (once per 24h per check). 200 when nothing is in error, 503
 * otherwise, so an external uptime monitor can watch it.
 *
 * Not scheduled in vercel.json (Hobby cron limits): app/api/cron/timers calls the same runner daily.
 * Same auth as the other cron routes: `Authorization: Bearer $CRON_SECRET`, fail closed.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  const summary = await runIntegrationsHealth({ source: 'cron' })
  return Response.json(compactSummary(summary), { status: summary.ok ? 200 : 503 })
}
