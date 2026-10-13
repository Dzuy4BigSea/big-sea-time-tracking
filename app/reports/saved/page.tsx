import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { ReportsTabs } from '@/components/ReportsTabs'
import { DropdownMenu } from '@/components/DropdownMenu'
import { SavedReportActions } from '@/components/SavedReportActions'
import { usDate } from '@/components/DetailedReportParts'
import { SAVED_FILTERS, KIND_LABEL, canEdit, inFilter, savedReportHref, type SavedFilter } from '@/modules/reports/savedReports'

export const dynamic = 'force-dynamic'

/** Saved reports tab (Harvest): All / My reports / Shared with me / Archived, newest first. specs/25. */
export default async function SavedReportsPage({ searchParams }: { searchParams: { show?: string } }) {
  const me = await requireUser()
  const filter: SavedFilter = SAVED_FILTERS.find((x) => x.key === searchParams.show)?.key ?? 'all'

  // Everything this person may see: their own plus anything shared in the account.
  const visible = await prisma.savedReport.findMany({
    where: { accountId: me.accountId, OR: [{ createdById: me.userId }, { shared: true }] },
    select: {
      id: true, name: true, kind: true, params: true, shared: true, archivedAt: true, createdById: true, updatedAt: true,
      createdBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })
  const counts = Object.fromEntries(SAVED_FILTERS.map((x) => [x.key, visible.filter((r) => inFilter(r, me.userId, x.key)).length])) as Record<SavedFilter, number>
  const rows = visible.filter((r) => inFilter(r, me.userId, filter))
  const current = SAVED_FILTERS.find((x) => x.key === filter)!

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Reports</h1>
      <ReportsTabs active="Saved reports" />

      <div className="mb-3">
        <DropdownMenu
          label={
            <span className="flex items-center gap-2 font-medium">
              {current.label} ({counts[filter]})
              <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          }
          summaryClassName="cursor-pointer list-none rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 shadow-sm hover:bg-gray-50"
          menuClassName="absolute left-0 z-20 mt-1 w-60 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg"
        >
          {SAVED_FILTERS.map((x) => (
            <Link
              key={x.key}
              href={x.key === 'all' ? '/reports/saved' : `/reports/saved?show=${x.key}`}
              aria-current={x.key === filter ? 'true' : undefined}
              className={`block px-3 py-1.5 text-sm hover:bg-gray-50 ${x.key === filter ? 'font-medium text-brand-teal' : 'text-gray-700'}`}
            >
              {x.label} ({counts[x.key]})
            </Link>
          ))}
        </DropdownMenu>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Report name</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Date saved ▼</th>
              <th className="px-4 py-3 font-medium">Created by</th>
              <th className="px-4 py-3 font-medium">Shared with</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const initials = `${r.createdBy.firstName.charAt(0)}${r.createdBy.lastName.charAt(0)}`.toUpperCase()
              return (
                <tr key={r.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <Link href={savedReportHref(r)} className="hover:text-brand-teal">{r.name}</Link>
                    {r.archivedAt && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-normal text-gray-500">Archived</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{KIND_LABEL[r.kind]}</td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">{usDate(r.updatedAt)}</td>
                  <td className="px-4 py-3 text-gray-700">
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-ink text-[10px] font-semibold text-white">{initials}</span>
                      {r.createdById === me.userId ? 'You' : `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{r.shared ? 'Everyone' : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <SavedReportActions
                      report={{ id: r.id, name: r.name, shared: r.shared, archived: r.archivedAt != null }}
                      canEdit={canEdit(r, me.userId, me.permissionProfile)}
                    />
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                  {filter === 'all' ? (
                    <>No saved reports yet. Run a report from <span className="font-medium">+ New report</span> and choose <span className="font-medium">Save report</span>.</>
                  ) : (
                    'Nothing here.'
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
