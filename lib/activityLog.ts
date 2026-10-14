import 'server-only'
import { prisma } from '@/lib/prisma'
import { requireUser, userCan, type CurrentUser } from '@/lib/session'
import { buildEventWhere, EVENT_ORDER, type Cursor, type EventFilters } from '@/modules/observability/eventQuery'

/** Settings → Activity log is for account admins and invoice managers. Null when refused. */
export async function requireActivityLogViewer(): Promise<CurrentUser | null> {
  const me = await requireUser()
  return userCan(me, 'edit_account_settings') || userCan(me, 'manage_invoices') ? me : null
}

/** Invoice-number search → invoice ids (null = no search). Capped; numbers are short strings. */
export async function invoiceIdsForQuery(accountId: string, q: string | null): Promise<string[] | null> {
  if (!q) return null
  const rows = await prisma.invoice.findMany({
    where: { accountId, number: { contains: q, mode: 'insensitive' } },
    select: { id: true },
    take: 500,
  })
  return rows.map((r) => r.id)
}

export async function invoiceNumbers(accountId: string, ids: Array<string | null>): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))]
  if (!unique.length) return new Map()
  const rows = await prisma.invoice.findMany({ where: { accountId, id: { in: unique } }, select: { id: true, number: true } })
  return new Map(rows.map((r) => [r.id, r.number]))
}

export const EVENT_SELECT = {
  id: true, occurredAt: true, stage: true, source: true, level: true, message: true, externalId: true,
  httpStatus: true, durationMs: true, detail: true, invoiceId: true, paymentId: true,
} as const

export async function findEvents(accountId: string, f: EventFilters, invoiceIds: string[] | null, cursor: Cursor | null, take: number) {
  return prisma.invoiceEvent.findMany({
    where: buildEventWhere(accountId, f, { invoiceIds, cursor }),
    orderBy: EVENT_ORDER,
    take,
    select: EVENT_SELECT,
  })
}
