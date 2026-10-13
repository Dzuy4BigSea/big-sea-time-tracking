import { prisma } from '@/lib/prisma'
import { safeHttpUrl } from '@/modules/shared/safeUrl'
import { formatCents, formatDate } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { getAccountClock } from '@/lib/accountClock'
import { todayYmdIn } from '@/lib/tz'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { requireModule } from '@/lib/modules'
import { NewExpenseForm } from '@/components/NewExpenseForm'
import { NewCategoryForm } from '@/components/NewCategoryForm'
import { ConfirmSubmit } from '@/components/ConfirmSubmit'
import { deleteExpenseAction } from '@/app/expenses/actions'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function ExpensesPage() {
  const { accountId, userId, permissionProfile, permissionOverrides } = await requireUser()
  await requireModule(accountId, 'expenseTracking')
  const canManageSettings = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'edit_account_settings')
  const canOthers = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'view_edit_others_time')

  const [expenses, projects, categories, clock] = await Promise.all([
    prisma.expense.findMany({
      where: { accountId },
      include: {
        project: { select: { name: true, code: true } },
        category: { select: { name: true } },
        user: { select: { firstName: true, lastName: true } },
      },
      // userId + lockState drive per-row edit/delete permission below.
      orderBy: { spentDate: 'desc' },
    }),
    prisma.project.findMany({
      where: { accountId, isActive: true },
      select: { id: true, name: true, code: true, client: { select: { name: true } } },
      // Grouped by client in the picker (Harvest-style), so order client → project.
      orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
    }),
    prisma.expenseCategory.findMany({
      where: { accountId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    getAccountClock(accountId),
  ])

  const today = todayYmdIn(clock.timezone) // the account's calendar day, not the server's UTC day
  const projectOptions = projects.map((p) => ({ id: p.id, label: p.code ? `[${p.code}] ${p.name}` : p.name, group: p.client.name }))
  const categoryOptions = categories.map((c) => ({ id: c.id, label: c.name }))

  const withMarkup = (e: (typeof expenses)[number]) => {
    const pct = e.markupPercent ? Number(e.markupPercent) : 0
    return Math.round(e.totalCents * (1 + pct / 100))
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Expenses</h1>
      <p className="mb-6 text-sm text-gray-500">Live from Supabase · {expenses.length} expense{expenses.length === 1 ? '' : 's'}</p>

      <NewExpenseForm projects={projectOptions} categories={categoryOptions} today={today} />
      {canManageSettings && <NewCategoryForm />}

      {/* Fixed layout so every column fits at laptop widths (~1000px content); long text truncates with a
          title tooltip. overflow-x-auto + min-w only kick in as a fallback on very narrow screens. */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] table-fixed text-sm">
          <colgroup>
            <col className="w-[100px]" />
            <col />
            <col className="w-[15%]" />
            <col className="w-[13%]" />
            <col className="w-[64px]" />
            <col className="w-[104px]" />
            <col className="w-[112px]" />
            <col className="w-[92px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-3 py-3 font-medium">Date</th>
              <th className="px-3 py-3 font-medium">Project</th>
              <th className="px-3 py-3 font-medium">Category</th>
              <th className="px-3 py-3 font-medium">Person</th>
              <th className="px-2 py-3 text-center font-medium" title="Billable">Bill.</th>
              <th className="px-3 py-3 text-right font-medium">Amount</th>
              <th className="whitespace-nowrap px-3 py-3 text-right font-medium" title="Billed amount, including markup">Billed</th>
              <th className="px-3 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => {
              const editable = (e.userId === userId || canOthers) && e.lockState !== 'invoiced'
              const projectLabel = `${e.project.code ? `[${e.project.code}] ` : ''}${e.project.name}`
              const person = `${e.user.firstName} ${e.user.lastName}`
              return (
              <tr key={e.id} className="border-b border-gray-100 align-top last:border-0">
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-gray-600">{formatDate(e.spentDate)}</td>
                <td className="px-3 py-2.5">
                  <div className="truncate font-medium text-gray-900" title={projectLabel}>{projectLabel}</div>
                  {e.notes && <div className="truncate text-xs text-gray-400" title={e.notes}>{e.notes}</div>}
                </td>
                <td className="px-3 py-2.5 text-gray-600">
                  <div className="truncate" title={e.category.name}>{e.category.name}</div>
                </td>
                <td className="px-3 py-2.5 text-gray-600">
                  <div className="truncate" title={person}>{person}</div>
                </td>
                <td className="px-2 py-2.5 text-center">
                  {e.isBillable ? (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-xs font-semibold text-green-700" title="Billable">
                      ✓<span className="sr-only">Billable</span>
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300" title="Non-billable">—<span className="sr-only">Non-billable</span></span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-gray-700">{formatCents(e.totalCents)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                  {e.isBillable ? formatCents(withMarkup(e)) : '—'}
                  {e.markupPercent ? <div className="text-xs text-gray-400">+{Number(e.markupPercent)}% markup</div> : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2 text-xs">
                    {safeHttpUrl(e.receiptFileUrl) && (
                      <a href={safeHttpUrl(e.receiptFileUrl)!} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-brand-teal" title="View receipt">📎</a>
                    )}
                    {e.lockState === 'invoiced' ? (
                      <span className="text-gray-300" title="Invoiced — locked">🔒</span>
                    ) : editable ? (
                      <>
                        <Link href={`/expenses/${e.id}/edit`} className="text-gray-500 hover:text-brand-teal">Edit</Link>
                        <form action={deleteExpenseAction}>
                          <input type="hidden" name="id" value={e.id} />
                          <ConfirmSubmit message="Delete this expense?" className="text-gray-400 hover:text-red-600">✕</ConfirmSubmit>
                        </form>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
              )
            })}
            {expenses.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  No expenses yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
