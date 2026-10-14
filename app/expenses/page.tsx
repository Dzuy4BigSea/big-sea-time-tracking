import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { safeHttpUrl } from '@/modules/shared/safeUrl'
import { formatCents } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { getAccountClock } from '@/lib/accountClock'
import { todayYmdIn } from '@/lib/tz'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { requireModule } from '@/lib/modules'
import { listActablePeople, loggableProjectsFor, managedProjectIdsFor, resolveSubjectUserId } from '@/lib/timesheetSubject'
import { NewExpenseForm } from '@/components/NewExpenseForm'
import { NewCategoryForm } from '@/components/NewCategoryForm'
import { ConfirmSubmit } from '@/components/ConfirmSubmit'
import { TimesheetPersonSwitcher } from '@/components/TimesheetPersonSwitcher'
import { deleteExpenseAction } from '@/app/expenses/actions'
import { formatWeekRange, parseYmd, ymd, weekdayShort, dayMonth } from '@/lib/week'
import { buildHref } from '@/modules/shared/timeframe'
import { billedCents, defaultBillableFor, groupByWeek, pageLowerBound, EXPENSE_PAGE_SIZE } from '@/modules/expenses/expenses'

export const dynamic = 'force-dynamic'

/**
 * Expenses (Harvest: Timesheets → Expenses; specs/26 §10). One person's expenses — your own, or a
 * teammate's via the Teammates switcher (`?user=`, re-authorized server-side) — grouped by week, newest
 * first, paged on whole weeks (`?before=` = exclusive upper bound, a week start).
 */
export default async function ExpensesPage({ searchParams }: { searchParams: { user?: string; before?: string } }) {
  const current = await requireUser()
  const { accountId, permissionProfile, permissionOverrides } = current
  const [, subjectId, clock] = await Promise.all([
    requireModule(accountId, 'expenseTracking'),
    resolveSubjectUserId(current, searchParams.user),
    getAccountClock(accountId),
  ])
  const userId = subjectId ?? current.userId
  const isSelf = userId === current.userId
  const weekStartsOn = clock.weekStartsOn
  const before = parseYmd(searchParams.before)
  const canManageSettings = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'edit_account_settings')

  // Bounded to one person (and, after the probe, to whole weeks of one page): never the full table.
  const scope = { accountId, userId, ...(before ? { spentDate: { lt: before } } : {}) }
  const [subject, people, probe, loggable, managed, categories] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, type: true } }),
    listActablePeople(current),
    prisma.expense.findMany({
      where: scope,
      select: { spentDate: true },
      orderBy: [{ spentDate: 'desc' }, { createdAt: 'desc' }],
      take: EXPENSE_PAGE_SIZE + 1,
    }),
    loggableProjectsFor(userId),
    isSelf ? Promise.resolve(null) : managedProjectIdsFor(current),
    prisma.expenseCategory.findMany({
      where: { accountId, isActive: true },
      select: { id: true, name: true, unitName: true, unitPriceCents: true },
      orderBy: { name: 'asc' },
    }),
  ])
  const lower = pageLowerBound(probe, EXPENSE_PAGE_SIZE, weekStartsOn)

  const pickable = loggable.filter((p) => managed === null || managed.has(p.id))
  const [expenses, billing] = await Promise.all([
    probe.length === 0
      ? Promise.resolve([])
      : prisma.expense.findMany({
          where: { accountId, userId, spentDate: { ...(before ? { lt: before } : {}), ...(lower ? { gte: lower } : {}) } },
          include: {
            project: { select: { name: true, code: true, client: { select: { name: true } } } },
            category: { select: { name: true, unitName: true, unitPriceCents: true } },
          },
          orderBy: [{ spentDate: 'desc' }, { createdAt: 'desc' }],
        }),
    // Billable default per project (Harvest: non-billable project → non-billable expense).
    pickable.length
      ? prisma.project.findMany({ where: { accountId, id: { in: pickable.map((p) => p.id) } }, select: { id: true, isBillable: true, projectType: true } })
      : Promise.resolve([]),
  ])
  const billableById = new Map(billing.map((p) => [p.id, defaultBillableFor(p)]))
  const weeks = groupByWeek(expenses, weekStartsOn)

  const userName = subject ? `${subject.firstName} ${subject.lastName}`.trim() : userId
  if (people.length > 0 && !people.some((p) => p.id === userId)) people.push({ id: userId, name: userName, type: subject?.type ?? 'employee' })
  const userParam = isSelf ? null : userId
  const olderHref = lower ? buildHref('/expenses', { user: userParam, before: ymd(lower) }) : null
  const latestHref = buildHref('/expenses', { user: userParam })

  const today = todayYmdIn(clock.timezone) // the account's calendar day, not the server's UTC day
  const projectOptions = pickable.map((p) => ({
    id: p.id,
    label: p.code ? `[${p.code}] ${p.name}` : p.name,
    group: p.clientName,
    keywords: p.code ?? undefined,
    billable: billableById.get(p.id) ?? true,
  }))
  const categoryOptions = categories.map((c) => ({
    id: c.id,
    label: c.unitName ? `${c.name} (per ${c.unitName})` : c.name,
    unitName: c.unitName,
    unitPriceCents: c.unitPriceCents,
  }))
  const editable = (e: (typeof expenses)[number]) => e.lockState !== 'invoiced' && (managed === null || managed.has(e.projectId))
  const editHref = (id: string) => `/expenses/${id}/edit`

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{isSelf ? 'Expenses' : `${userName}’s expenses`}</h1>
          {!isSelf && (
            <p role="status" className="mt-1 text-sm text-amber-800">
              Changes will save to {userName}’s expenses.{' '}
              <Link href="/expenses" className="font-medium text-blue-600 underline hover:no-underline">
                Resume editing your own expenses
              </Link>
            </p>
          )}
        </div>
        {people.length > 1 && <TimesheetPersonSwitcher people={people} selectedId={userId} selfId={current.userId} query="" basePath="/expenses" />}
      </div>

      <NewExpenseForm projects={projectOptions} categories={categoryOptions} today={today} forUserId={isSelf ? undefined : userId} />
      {canManageSettings && <NewCategoryForm />}

      {before && (
        <p className="mb-3 text-sm">
          <Link href={latestHref} className="text-blue-600 hover:underline">← Back to latest expenses</Link>
        </p>
      )}

      {/* Fixed layout so every column fits at laptop widths (BugHerd #15); long text truncates with a title tooltip. */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[760px] table-fixed text-sm">
          <colgroup>
            <col className="w-[96px]" />
            <col />
            <col className="w-[18%]" />
            <col className="w-[64px]" />
            <col className="w-[112px]" />
            <col className="w-[112px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-3 py-3 font-medium">Date</th>
              <th className="px-3 py-3 font-medium">Project</th>
              <th className="px-3 py-3 font-medium">Category</th>
              <th className="px-2 py-3 text-center font-medium" title="Billable">Bill.</th>
              <th className="px-3 py-3 text-right font-medium">Amount</th>
              <th className="px-3 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          {weeks.map((w) => (
            <tbody key={w.weekStart.toISOString()}>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th colSpan={4} scope="rowgroup" className="px-3 py-2 text-left text-sm font-semibold text-gray-700">
                  {formatWeekRange(w.weekStart, w.weekEnd)}
                </th>
                <td className="whitespace-nowrap px-3 py-2 text-right text-sm font-semibold tabular-nums text-gray-800">{formatCents(w.totalCents)}</td>
                <td />
              </tr>
              {w.rows.map((e) => {
                const projectLabel = `${e.project.code ? `[${e.project.code}] ` : ''}${e.project.name}`
                const receipt = safeHttpUrl(e.receiptFileUrl)
                const unitPrice = e.category.unitPriceCents
                return (
                  <tr key={e.id} className="border-b border-gray-100 align-top last:border-0">
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-gray-600">
                      {weekdayShort(e.spentDate)} {dayMonth(e.spentDate)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="truncate text-gray-900" title={`${projectLabel} (${e.project.client.name})`}>
                        <span className="font-medium">{projectLabel}</span> <span className="text-gray-500">({e.project.client.name})</span>
                      </div>
                      {e.notes && <div className="truncate text-xs text-gray-500" title={e.notes}>{e.notes}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">
                      <div className="truncate" title={e.category.name}>{e.category.name}</div>
                      {unitPrice && e.category.unitName ? (
                        <div className="truncate text-xs text-gray-400">
                          {(e.totalCents / unitPrice).toFixed(2).replace(/\.?0+$/, '')} {e.category.unitName} × {formatCents(unitPrice)}
                        </div>
                      ) : null}
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
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-gray-800">
                      {formatCents(e.totalCents)}
                      {e.isBillable && e.markupPercent ? (
                        <div className="text-xs text-gray-400" title="Billed amount, including markup">
                          {formatCents(billedCents(e.totalCents, Number(e.markupPercent)))} (+{Number(e.markupPercent)}%)
                        </div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2 text-xs">
                        {receipt && (
                          <a href={receipt} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-brand-teal" title="View receipt">📎</a>
                        )}
                        {e.lockState === 'invoiced' ? (
                          <span className="text-gray-400" title="Invoiced — locked">🔒</span>
                        ) : editable(e) ? (
                          <>
                            <Link href={editHref(e.id)} className="rounded border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-50">Edit</Link>
                            <form action={deleteExpenseAction}>
                              <input type="hidden" name="id" value={e.id} />
                              <ConfirmSubmit message="Delete this expense?" className="text-gray-400 hover:text-red-600">✕<span className="sr-only">Delete</span></ConfirmSubmit>
                            </form>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          ))}
          {weeks.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  {before ? 'No older expenses.' : isSelf ? 'You haven’t tracked any expenses yet.' : `${userName} hasn’t tracked any expenses yet.`}
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
      {olderHref && (
        <p className="mt-3 text-right text-sm">
          <Link href={olderHref} className="text-blue-600 hover:underline">Older expenses →</Link>
        </p>
      )}
    </div>
  )
}
