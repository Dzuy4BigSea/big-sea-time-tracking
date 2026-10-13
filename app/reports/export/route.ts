import { accountWeekStartsOn } from '@/lib/accountPrefs'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { csvStreamResponse, EXPORT_BATCH } from '@/lib/csvStream'
import { resolveTimeframe, type TimeframeParams } from '@/modules/shared/timeframe'
import { isUninvoiced } from '@/modules/invoicing/uninvoiced'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // all-time exports stream ~200 batches

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const hrs = (m: number) => (m / 60).toFixed(2)

/**
 * Detailed time-entry export (Reports → Export CSV). Account-scoped; reports permission required.
 * Streams: keyset pagination on (spentDate, id) in batches of EXPORT_BATCH, so "All time" (388k rows)
 * never loads the whole table into memory.
 */
export async function GET(req: Request) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'run_account_reports')) {
    return new Response('Forbidden', { status: 403 })
  }
  // Same timeframe params as the report screen (the Export link carries them); none = all time.
  const sp = new URL(req.url).searchParams
  const tf = resolveTimeframe(Object.fromEntries(['period', 'anchor', 'from', 'to'].map((k) => [k, sp.get(k) ?? undefined])) as TimeframeParams, {
    weekStartsOn: await accountWeekStartsOn(accountId),
  })
  const spentDate = tf.from || tf.till ? { ...(tf.from ? { gte: tf.from } : {}), ...(tf.till ? { lte: tf.till } : {}) } : undefined

  const baseWhere = { accountId, isRunning: false, ...(spentDate ? { spentDate } : {}) }
  const select = {
    id: true,
    spentDate: true,
    minutes: true,
    notes: true,
    isBillable: true,
    billableRateCents: true,
    invoiceLineItemId: true,
    lockState: true,
    user: { select: { firstName: true, lastName: true } },
    task: { select: { name: true } },
    project: { select: { name: true, code: true, client: { select: { name: true, currency: true } } } },
  } as const

  const toRow = (e: Awaited<ReturnType<typeof fetchBatch>>[number]) => {
    const amountCents = e.isBillable && e.billableRateCents ? Math.round((e.minutes / 60) * e.billableRateCents) : 0
    const status = !e.isBillable
      ? 'non-billable'
      : isUninvoiced({ isBillable: e.isBillable, invoiceLineItemId: e.invoiceLineItemId, lockState: e.lockState })
        ? 'uninvoiced'
        : e.lockState
    return [
      ymd(e.spentDate),
      e.project.client.name,
      e.project.code ? `[${e.project.code}] ${e.project.name}` : e.project.name,
      e.task.name,
      `${e.user.firstName} ${e.user.lastName}`.trim(),
      e.notes ?? '',
      hrs(e.minutes),
      e.isBillable ? 'yes' : 'no',
      e.billableRateCents != null ? (e.billableRateCents / 100).toFixed(2) : '',
      amountCents ? (amountCents / 100).toFixed(2) : '',
      e.project.client.currency,
      status,
    ]
  }

  async function fetchBatch(after: { spentDate: Date; id: string } | null) {
    return prisma.timeEntry.findMany({
      where: after
        ? { AND: [baseWhere, { OR: [{ spentDate: { gt: after.spentDate } }, { spentDate: after.spentDate, id: { gt: after.id } }] }] }
        : baseWhere,
      select,
      orderBy: [{ spentDate: 'asc' }, { id: 'asc' }],
      take: EXPORT_BATCH,
    })
  }

  async function* batches() {
    let after: { spentDate: Date; id: string } | null = null
    for (;;) {
      const page = await fetchBatch(after)
      if (!page.length) return
      yield page.map(toRow)
      if (page.length < EXPORT_BATCH) return
      const last = page[page.length - 1]
      after = { spentDate: last.spentDate, id: last.id }
    }
  }

  return csvStreamResponse(
    'time-report.csv',
    ['Date', 'Client', 'Project', 'Task', 'Person', 'Notes', 'Hours', 'Billable', 'Rate', 'Amount', 'Currency', 'Status'],
    batches,
  )
}
