import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { requireModule } from '@/lib/modules'
import { mayActForOnProject } from '@/lib/timesheetSubject'
import { ymd } from '@/lib/week'
import { EditExpenseForm } from '@/components/EditExpenseForm'
import { isUnitBased, unitsFromTotal } from '@/modules/expenses/expenses'

export const dynamic = 'force-dynamic'

export default async function EditExpensePage({ params }: { params: { id: string } }) {
  const current = await requireUser()
  const { accountId, userId } = current
  await requireModule(accountId, 'expenseTracking')

  const expense = await prisma.expense.findFirst({ where: { id: params.id, accountId } })
  if (!expense) notFound()
  const backHref = expense.userId === userId ? '/expenses' : `/expenses?user=${encodeURIComponent(expense.userId)}`
  // Same rule as the server action: owner, or someone who may act for the owner on this project; never once invoiced.
  if (expense.lockState === 'invoiced' || !(await mayActForOnProject(current, expense.userId, expense.projectId))) redirect(backHref)

  // Active projects/categories, plus the expense's current ones even if since archived (so the
  // picker shows the real value instead of silently swapping it).
  const [projects, categories] = await Promise.all([
    prisma.project.findMany({
      where: { accountId, OR: [{ isActive: true }, { id: expense.projectId }] },
      select: { id: true, name: true, code: true, client: { select: { name: true } } },
      orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
    }),
    prisma.expenseCategory.findMany({
      where: { accountId, OR: [{ isActive: true }, { id: expense.categoryId }] },
      select: { id: true, name: true, unitName: true, unitPriceCents: true },
      orderBy: { name: 'asc' },
    }),
  ])
  const cat = categories.find((c) => c.id === expense.categoryId)

  return (
    <div>
      <Link href={backHref} className="text-sm text-gray-500 hover:text-brand-teal">← Back to Expenses</Link>
      <h1 className="mb-4 mt-2 text-2xl font-semibold">Edit expense</h1>
      <EditExpenseForm
        backHref={backHref}
        expense={{
          id: expense.id,
          projectId: expense.projectId,
          categoryId: expense.categoryId,
          spentDate: ymd(expense.spentDate),
          amount: (expense.totalCents / 100).toFixed(2),
          units: cat && isUnitBased(cat) ? unitsFromTotal(expense.totalCents, cat.unitPriceCents) : '',
          markup: expense.markupPercent ? String(Number(expense.markupPercent)) : '',
          isBillable: expense.isBillable,
          notes: expense.notes ?? '',
          receiptFileUrl: expense.receiptFileUrl ?? '',
        }}
        projects={projects.map((p) => ({ id: p.id, label: p.code ? `[${p.code}] ${p.name}` : p.name, group: p.client.name, keywords: p.code ?? undefined }))}
        categories={categories.map((c) => ({ id: c.id, label: c.unitName ? `${c.name} (per ${c.unitName})` : c.name, unitName: c.unitName, unitPriceCents: c.unitPriceCents }))}
      />
    </div>
  )
}
