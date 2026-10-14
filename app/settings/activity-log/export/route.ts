import { prisma } from '@/lib/prisma'
import { getCurrentUser, userCan } from '@/lib/session'
import { toCsv, csvResponse } from '@/lib/csv'
import { invoiceIdsForQuery, invoiceNumbers, findEvents } from '@/lib/activityLog'
import { parseFilters, CSV_HEADERS, csvRow, type Cursor } from '@/modules/observability/eventQuery'

export const dynamic = 'force-dynamic'

const BATCH = 1000
const MAX_ROWS = 20_000

/** Settings → Activity log → Export CSV: the filtered rows (keyset batches, capped at 20k). */
export async function GET(req: Request) {
  const me = await getCurrentUser()
  if (!me) return new Response('Unauthorized', { status: 401 })
  if (!userCan(me, 'edit_account_settings') && !userCan(me, 'manage_invoices')) return new Response('Forbidden', { status: 403 })

  const account = await prisma.account.findUnique({ where: { id: me.accountId }, select: { timezone: true } })
  const params = Object.fromEntries(new URL(req.url).searchParams)
  const f = parseFilters(params, account?.timezone ?? 'America/New_York')
  const invoiceIds = await invoiceIdsForQuery(me.accountId, f.invoiceQuery)

  const out: Array<Array<unknown>> = []
  let cursor: Cursor | null = null
  while (out.length < MAX_ROWS) {
    const batch = await findEvents(me.accountId, f, invoiceIds, cursor, Math.min(BATCH, MAX_ROWS - out.length))
    if (!batch.length) break
    const numbers = await invoiceNumbers(me.accountId, batch.map((r) => r.invoiceId))
    for (const r of batch) out.push(csvRow(r, r.invoiceId ? numbers.get(r.invoiceId) ?? null : null))
    const last = batch[batch.length - 1]
    cursor = { occurredAt: last.occurredAt, id: last.id }
    if (batch.length < BATCH) break
  }
  const stamp = new Date().toISOString().slice(0, 10)
  return csvResponse(`track2-activity-log-${f.view}-${stamp}.csv`, toCsv(CSV_HEADERS, out))
}
