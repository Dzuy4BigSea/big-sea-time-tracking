import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { isUninvoiced } from '@/modules/invoicing/uninvoiced'
import { ReportsTabs } from '@/components/ReportsTabs'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { startOfWeekMonday, addDays, ymd, parseYmd } from '@/lib/week'

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

type Period = 'week' | 'month' | 'all'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const md = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { group?: string; period?: string; anchor?: string }
}) {
  const { accountId, permissionProfile } = await requireUser()
  const canExport = can({ permissionProfile: permissionProfile as PermissionProfile }, 'run_account_reports')
  const group: Group = (['clients', 'projects', 'tasks', 'teammates'] as const).includes(searchParams.group as Group)
    ? (searchParams.group as Group)
    : 'clients'
  const period: Period = (['week', 'month', 'all'] as const).includes(searchParams.period as Period)
    ? (searchParams.period as Period)
    : 'all'

  // Anchor date for week/month navigation (defaults to the latest tracked day, so there's data).
  let anchor = parseYmd(searchParams.anchor)
  if (!anchor && period !== 'all') {
    const latest = await prisma.timeEntry.aggregate({ where: { accountId }, _max: { spentDate: true } })
    anchor = latest._max.spentDate ?? new Date()
  }

  // Resolve [from, till] for the selected period.
  let from: Date | null = null
  let till: Date | null = null
  let rangeLabel = 'All time'
  let prevAnchor: string | null = null
  let nextAnchor: string | null = null
  if (period === 'week' && anchor) {
    const monday = startOfWeekMonday(anchor)
    from = monday
    till = addDays(monday, 6)
    rangeLabel = `${md(from)} – ${md(till)} ${till.getUTCFullYear()}`
    prevAnchor = ymd(addDays(monday, -7))
    nextAnchor = ymd(addDays(monday, 7))
  } else if (period === 'month' && anchor) {
    const y = anchor.getUTCFullYear()
    const m = anchor.getUTCMonth()
    from = new Date(Date.UTC(y, m, 1))
    till = new Date(Date.UTC(y, m + 1, 0))
    rangeLabel = `${MONTHS[m]} ${y}`
    prevAnchor = ymd(new Date(Date.UTC(y, m - 1, 1)))
    nextAnchor = ymd(new Date(Date.UTC(y, m + 1, 1)))
  }

  const entries = await prisma.timeEntry.findMany({
    where: { accountId, ...(from && till ? { spentDate: { gte: from, lte: till } } : {}) },
    select: {
      minutes: true,
      isBillable: true,
      billableRateCents: true,
      invoiceLineItemId: true,
      lockState: true,
      task: { select: { id: true, name: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
      project: { select: { id: true, name: true, code: true, client: { select: { id: true, name: true } } } },
    },
  })

  type Row = { key: string; label: string; href: string | null; minutes: number; billableMinutes: number; billableCents: number; uninvoicedCents: number }
  const rowsMap = new Map<string, Row>()
  const totals = { minutes: 0, billableMinutes: 0, billableCents: 0, uninvoicedCents: 0 }

  const keyOf = (e: (typeof entries)[number]): { key: string; label: string; href: string | null } => {
    switch (group) {
      case 'projects':
        return { key: e.project.id, label: `${e.project.code ? `[${e.project.code}] ` : ''}${e.project.name}`, href: `/projects/${e.project.id}` }
      case 'tasks':
        return { key: e.task.id, label: e.task.name, href: null }
      case 'teammates':
        return { key: e.user.id, label: `${e.user.firstName} ${e.user.lastName}`.trim(), href: null }
      case 'clients':
      default:
        return { key: e.project.client.id, label: e.project.client.name, href: `/clients/${e.project.client.id}` }
    }
  }

  for (const e of entries) {
    const { key, label, href } = keyOf(e)
    const row = rowsMap.get(key) ?? { key, label, href, minutes: 0, billableMinutes: 0, billableCents: 0, uninvoicedCents: 0 }
    const amount = e.isBillable && e.billableRateCents ? Math.round((e.minutes / 60) * e.billableRateCents) : 0
    row.minutes += e.minutes
    totals.minutes += e.minutes
    if (e.isBillable) {
      row.billableMinutes += e.minutes
      totals.billableMinutes += e.minutes
    }
    row.billableCents += amount
    totals.billableCents += amount
    if (isUninvoiced({ isBillable: e.isBillable, invoiceLineItemId: e.invoiceLineItemId, lockState: e.lockState })) {
      row.uninvoicedCents += amount
      totals.uninvoicedCents += amount
    }
    rowsMap.set(key, row)
  }

  const rows = [...rowsMap.values()].sort((a, b) => b.minutes - a.minutes)
  const column = GROUPS.find((g) => g.key === group)!.column
  const nonBillableMinutes = totals.minutes - totals.billableMinutes
  const billablePct = totals.minutes > 0 ? Math.round((totals.billableMinutes / totals.minutes) * 100) : 0

  // Query-string builders that preserve the other params.
  const withParams = (o: { group?: Group; period?: Period; anchor?: string | null }) => {
    const p = new URLSearchParams()
    p.set('group', o.group ?? group)
    p.set('period', o.period ?? period)
    const a = o.anchor === undefined ? (searchParams.anchor ?? null) : o.anchor
    if (a && (o.period ?? period) !== 'all') p.set('anchor', a)
    return `/reports?${p.toString()}`
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Reports</h1>
        {canExport && (
          <Link href="/reports/export" prefetch={false} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50">
            Export CSV
          </Link>
        )}
      </div>
      <p className="mb-4 text-sm text-gray-500">Time report · live from Supabase</p>
      <ReportsTabs active="Time" />

      {/* Period selector */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 text-sm">
          {(['week', 'month', 'all'] as Period[]).map((p) => (
            <Link
              key={p}
              href={withParams({ period: p, anchor: p === 'all' ? null : undefined })}
              className={`rounded px-3 py-1 ${period === p ? 'bg-brand-teal-50 font-medium text-brand-teal' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              {p === 'week' ? 'This week' : p === 'month' ? 'This month' : 'All time'}
            </Link>
          ))}
        </div>
        {period !== 'all' && (
          <div className="flex items-center gap-2 text-sm">
            <Link href={withParams({ anchor: prevAnchor })} className="rounded border border-gray-200 bg-white px-2 py-1 text-gray-600 hover:text-brand-teal">←</Link>
            <span className="rounded border border-gray-200 bg-white px-3 py-1">{rangeLabel}</span>
            <Link href={withParams({ anchor: nextAnchor })} className="rounded border border-gray-200 bg-white px-2 py-1 text-gray-600 hover:text-brand-teal">→</Link>
          </div>
        )}
      </div>

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
            href={withParams({ group: g.key })}
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
              <th className="px-4 py-3 font-medium">{column}</th>
              <th className="px-4 py-3 text-right font-medium">Hours</th>
              <th className="px-4 py-3 text-right font-medium">Billable hours</th>
              <th className="px-4 py-3 text-right font-medium">Billable amount</th>
              <th className="px-4 py-3 text-right font-medium">Uninvoiced</th>
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
