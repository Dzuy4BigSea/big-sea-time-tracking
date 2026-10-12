import { accountWeekStartsOn } from '@/lib/accountPrefs'
import Link from 'next/link'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { ReportsTabs } from '@/components/ReportsTabs'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { ReportTimeframe } from '@/components/ReportTimeframe'
import { SortableTh } from '@/components/SortableTh'
import { resolveTimeframe, needsFallbackAnchor, timeframeQuery, buildHref } from '@/modules/shared/timeframe'
import { parseSort, sortRows, type SortState } from '@/modules/reports/sort'

export const dynamic = 'force-dynamic'

const hrs = (m: number) => (m / 60).toLocaleString(undefined, { maximumFractionDigits: 2 })

// Time report groups by one of these dimensions (sub-tabs under the Time tab).
type Group = 'clients' | 'projects' | 'tasks' | 'teammates'
const GROUPS: { key: Group; label: string; column: string }[] = [
  { key: 'clients', label: 'Clients', column: 'Client' },
  { key: 'projects', label: 'Projects', column: 'Project' },
  { key: 'tasks', label: 'Tasks', column: 'Task' },
  { key: 'teammates', label: 'Teammates', column: 'Teammate' },
]

const SORT_KEYS = ['name', 'hours', 'billable', 'amount', 'uninvoiced'] as const
type SortKey = (typeof SORT_KEYS)[number]

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { group?: string; period?: string; anchor?: string; from?: string; to?: string; sort?: string; dir?: string }
}) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  const canExport = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'run_account_reports')
  const group: Group = (['clients', 'projects', 'tasks', 'teammates'] as const).includes(searchParams.group as Group)
    ? (searchParams.group as Group)
    : 'clients'
  const sort = parseSort<SortKey>(searchParams, SORT_KEYS, { key: 'hours', dir: 'desc' })

  // Anchor for week/month/… navigation defaults to the latest tracked day, so there's data.
  let fallbackAnchor: Date | null = null
  if (needsFallbackAnchor(searchParams)) {
    const latest = await prisma.timeEntry.aggregate({ where: { accountId }, _max: { spentDate: true } })
    fallbackAnchor = latest._max.spentDate ?? new Date()
  }
  const tf = resolveTimeframe(searchParams, { fallbackAnchor, weekStartsOn: await accountWeekStartsOn(accountId) })
  const { from, till } = tf

  // Aggregate in the DB (never load raw entries — 388k rows). Metric expressions are shared;
  // only the grouping key/label/join differ per dimension.
  const dateFilter = Prisma.sql`${from ? Prisma.sql`AND te."spentDate" >= ${from}` : Prisma.empty} ${till ? Prisma.sql`AND te."spentDate" <= ${till}` : Prisma.empty}`
  const metrics = Prisma.sql`
    SUM(te.minutes)::int AS minutes,
    SUM(CASE WHEN te."isBillable" THEN te.minutes ELSE 0 END)::int AS bmin,
    SUM(CASE WHEN te."isBillable" THEN te.minutes/60.0*COALESCE(te."billableRateCents",0) ELSE 0 END)::float8 AS bcents,
    SUM(CASE WHEN te."isBillable" AND te."invoiceLineItemId" IS NULL AND te."lockState"::text <> 'invoiced' THEN te.minutes/60.0*COALESCE(te."billableRateCents",0) ELSE 0 END)::float8 AS ucents`

  type Raw = { key: string; name: string; code?: string | null; fn?: string; ln?: string; minutes: number; bmin: number; bcents: number; ucents: number }
  let raw: Raw[]
  if (group === 'projects') {
    raw = await prisma.$queryRaw<Raw[]>`SELECT p.id AS key, p.name AS name, p.code AS code, ${metrics}
      FROM "TimeEntry" te JOIN "Project" p ON p.id = te."projectId"
      WHERE te."accountId" = ${accountId} ${dateFilter} GROUP BY p.id, p.name, p.code ORDER BY minutes DESC`
  } else if (group === 'tasks') {
    raw = await prisma.$queryRaw<Raw[]>`SELECT t.id AS key, t.name AS name, ${metrics}
      FROM "TimeEntry" te JOIN "Task" t ON t.id = te."taskId"
      WHERE te."accountId" = ${accountId} ${dateFilter} GROUP BY t.id, t.name ORDER BY minutes DESC`
  } else if (group === 'teammates') {
    raw = await prisma.$queryRaw<Raw[]>`SELECT u.id AS key, u."firstName" AS fn, u."lastName" AS ln, ${metrics}
      FROM "TimeEntry" te JOIN "User" u ON u.id = te."userId"
      WHERE te."accountId" = ${accountId} ${dateFilter} GROUP BY u.id, u."firstName", u."lastName" ORDER BY minutes DESC`
  } else {
    raw = await prisma.$queryRaw<Raw[]>`SELECT c.id AS key, c.name AS name, ${metrics}
      FROM "TimeEntry" te JOIN "Project" p ON p.id = te."projectId" JOIN "Client" c ON c.id = p."clientId"
      WHERE te."accountId" = ${accountId} ${dateFilter} GROUP BY c.id, c.name ORDER BY minutes DESC`
  }

  type Row = { key: string; label: string; href: string | null; minutes: number; billableMinutes: number; billableCents: number; uninvoicedCents: number }
  const unsorted: Row[] = raw.map((r) => ({
    key: r.key,
    label: group === 'projects' ? `${r.code ? `[${r.code}] ` : ''}${r.name}` : group === 'teammates' ? `${r.fn ?? ''} ${r.ln ?? ''}`.trim() : r.name,
    href: group === 'projects' ? `/projects/${r.key}` : group === 'clients' ? `/clients/${r.key}` : null,
    minutes: Number(r.minutes),
    billableMinutes: Number(r.bmin),
    billableCents: Math.round(Number(r.bcents)),
    uninvoicedCents: Math.round(Number(r.ucents)),
  }))
  // Sort the aggregated rows (one per client/project/task/person — small), never raw entries.
  const rows = sortRows(unsorted, sort, {
    name: (r) => r.label,
    hours: (r) => r.minutes,
    billable: (r) => r.billableMinutes,
    amount: (r) => r.billableCents,
    uninvoiced: (r) => r.uninvoicedCents,
  })
  const totals = rows.reduce(
    (a, r) => ({ minutes: a.minutes + r.minutes, billableMinutes: a.billableMinutes + r.billableMinutes, billableCents: a.billableCents + r.billableCents, uninvoicedCents: a.uninvoicedCents + r.uninvoicedCents }),
    { minutes: 0, billableMinutes: 0, billableCents: 0, uninvoicedCents: 0 },
  )
  const column = GROUPS.find((g) => g.key === group)!.column
  const nonBillableMinutes = totals.minutes - totals.billableMinutes
  const billablePct = totals.minutes > 0 ? Math.round((totals.billableMinutes / totals.minutes) * 100) : 0

  // Query-string builders that preserve the other params.
  const tfq = timeframeQuery(tf)
  const sortq = sort.key === 'hours' && sort.dir === 'desc' ? {} : { sort: sort.key, dir: sort.dir }
  const sortHref = (s: SortState<SortKey>) => buildHref('/reports', { group, ...tfq, sort: s.key, dir: s.dir })

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Reports</h1>
        {canExport && (
          <Link href={buildHref('/reports/export', tfq)} prefetch={false} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50">
            Export CSV
          </Link>
        )}
      </div>
      <p className="mb-4 text-sm text-gray-500">Time report · live from Supabase</p>
      <ReportsTabs active="Time" timeframe={tfq} />

      <ReportTimeframe basePath="/reports" tf={tf} keep={{ group, ...sortq }} />

      {/* Summary band */}
      <div className="mb-4 grid gap-4 rounded-lg border border-gray-200 bg-white p-5 sm:grid-cols-4">
        <Metric label="Total hours" value={hrs(totals.minutes)} />
        <Metric label={`Billable (${billablePct}%)`} value={hrs(totals.billableMinutes)} sub={`${hrs(nonBillableMinutes)} non-billable`} />
        <Metric label="Billable amount" value={formatCents(totals.billableCents)} />
        <Metric label="Uninvoiced amount" value={formatCents(totals.uninvoicedCents)} accent="text-brand-green" />
      </div>

      {/* Grouping sub-tabs */}
      <div className="mb-4 flex gap-1 text-sm">
        {GROUPS.map((g) => (
          <Link
            key={g.key}
            href={buildHref('/reports', { group: g.key, ...tfq, ...sortq })}
            className={`rounded-full px-3 py-1 ${g.key === group ? 'bg-brand-teal-50 font-medium text-brand-teal' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            {g.label}
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <SortableTh label={column} col="name" sort={sort} hrefFor={sortHref} />
              <SortableTh label="Hours" col="hours" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
              <SortableTh label="Billable hours" col="billable" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
              <SortableTh label="Billable amount" col="amount" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
              <SortableTh label="Uninvoiced" col="uninvoiced" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {r.href ? (
                    <Link href={r.href} className="hover:text-brand-teal">
                      {r.label}
                    </Link>
                  ) : (
                    r.label
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{hrs(r.minutes)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{hrs(r.billableMinutes)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.billableCents ? formatCents(r.billableCents) : '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.uninvoicedCents ? formatCents(r.uninvoicedCents) : '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No tracked time in this period.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 font-medium">
                <td className="px-4 py-3 text-xs uppercase tracking-wide text-gray-400">Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{hrs(totals.minutes)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{hrs(totals.billableMinutes)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCents(totals.billableCents)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCents(totals.uninvoicedCents)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${accent ?? 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  )
}
