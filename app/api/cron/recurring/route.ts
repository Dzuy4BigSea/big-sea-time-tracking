import { prisma } from '@/lib/prisma'
import { generateDueRecurring } from '@/modules/invoicing/generateRecurring'

export const dynamic = 'force-dynamic'

/**
 * Scheduled recurring-invoice generation (specs/10, AC-REC-001).
 * Invoked by Vercel Cron (see vercel.json). Vercel injects
 * `Authorization: Bearer $CRON_SECRET` when the CRON_SECRET env var is set;
 * we require it so the endpoint is not publicly triggerable.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const asOf = new Date()
  const accounts = await prisma.account.findMany({ select: { id: true } })
  let created = 0
  for (const a of accounts) {
    created += await generateDueRecurring(prisma, a.id, asOf)
  }

  return Response.json({ ok: true, accounts: accounts.length, invoicesCreated: created, asOf: asOf.toISOString() })
}
