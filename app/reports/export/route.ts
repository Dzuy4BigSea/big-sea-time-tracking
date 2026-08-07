import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { toCsv, csvResponse } from '@/lib/csv'
import { isUninvoiced } from '@/modules/invoicing/uninvoiced'

export const dynamic = 'force-dynamic'

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const hrs = (m: number) => (m / 60).toFixed(2)

/** Detailed time-entry export (Reports → Export CSV). Account-scoped; reports permission required. */
export async function GET() {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'run_account_reports')) {
    return new Response('Forbidden', { status: 403 })
  }

  const entries = await prisma.timeEntry.findMany({
    where: { accountId, isRunning: false },
    select: {
      spentDate: true,
      minutes: true,
      notes: true,
      isBillable: true,
      billableRateCents: true,
      invoiceLineItemId: true,
      lockState: true,
      user: { select: { firstName: true, lastName: true } },
      task: { select: { name: true } },
      project: { select: { name: true, code: true, client: { select: { name: true } } } },
    },
    orderBy: [{ spentDate: 'asc' }],
  })

  const rows = entries.map((e) => {
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
      status,
    ]
  })

  const csv = toCsv(
    ['Date', 'Client', 'Project', 'Task', 'Person', 'Notes', 'Hours', 'Billable', 'Rate', 'Amount', 'Status'],
    rows,
  )
  return csvResponse('time-report.csv', csv)
}
