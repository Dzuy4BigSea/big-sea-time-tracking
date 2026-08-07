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

  const [expense, projects, categories] = await Promise.all([
    prisma.expense.findFirst({ where: { id: params.id, accountId } }),
    prisma.project.findMany({ where: { accountId, isActive: true }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    prisma.expenseCategory.findMany({ where: { accountId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])
  if (!expense) notFound()

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
        projects={projects.map((p) => ({ id: p.id, label: p.code ? `[${p.code}] ${p.name}` : p.name }))}
        categories={categories.map((c) => ({ id: c.id, label: c.name }))}
      />
    </div>
  )
}
