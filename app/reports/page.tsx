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
import { ExportMenu } from '@/components/ExportMenu'
import { SaveReportControls } from '@/components/SaveReportControls'
import { savedReportContext, currentParams } from '@/modules/reports/savedReportContext'
import { ymd } from '@/lib/week'
import { resolveTimeframe, timeframeQuery, buildHref } from '@/modules/shared/timeframe'
import { parseSort, sortRows, type SortState } from '@/modules/reports/sort'
import {
  TIME_SORT_KEYS,
  type TimeSortKey,
  type TimeTab,
  type TimeTotals,
  parseTimeTab,
  defaultTimeSort,
  pct,
  formatHours as hrs,
  billableShareTitle,
  sumTotals,
  splitByPersonType,
} from '@/modules/reports/timeReport'

export const dynamic = 'force-dynamic'

// Group-by tabs under Reports > Time, Harvest naming (URL ?tab=clients|projects|tasks|users).
const TABS: { key: TimeTab; label: string }[] = [
  { key: 'clients', label: 'Clients' },
  { key: 'projects', label: 'Projects' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'users', label: 'Teammates' },
]

type Row = TimeTotals & {
  key: string
  label: string
  href: string | null
  clientName?: string | null
  clientHref?: string | null
  personType?: string | null
  initials?: string
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { tab?: string; group?: string; active?: string; period?: string; anchor?: string; from?: string; to?: string; sort?: string; dir?: string; saved?: string }
}) {
  const me = await requireUser()
  const { accountId, permissionProfile, permissionOverrides } = me
  const canExport = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'run_account_reports')
  // Money columns only for people who may see billable rates/amounts; others get hours only.
  const canSeeAmounts = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'view_billable_rates')
  const tab = parseTimeTab(searchParams)
  const activeOnly = searchParams.active === '1'
  const defaultSort = defaultTimeSort(tab)
  const parsedSort = parseSort<TimeSortKey>(searchParams, TIME_SORT_KEYS, defaultSort)
  // The Clients column only exists on the Projects tab.
  const sort = parsedSort.key === 'client' && tab !== 'projects' ? defaultSort : parsedSort

  // Harvest: reports open on This week (week start per account preference, Monday by default).
  const tf = resolveTimeframe(searchParams, { defaultPeriod: 'week', weekStartsOn: await accountWeekStartsOn(accountId) })
  const { from, till } = tf

  // Aggregate in the DB (never load raw entries — 388k rows). Metric expressions are shared;
  // only the grouping key/label/join differ per dimension. Every query joins Project `p` so the
  // "Active projects only" filter applies to all tabs.
  const filter = Prisma.sql`te."accountId" = ${accountId}
    ${from ? Prisma.sql`AND te."spentDate" >= ${from}` : Prisma.empty}
    ${till ? Prisma.sql`AND te."spentDate" <= ${till}` : Prisma.empty}
    ${activeOnly ? Prisma.sql`AND p."isActive" = true AND p."archivedAt" IS NULL` : Prisma.empty}`
  const metrics = Prisma.sql`
    SUM(te.minutes)::int AS minutes,
    SUM(CASE WHEN te."isBillable" THEN te.minutes ELSE 0 END)::int AS bmin,
    SUM(CASE WHEN te."isBillable" THEN te.minutes/60.0*COALESCE(te."billableRateCents",0) ELSE 0 END)::float8 AS bcents,
    SUM(CASE WHEN te."isBillable" AND te."invoiceLineItemId" IS NULL AND te."lockState"::text <> 'invoiced' AND p."projectType"::text <> 'fixed_fee' THEN te.minutes/60.0*COALESCE(te."billableRateCents",0) ELSE 0 END)::float8 AS ucents`

  type Raw = {
    key: string
    name: string
    code?: string | null
    cid?: string | null
    cname?: string | null
    fn?: string
    ln?: string
    utype?: string | null
    minutes: number
    bmin: number
    bcents: number
    ucents: number
  }
  let raw: Raw[]
  if (tab === 'projects') {
    raw = await prisma.$queryRaw<Raw[]>`SELECT p.id AS key, p.name AS name, p.code AS code, c.id AS cid, c.name AS cname, ${metrics}
      FROM "TimeEntry" te JOIN "Project" p ON p.id = te."projectId" JOIN "Client" c ON c.id = p."clientId"
      WHERE ${filter} GROUP BY p.id, p.name, p.code, c.id, c.name`
  } else if (tab === 'tasks') {
    raw = await prisma.$queryRaw<Raw[]>`SELECT t.id AS key, t.name AS name, ${metrics}
      FROM "TimeEntry" te JOIN "Project" p ON p.id = te."projectId" JOIN "Task" t ON t.id = te."taskId"
      WHERE ${filter} GROUP BY t.id, t.name`
  } else if (tab === 'users') {
    raw = await prisma.$queryRaw<Raw[]>`SELECT u.id AS key, u."firstName" AS fn, u."lastName" AS ln, u.type::text AS utype, ${metrics}
      FROM "TimeEntry" te JOIN "Project" p ON p.id = te."projectId" JOIN "User" u ON u.id = te."userId"
      WHERE ${filter} GROUP BY u.id, u."firstName", u."lastName", u.type`
  } else {
    raw = await prisma.$queryRaw<Raw[]>`SELECT c.id AS key, c.name AS name, ${metrics}
      FROM "TimeEntry" te JOIN "Project" p ON p.id = te."projectId" JOIN "Client" c ON c.id = p."clientId"
      WHERE ${filter} GROUP BY c.id, c.name`
  }

  const unsorted: Row[] = raw.map((r) => {
    const person = `${r.fn ?? ''} ${r.ln ?? ''}`.trim()
    return {
      key: r.key,
      label: tab === 'projects' ? `${r.code ? `[${r.code}] ` : ''}${r.name}` : tab === 'users' ? person : r.name,
      href: tab === 'projects' ? `/projects/${r.key}` : tab === 'clients' ? `/clients/${r.key}` : tab === 'users' ? `/team/${r.key}` : null,
      clientName: r.cname ?? null,
      clientHref: r.cid ? `/clients/${r.cid}` : null,
      personType: r.utype ?? null,
      initials: tab === 'users' ? `${(r.fn ?? '').charAt(0)}${(r.ln ?? '').charAt(0)}`.toUpperCase() : undefined,
      minutes: Number(r.minutes),
      billableMinutes: Number(r.bmin),
      billableCents: canSeeAmounts ? Math.round(Number(r.bcents)) : 0,
      uninvoicedCents: canSeeAmounts ? Math.round(Number(r.ucents)) : 0,
    }
  })
  // Sort the aggregated rows (one per client/project/task/person — small), never raw entries.
  const rows = sortRows(unsorted, sort, {
    name: (r) => r.label,
    client: (r) => r.clientName ?? null,
    hours: (r) => r.minutes,
    billable: (r) => r.billableMinutes,
    amount: (r) => r.billableCents,
  })
  const totals = sumTotals(rows)
  const nonBillableMinutes = totals.minutes - totals.billableMinutes
  const billablePct = pct(totals.billableMinutes, totals.minutes)
  const sections = tab === 'users' ? splitByPersonType(rows) : null
  const colCount = tab === 'projects' ? 6 : 5

  // Query-string builders that preserve the other params.
  const tfq = timeframeQuery(tf)
  const activeq = activeOnly ? { active: '1' } : {}
  const isDefaultSort = sort.key === defaultSort.key && sort.dir === defaultSort.dir
  const sortq = isDefaultSort ? {} : { sort: sort.key, dir: sort.dir }
  // Saving the report stores its current query; opened from Saved reports (?saved=) it shows the report's name menu.
  const saveParams = currentParams(searchParams)
  const saved = await savedReportContext(me, searchParams.saved, 'time_summary', saveParams)
  // Hours cells open the Detailed time report for that row over the same dates (Harvest).
  const detailedRange = tf.from || tf.till ? { range: 'custom', from: tf.from ? ymd(tf.from) : null, to: tf.till ? ymd(tf.till) : null } : { range: 'all' }
  const filterKey = ({ clients: 'clients', projects: 'projects', tasks: 'tasks', users: 'users' } as const)[tab]
  const detailHref = (key: string) => buildHref('/reports/detailed', { ...detailedRange, [filterKey]: key, active: activeOnly ? '1' : null })
  const sortHref = (s: SortState<TimeSortKey>) => buildHref('/reports', { tab, ...activeq, ...tfq, sort: s.key, dir: s.dir })

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <div className="flex items-center gap-2">
        <SaveReportControls kind="time_summary" params={saveParams} saved={saved} />
        {canExport && (
          <ExportMenu csvHref={buildHref('/reports/export', { tab, ...tfq })} />
        )}
        </div>
      </div>
      <p className="mb-4 text-sm text-gray-500">Time report · live from Supabase</p>
      <ReportsTabs active="Time" timeframe={tfq} />

      <ReportTimeframe basePath="/reports" tf={tf} keep={{ tab, ...activeq, ...sortq }} />

      {/* Summary card (Harvest layout): total hours | billable donut + legend | billable amount | uninvoiced amount.
          Each column is min-w-0 and the figures never wrap, so large all-time totals can't overlap. */}
      <div className="mb-4 grid gap-x-10 gap-y-6 rounded-lg border border-gray-200 bg-white p-6 sm:grid-cols-2 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="text-sm text-gray-600">Total hours</div>
          <div className="mt-1 whitespace-nowrap text-3xl font-semibold tabular-nums text-gray-900">{hrs(totals.minutes)}</div>
        </div>
        <div className="flex min-w-0 items-center gap-5">
          <BillableDonut percent={billablePct} empty={totals.minutes === 0} />
          <dl className="grid min-w-0 grid-cols-[auto_auto] items-center gap-x-6 gap-y-1.5 text-sm">
            <dt className="flex items-center gap-2 whitespace-nowrap text-gray-700">
              <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm bg-brand-blue" />
              Billable
            </dt>
            <dd className="whitespace-nowrap text-right font-semibold tabular-nums text-gray-900">{hrs(totals.billableMinutes)}</dd>
            <dt className="flex items-center gap-2 whitespace-nowrap text-gray-700">
              <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm bg-gray-300" />
              Non-billable
            </dt>
            <dd className="whitespace-nowrap text-right font-semibold tabular-nums text-gray-900">{hrs(nonBillableMinutes)}</dd>
          </dl>
        </div>
        <div className="min-w-0">
          <div className="text-sm text-gray-600">Billable amount</div>
          <div className="mt-1 whitespace-nowrap text-3xl font-semibold tabular-nums text-gray-900">{canSeeAmounts ? formatCents(totals.billableCents) : '—'}</div>
        </div>
        <div className="min-w-0">
          <div className="text-sm text-gray-600">Uninvoiced amount</div>
          <div className="mt-1 whitespace-nowrap text-3xl font-semibold tabular-nums text-brand-green">{canSeeAmounts ? formatCents(totals.uninvoicedCents) : '—'}</div>
          <div className="mt-1 text-xs text-gray-500">Excludes Fixed Fee projects</div>
        </div>
      </div>

      {/* Group-by tabs + filters */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 border-b border-gray-200 text-sm" aria-label="Group by">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={buildHref('/reports', { tab: t.key, ...activeq, ...tfq })}
              aria-current={t.key === tab ? 'page' : undefined}
              className={`-mb-px border-b-2 px-3 py-2 ${t.key === tab ? 'border-brand-teal font-medium text-brand-teal' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <Link
          href={buildHref('/reports', { tab, ...tfq, ...sortq, active: activeOnly ? null : '1' })}
          role="checkbox"
          aria-checked={activeOnly}
          scroll={false}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <span
            aria-hidden
            className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] leading-none ${activeOnly ? 'border-brand-teal bg-brand-teal text-white' : 'border-gray-300 bg-white'}`}
          >
            {activeOnly ? '✓' : ''}
          </span>
          Active projects only
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <SortableTh label="Name" col="name" sort={sort} hrefFor={sortHref} />
              {tab === 'projects' && <SortableTh label="Clients" col="client" sort={sort} hrefFor={sortHref} />}
              <SortableTh label="Hours" col="hours" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
              <th className="w-32 px-4 py-3" aria-label="Billable share" />
              <SortableTh label="Billable hours" col="billable" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
              <SortableTh label="Billable amount" col="amount" sort={sort} hrefFor={sortHref} firstDir="desc" align="right" />
            </tr>
          </thead>
          <tbody>
            {sections
              ? sections.map((s) => [
                  <tr key={`h-${s.type}`} className="border-b border-gray-100 bg-gray-50 font-medium">
                    <td className="px-4 py-2 text-xs uppercase tracking-wide text-gray-500">{s.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700">{hrs(s.totals.minutes)}</td>
                    <td className="px-4 py-2"><ShareBar billable={s.totals.billableMinutes} total={s.totals.minutes} /></td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-600">{billableHoursCell(s.totals)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700">{amountCell(s.totals.billableCents)}</td>
                  </tr>,
                  ...s.rows.map((r) => <DataRow key={r.key} r={r} tab={tab} detailHref={detailHref(r.key)} />),
                ])
              : rows.map((r) => <DataRow key={r.key} r={r} tab={tab} detailHref={detailHref(r.key)} />)}
            {rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-4 py-8 text-center text-gray-400">
                  No tracked time in this period.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 font-semibold">
                <td className="px-4 py-3">Total</td>
                {tab === 'projects' && <td />}
                <td className="px-4 py-3 text-right tabular-nums">{hrs(totals.minutes)}</td>
                <td className="px-4 py-3"><ShareBar billable={totals.billableMinutes} total={totals.minutes} /></td>
                <td className="px-4 py-3 text-right tabular-nums">{billableHoursCell(totals)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{amountCell(totals.billableCents)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

const billableHoursCell = (t: TimeTotals) => `${hrs(t.billableMinutes)} (${pct(t.billableMinutes, t.minutes)}%)`
const amountCell = (cents: number) => (cents ? formatCents(cents) : '—')

function DataRow({ r, tab, detailHref }: { r: Row; tab: TimeTab; detailHref: string }) {
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="px-4 py-3 font-medium text-gray-900">
        <span className="flex items-center gap-2">
          {r.initials !== undefined && (
            <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-ink text-[10px] font-semibold text-white">
              {r.initials}
            </span>
          )}
          {r.href ? (
            <Link href={r.href} className="hover:text-brand-teal">
              {r.label}
            </Link>
          ) : (
            r.label
          )}
        </span>
      </td>
      {tab === 'projects' && (
        <td className="px-4 py-3 text-gray-600">
          {r.clientHref ? (
            <Link href={r.clientHref} className="hover:text-brand-teal">
              {r.clientName}
            </Link>
          ) : (
            r.clientName
          )}
        </td>
      )}
      <td className="px-4 py-3 text-right tabular-nums">
        <Link href={detailHref} className="text-brand-teal underline decoration-brand-teal/30 underline-offset-2 hover:decoration-brand-teal" title="Open the detailed time report">
          {hrs(r.minutes)}
        </Link>
      </td>
      <td className="px-4 py-3">
        <ShareBar billable={r.billableMinutes} total={r.minutes} />
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-gray-500">{billableHoursCell(r)}</td>
      <td className="px-4 py-3 text-right tabular-nums">{amountCell(r.billableCents)}</td>
    </tr>
  )
}

/** Horizontal bar: billable share (blue) vs non-billable (grey); hover shows the split. */
function ShareBar({ billable, total }: { billable: number; total: number }) {
  const b = pct(billable, total)
  return (
    <div title={billableShareTitle(billable, total)} className="flex h-2 w-full min-w-[4rem] overflow-hidden rounded-full bg-gray-200">
      <div className="h-full bg-brand-blue" style={{ width: `${b}%` }} />
    </div>
  )
}

/** CSS-only donut of the billable share. */
function BillableDonut({ percent, empty }: { percent: number; empty: boolean }) {
  return (
    <div
      role="img"
      aria-label={`${percent}% billable`}
      className="relative h-20 w-20 shrink-0 rounded-full"
      style={{ background: empty ? '#e5e7eb' : `conic-gradient(#5180eb 0 ${percent}%, #d1d5db ${percent}% 100%)` }}
    >
      <div className="absolute inset-2.5 flex items-center justify-center rounded-full bg-white text-base font-semibold text-gray-800">{percent}%</div>
    </div>
  )
}
