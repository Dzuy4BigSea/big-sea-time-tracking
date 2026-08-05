import { prisma } from '@/lib/prisma'
import { formatCents, formatDate } from '@/lib/format'
import { requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function ExpensesPage() {
  const { accountId } = await requireUser()
  const expenses = await prisma.expense.findMany({
    where: { accountId },
    include: {
      project: { select: { name: true, code: true } },
      category: { select: { name: true } },
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: { spentDate: 'desc' },
  })

  const withMarkup = (e: (typeof expenses)[number]) => {
    const pct = e.markupPercent ? Number(e.markupPercent) : 0
    return Math.round(e.totalCents * (1 + pct / 100))
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Expenses</h1>
      <p className="mb-6 text-sm text-gray-500">Live from Supabase · {expenses.length} expense{expenses.length === 1 ? '' : 's'}</p>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Person</th>
              <th className="px-4 py-3 font-medium">Billable</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 text-right font-medium">Billed (w/ markup)</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 text-gray-600">{formatDate(e.spentDate)}</td>
                <td className="px-4 py-3">
                  <span className="font-medium text-gray-900">
                    {e.project.code ? `[${e.project.code}] ` : ''}
                    {e.project.name}
                  </span>
                  {e.notes && <div className="text-xs text-gray-400">{e.notes}</div>}
                </td>
                <td className="px-4 py-3 text-gray-600">{e.category.name}</td>
                <td className="px-4 py-3 text-gray-600">
                  {e.user.firstName} {e.user.lastName}
                </td>
                <td className="px-4 py-3">
                  {e.isBillable ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Billable</span>
                  ) : (
                    <span className="text-xs text-gray-400">no</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatCents(e.totalCents)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {e.isBillable ? formatCents(withMarkup(e)) : '—'}
                  {e.markupPercent ? <span className="ml-1 text-xs text-gray-400">+{Number(e.markupPercent)}%</span> : null}
                </td>
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
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
