import { prisma } from '@/lib/prisma'
import { generateDueRecurring } from '@/modules/invoicing/generateRecurring'

export const dynamic = 'force-dynamic'

/**
 * Scheduled recurring-invoice generation (specs/10, AC-REC-001).
 * Invoked by Vercel Cron (see vercel.json). Vercel injects
 * `Authorization: Bearer $CRON_SECRET` when the CRON_SECRET env var is set;
 * we require it so the endpoint is not publicly triggerable.
 *
 * Failures are isolated per profile (and per account) and reported in the JSON summary; the
 * response is 500 when anything failed so the cron run shows as failed and gets noticed.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const now = new Date()
  const accounts = await prisma.account.findMany({ select: { id: true } })
  let created = 0
  const errors: { accountId: string; profileId: string | null; message: string }[] = []
  for (const a of accounts) {
    try {
      const r = await generateDueRecurring(prisma, a.id, now)
      created += r.created
      for (const e of r.errors) errors.push({ accountId: a.id, ...e })
    } catch (e) {
      errors.push({ accountId: a.id, profileId: null, message: (e as Error)?.message?.slice(0, 300) ?? String(e) })
    }
  }
  if (errors.length) console.error('[cron/recurring] failures', JSON.stringify(errors))

  return Response.json(
    { ok: errors.length === 0, accounts: accounts.length, invoicesCreated: created, errors, asOf: now.toISOString() },
    { status: errors.length ? 500 : 200 },
  )
}
