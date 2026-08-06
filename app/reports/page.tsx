import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { isUninvoiced } from '@/modules/invoicing/uninvoiced'
import { ReportsTabs } from '@/components/ReportsTabs'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'

export const dynamic = 'force-dynamic'

const hrs = (m: number) => (m / 60).toLocaleString(undefined, { maximumFractionDigits: 2 })

// Harvest's Time report groups by one of these dimensions (sub-tabs under the Time tab).
type Group = 'clients' | 'projects' | 'tasks' | 'teammates'
const GROUPS: { key: Group; label: string; column: string }[] = [
  { key: 'clients', label: 'Clients', column: 'Client' },
  { key: 'projects', label: 'Projects', column: 'Project' },
  { key: 'tasks', label: 'Tasks', column: 'Task' },
  { key: 'teammates', label: 'Teammates', column: 'Teammate' },
]

export default async function ReportsPage({ searchParams }: { searchParams: { group?: string } }) {
  const { accountId, permissionProfile } = await requireUser()
  const canExport = can({ permissionProfile: permissionProfile as PermissionProfile }, 'run_account_reports')
  const group: Group = (['clients', 'projects', 'tasks', 'teammates'] as const).includes(searchParams.group as Group)
    ? (searchParams.group as Group)
    : 'clients'

  const entries = await prisma.timeEntry.findMany({
    where: { accountId },
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

      {/* Grouping sub-tabs (Clients / Projects / Tasks / Teammates) */}
      <div className="mb-4 flex gap-1 text-sm">
        {GROUPS.map((g) => (
          <Link
            key={g.key}
            href={`/reports?group=${g.key}`}
            className={`rounded-full px-3 py-1 ${
              g.key === group ? 'bg-orange-50 font-medium text-brand-orange' : 'text-gray-500 hover:bg-gray-50'
            }`}
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
                    <Link href={r.href} className="hover:text-brand-orange">
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
                  No tracked time yet.
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
