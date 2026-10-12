import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { requireModule } from '@/lib/modules'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { ymd } from '@/lib/week'
import { EditExpenseForm } from '@/components/EditExpenseForm'

export const dynamic = 'force-dynamic'

export default async function EditExpensePage({ params }: { params: { id: string } }) {
  const { accountId, userId, permissionProfile, permissionOverrides } = await requireUser()
  await requireModule(accountId, 'expenseTracking')

  const expense = await prisma.expense.findFirst({ where: { id: params.id, accountId } })
  if (!expense) notFound()
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
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const canOthers = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'view_edit_others_time')
  if ((expense.userId !== userId && !canOthers) || expense.lockState === 'invoiced') redirect('/expenses')

  return (
    <div>
      <Link href="/expenses" className="text-sm text-gray-500 hover:text-brand-teal">← Back to Expenses</Link>
      <h1 className="mb-4 mt-2 text-2xl font-semibold">Edit expense</h1>
      <EditExpenseForm
        expense={{
          id: expense.id,
          projectId: expense.projectId,
          categoryId: expense.categoryId,
          spentDate: ymd(expense.spentDate),
          amount: (expense.totalCents / 100).toFixed(2),
          markup: expense.markupPercent ? String(Number(expense.markupPercent)) : '',
          isBillable: expense.isBillable,
          notes: expense.notes ?? '',
          receiptFileUrl: expense.receiptFileUrl ?? '',
        }}
        projects={projects.map((p) => ({ id: p.id, label: p.code ? `[${p.code}] ${p.name}` : p.name, group: p.client.name }))}
        categories={categories.map((c) => ({ id: c.id, label: c.name }))}
      />
    </div>
  )
}
