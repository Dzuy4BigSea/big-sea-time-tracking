import Link from 'next/link'
import { requireUser } from '@/lib/session'
import { accountWeekStartsOn } from '@/lib/accountPrefs'
import { formatCents } from '@/lib/format'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { buildHref } from '@/modules/shared/timeframe'
import { formatHours as hrs } from '@/modules/reports/timeReport'
import { parseDetailed, detailedQuery, detailedTimeframe, rangeOptions, type DetailedParams } from '@/modules/reports/detailed'
import { detailedTime, detailedPickers, DETAILED_ROW_LIMIT, type DetailedTimeRow } from '@/modules/reports/detailedSql'
import { savedReportContext } from '@/modules/reports/savedReportContext'
import { DetailedReportFilters } from '@/components/DetailedReportFilters'
import { ExportMenu } from '@/components/ExportMenu'
import { DetailedToolbar, DetailedSummary, usDate, rangeTitle, toolbarKeep, filterNames as names } from '@/components/DetailedReportParts'
import { SaveReportControls } from '@/components/SaveReportControls'

export const dynamic = 'force-dynamic'

const PATH = '/reports/detailed'

/** Detailed time report (Harvest: New report → Detailed time). specs/25. */
export default async function DetailedTimePage({ searchParams }: { searchParams: DetailedParams & { saved?: string; edit?: string } }) {
  const me = await requireUser()
  const canRunAll = can({ permissionProfile: me.permissionProfile as PermissionProfile, permissionOverrides: me.permissionOverrides }, 'run_account_reports')
  const scope = { accountId: me.accountId, onlyUserId: canRunAll ? null : me.userId }

  const f = parseDetailed('time', searchParams)
  const tf = detailedTimeframe(f, { weekStartsOn: await accountWeekStartsOn(me.accountId) })
  const query = detailedQuery(f)
  const savedId = typeof searchParams.saved === 'string' ? searchParams.saved : undefined
  const editing = searchParams.edit === '1'

  const [data, pickers, saved] = await Promise.all([
    detailedTime(f, tf, scope),
    detailedPickers(me.accountId, 'time', scope.onlyUserId),
    savedReportContext(me, savedId, 'detailed_time', query),
  ])
  const href = (q: Record<string, string | null>) => buildHref(PATH, { ...query, saved: savedId ?? null, ...q })
  const groupTotal = new Map(data.groups.map((g) => [g.key, g]))
  const showDate = f.group !== 'date'

  return (
    <div>
      <Link href={buildHref('/reports', {})} className="text-sm text-gray-600 hover:text-brand-teal">← Back to Reports</Link>
      <div className="mb-5 mt-3 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
        <h1 className="text-2xl font-semibold text-gray-900">Detailed time report: {rangeTitle(tf)}</h1>
        <div className="flex items-center gap-2">
          <SaveReportControls kind="detailed_time" params={query} saved={saved} />
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
          itemsName="tasks"
          itemsLabel="Tasks"
          itemsPlaceholder="All tasks"
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
          <>
            <div className="text-sm text-gray-600">Total hours</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-gray-900">{hrs(data.totalMinutes)}</div>
            <div className="mt-1 text-sm text-gray-600">
              <span className="font-semibold tabular-nums text-gray-900">{hrs(data.uninvoicedBillableMinutes)}</span> Uninvoiced billable hours
            </div>
          </>
        }
        filters={[
          ['Clients', names(f.clients, pickers.clients, 'All clients')],
          ['Projects', names(f.projects, pickers.projects, 'All projects')],
          ['Tasks', names(f.items, pickers.items, 'All tasks')],
          ['Team', scope.onlyUserId ? 'Only you' : names(f.users, pickers.users, 'Everyone')],
        ]}
      />

      <DetailedToolbar
        kind="time"
        f={f}
        href={href}
        exportHref={buildHref(`${PATH}/export`, query)}
        exportMenu={
          <ExportMenu
            csvHref={buildHref(`${PATH}/export`, query)}
            summaryClassName="cursor-pointer list-none rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-800 shadow-sm hover:bg-gray-50"
          />
        }
      />

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              {showDate && <th className="px-4 py-3 font-medium">Date</th>}
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 font-medium">Task</th>
              <th className="px-4 py-3 font-medium">Roles</th>
              <th className="px-4 py-3 font-medium">Person</th>
              <th className="px-4 py-3 text-right font-medium">Hours</th>
              <th className="px-4 py-3 text-right font-medium">Billable amount</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => {
              const header = i === 0 || data.rows[i - 1].groupKey !== r.groupKey
              const g = groupTotal.get(r.groupKey)
              return [
                header && (
                  <tr key={`g-${r.groupKey}`} className="border-b border-gray-200 bg-gray-50 text-gray-700">
                    <td colSpan={showDate ? 6 : 5} className="px-4 py-2 font-semibold">{g?.label ?? r.groupKey}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{hrs(g?.total ?? 0)}</td>
                    <td />
                  </tr>
                ),
                <TimeRow key={r.id} r={r} showDate={showDate} />,
              ]
            })}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-400">No time entries match these filters.</td>
              </tr>
            )}
          </tbody>
          {data.rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 font-semibold">
                <td colSpan={showDate ? 6 : 5} className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{hrs(data.totalMinutes)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {data.count > data.rows.length && (
        <p className="mt-3 text-sm text-gray-500">
          Showing the first {DETAILED_ROW_LIMIT.toLocaleString()} of {data.count.toLocaleString()} entries (totals include all of them).{' '}
          <a href={buildHref(`${PATH}/export`, query)} className="text-brand-teal hover:underline">Export CSV</a> for the full list, or narrow the filters.
        </p>
      )}
    </div>
  )
}

function TimeRow({ r, showDate }: { r: DetailedTimeRow; showDate: boolean }) {
  const amount = r.isBillable && r.billableRateCents ? Math.round((r.minutes / 60) * r.billableRateCents) : 0
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
      <td className="px-4 py-2.5 text-gray-800">{r.taskName}</td>
      <td className="px-4 py-2.5 text-gray-600">{(r.roles ?? []).join(', ')}</td>
      <td className="px-4 py-2.5 text-gray-800">
        <Link href={`/team/${r.userId}`} className="hover:text-brand-teal">{r.userName}</Link>
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
        {hrs(r.minutes)}
        {!r.isBillable && <div className="text-[11px] text-gray-400">Non-billable</div>}
        {r.invoiced && <div className="text-[11px] text-gray-400">Invoiced</div>}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{amount ? formatCents(amount) : '—'}</td>
    </tr>
  )
}
