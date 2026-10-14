import Link from 'next/link'
import { requireUser } from '@/lib/session'
import { accountWeekStartsOn } from '@/lib/accountPrefs'
import { formatCents } from '@/lib/format'
import { safeHttpUrl } from '@/modules/shared/safeUrl'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { buildHref } from '@/modules/shared/timeframe'
import { parseDetailed, detailedQuery, detailedTimeframe, rangeOptions, type DetailedParams } from '@/modules/reports/detailed'
import { detailedExpenses, detailedPickers, DETAILED_ROW_LIMIT, type DetailedExpenseRow } from '@/modules/reports/detailedSql'
import { savedReportContext } from '@/modules/reports/savedReportContext'
import { DetailedReportFilters } from '@/components/DetailedReportFilters'
import { DetailedToolbar, DetailedSummary, usDate, rangeTitle, toolbarKeep, filterNames } from '@/components/DetailedReportParts'
import { SaveReportControls } from '@/components/SaveReportControls'

export const dynamic = 'force-dynamic'

const PATH = '/reports/detailed/expenses'

/** Detailed expense report (Harvest: New report → Detailed expense). specs/25. */
export default async function DetailedExpensePage({ searchParams }: { searchParams: DetailedParams & { saved?: string; edit?: string } }) {
  const me = await requireUser()
  const canRunAll = can({ permissionProfile: me.permissionProfile as PermissionProfile, permissionOverrides: me.permissionOverrides }, 'run_account_reports')
  const scope = { accountId: me.accountId, onlyUserId: canRunAll ? null : me.userId }

  const f = parseDetailed('expense', searchParams)
  const tf = detailedTimeframe(f, { weekStartsOn: await accountWeekStartsOn(me.accountId) })
  const query = detailedQuery(f)
  const savedId = typeof searchParams.saved === 'string' ? searchParams.saved : undefined
  const editing = searchParams.edit === '1'

  const [data, pickers, saved] = await Promise.all([
    detailedExpenses(f, tf, scope),
    detailedPickers(me.accountId, 'expense', scope.onlyUserId),
    savedReportContext(me, savedId, 'detailed_expense', query),
  ])
  const href = (q: Record<string, string | null>) => buildHref(PATH, { ...query, saved: savedId ?? null, ...q })
  const groupTotal = new Map(data.groups.map((g) => [g.key, g]))
  const showDate = f.group !== 'date'

  return (
    <div>
      <Link href="/reports" className="text-sm text-gray-600 hover:text-brand-teal">← Back to Reports</Link>
      <div className="mb-5 mt-3 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
        <h1 className="text-2xl font-semibold text-gray-900">Detailed expense report: {rangeTitle(tf)}</h1>
        <div className="flex items-center gap-2">
          <SaveReportControls kind="detailed_expense" params={query} saved={saved} />
          {!editing && (
            <Link href={href({ edit: '1' })} scroll={false} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 shadow-sm hover:bg-gray-50">
              Show filters
            </Link>
          )}
        </div>
      </div>

      {editing && (
        <DetailedReportFilters
          path={PATH}
          itemsName="categories"
          itemsLabel="Categories"
          itemsPlaceholder="All categories"
          rangeOptions={rangeOptions()}
          range={f.range}
          from={f.from}
          to={f.to}
          archived={f.archived}
          selected={{ clients: f.clients, projects: f.projects, items: f.items, users: f.users }}
          options={pickers}
          keep={toolbarKeep(query, savedId)}
          submitLabel={Object.keys(query).length || savedId ? 'Update report' : 'Run report'}
          cancelHref={href({})}
        />
      )}

      <DetailedSummary
        left={
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <div className="text-sm text-gray-600">Total amount</div>
              <div className="mt-1 whitespace-nowrap text-3xl font-semibold tabular-nums text-gray-900">{formatCents(data.totalCents)}</div>
              <div className="mt-1 text-xs text-gray-500">{data.count.toLocaleString()} expenses</div>
            </div>
            <div>
              <div className="text-sm text-gray-600">Billable</div>
              <div className="mt-1 whitespace-nowrap text-xl font-semibold tabular-nums text-gray-900">{formatCents(data.billableCents)}</div>
            </div>
            <div>
              <div className="text-sm text-gray-600">Uninvoiced</div>
              <div className="mt-1 whitespace-nowrap text-xl font-semibold tabular-nums text-brand-green">{formatCents(data.uninvoicedCents)}</div>
            </div>
          </div>
        }
        filters={[
          ['Clients', filterNames(f.clients, pickers.clients, 'All clients')],
          ['Projects', filterNames(f.projects, pickers.projects, 'All projects')],
          ['Categories', filterNames(f.items, pickers.items, 'All categories')],
          ['Team', scope.onlyUserId ? 'Only you' : filterNames(f.users, pickers.users, 'Everyone')],
        ]}
      />

      <DetailedToolbar kind="expense" f={f} href={href} exportHref={buildHref(`${PATH}/export`, query)} />

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              {showDate && <th className="px-4 py-3 font-medium">Date</th>}
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Person</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => {
              const header = i === 0 || data.rows[i - 1].groupKey !== r.groupKey
              const g = groupTotal.get(r.groupKey)
              return [
                header && (
                  <tr key={`g-${r.groupKey}`} className="border-b border-gray-200 bg-gray-50 text-gray-700">
                    <td colSpan={showDate ? 5 : 4} className="px-4 py-2 font-semibold">{g?.label ?? r.groupKey}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatCents(g?.total ?? 0)}</td>
                  </tr>
                ),
                <ExpenseRow key={r.id} r={r} showDate={showDate} />,
              ]
            })}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">No expenses match these filters.</td>
              </tr>
            )}
          </tbody>
          {data.rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 font-semibold">
                <td colSpan={showDate ? 5 : 4} className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCents(data.totalCents)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {data.count > data.rows.length && (
        <p className="mt-3 text-sm text-gray-500">
          Showing the first {DETAILED_ROW_LIMIT.toLocaleString()} of {data.count.toLocaleString()} expenses (totals include all of them).{' '}
          <a href={buildHref(`${PATH}/export`, query)} className="text-brand-teal hover:underline">Export CSV</a> for the full list, or narrow the filters.
        </p>
      )}
    </div>
  )
}

function ExpenseRow({ r, showDate }: { r: DetailedExpenseRow; showDate: boolean }) {
  return (
    <tr className="border-b border-gray-100 align-top last:border-0">
      {showDate && <td className="px-4 py-2.5 tabular-nums text-gray-600">{usDate(r.spentDate)}</td>}
      <td className="px-4 py-2.5 text-gray-900">
        <Link href={`/clients/${r.clientId}`} className="hover:text-brand-teal">{r.clientName}</Link>
      </td>
      <td className="px-4 py-2.5 text-gray-900">
        <Link href={`/projects/${r.projectId}`} className="hover:text-brand-teal">{r.projectCode ? `[${r.projectCode}] ${r.projectName}` : r.projectName}</Link>
        {r.notes && <div className="mt-1 whitespace-pre-line text-xs text-gray-500">{r.notes}</div>}
      </td>
      <td className="px-4 py-2.5 text-gray-800">{r.categoryName}</td>
      <td className="px-4 py-2.5 text-gray-800">
        <Link href={`/team/${r.userId}`} className="hover:text-brand-teal">{r.userName}</Link>
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
        {/* Harvest: a paper clip next to the amount opens the attached receipt. */}
        {safeHttpUrl(r.receiptFileUrl) && (
          <a href={safeHttpUrl(r.receiptFileUrl)!} target="_blank" rel="noopener noreferrer" className="mr-1.5 text-gray-500 hover:text-brand-teal" title="View receipt">
            📎<span className="sr-only">View receipt</span>
          </a>
        )}
        {formatCents(r.totalCents)}
        {!r.isBillable && <div className="text-[11px] text-gray-400">Non-billable</div>}
        {r.invoiced && <div className="text-[11px] text-gray-400">Invoiced</div>}
      </td>
    </tr>
  )
}
