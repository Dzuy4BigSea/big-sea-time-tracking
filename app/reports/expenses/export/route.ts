import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { toCsv, csvResponse } from '@/lib/csv'

export const dynamic = 'force-dynamic'

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const billed = (c: number, m: unknown) => Math.round(c * (1 + (m ? Number(m) : 0) / 100))

/** Detailed expense export (Reports → Expenses → Export CSV). */
export async function GET() {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'run_account_reports')) {
    return new Response('Forbidden', { status: 403 })
  }
  const expenses = await prisma.expense.findMany({
    where: { accountId },
    orderBy: { spentDate: 'asc' },
    select: {
      spentDate: true, totalCents: true, markupPercent: true, isBillable: true, notes: true,
      category: { select: { name: true } },
      user: { select: { firstName: true, lastName: true } },
      project: { select: { name: true, code: true, client: { select: { name: true, currency: true } } } },
    },
  })
  const rows = expenses.map((e) => [
    ymd(e.spentDate),
    e.project.client.name,
    e.project.code ? `[${e.project.code}] ${e.project.name}` : e.project.name,
    e.category.name,
    `${e.user.firstName} ${e.user.lastName}`.trim(),
    e.notes ?? '',
    (e.totalCents / 100).toFixed(2),
    e.markupPercent ? String(Number(e.markupPercent)) : '',
    e.isBillable ? (billed(e.totalCents, e.markupPercent) / 100).toFixed(2) : '',
    e.project.client.currency,
    e.isBillable ? 'yes' : 'no',
  ])
  const csv = toCsv(['Date', 'Client', 'Project', 'Category', 'Person', 'Notes', 'Cost', 'Markup %', 'Billed', 'Currency', 'Billable'], rows)
  return csvResponse('expenses-report.csv', csv)
}
