import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { toCsv, csvResponse } from '@/lib/csv'

export const dynamic = 'force-dynamic'

const HOURS_BUDGETS = new Set(['hours_total', 'hours_per_task', 'hours_per_person'])

/** All projects with budget / spent-hours / expense-costs → CSV (Projects → Export). */
export async function GET() {
  const { accountId } = await requireUser()
  const projects = await prisma.project.findMany({
    where: { accountId },
    select: { id: true, name: true, code: true, projectType: true, isActive: true, budgetMethod: true, budgetValue: true, projectFeesCents: true, client: { select: { name: true } } },
    orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
  })
  const ids = projects.map((p) => p.id)
  const [spent, cost] = await Promise.all([
    prisma.timeEntry.groupBy({ by: ['projectId'], where: { accountId, projectId: { in: ids } }, _sum: { minutes: true } }),
    prisma.expense.groupBy({ by: ['projectId'], where: { accountId, projectId: { in: ids } }, _sum: { totalCents: true } }),
  ])
  const spentBy = new Map(spent.map((r) => [r.projectId, r._sum.minutes ?? 0]))
  const costBy = new Map(cost.map((r) => [r.projectId, r._sum.totalCents ?? 0]))

  const rows = projects.map((p) => {
    const spentMin = spentBy.get(p.id) ?? 0
    const isHours = HOURS_BUDGETS.has(p.budgetMethod) && p.budgetValue
    const budgetHours = isHours ? (p.budgetValue! / 60).toFixed(2) : ''
    const budgetFee = !isHours && (p.budgetMethod === 'fee_total' ? p.budgetValue : p.projectFeesCents) ? (((p.budgetMethod === 'fee_total' ? p.budgetValue! : p.projectFeesCents!)) / 100).toFixed(2) : ''
    return [
      p.client.name,
      p.code ? `[${p.code}] ${p.name}` : p.name,
      p.projectType,
      p.isActive ? 'active' : 'archived',
      budgetHours,
      budgetFee,
      (spentMin / 60).toFixed(2),
      ((costBy.get(p.id) ?? 0) / 100).toFixed(2),
    ]
  })
  const csv = toCsv(['Client', 'Project', 'Type', 'Status', 'Budget hours', 'Budget fee', 'Spent hours', 'Expense costs'], rows)
  return csvResponse('projects.csv', csv)
}
