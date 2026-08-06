import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { NewPersonForm } from '@/components/NewPersonForm'

export const dynamic = 'force-dynamic'

const PROFILE_LABEL: Record<string, string> = {
  member: 'Member',
  project_manager: 'Project Manager',
  people_admin: 'People Admin',
  accounting: 'Accounting',
  executive_manager: 'Executive Manager',
  administrator: 'Administrator',
}

const hrs = (m: number) => (m / 60).toLocaleString(undefined, { maximumFractionDigits: 2 })

export default async function TeamPage() {
  const { accountId, permissionProfile } = await requireUser()
  const canManage = can({ permissionProfile: permissionProfile as PermissionProfile }, 'manage_people')
  const users = await prisma.user.findMany({
    where: { accountId, archivedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      permissionProfile: true,
      type: true,
      capacityHoursPerWeek: true,
      isActive: true,
      timeEntries: { select: { minutes: true, isBillable: true, billableRateCents: true } },
    },
    orderBy: [{ firstName: 'asc' }],
  })

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Team</h1>
      <p className="mb-6 text-sm text-gray-500">Live from Supabase · {users.length} people</p>

      {canManage && <NewPersonForm />}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Permission</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 text-right font-medium">Capacity</th>
              <th className="px-4 py-3 text-right font-medium">Tracked</th>
              <th className="px-4 py-3 text-right font-medium">Billable</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const totalMin = u.timeEntries.reduce((s, e) => s + e.minutes, 0)
              const billableCents = u.timeEntries.reduce(
                (s, e) => s + (e.isBillable && e.billableRateCents ? Math.round((e.minutes / 60) * e.billableRateCents) : 0),
                0,
              )
              return (
                <tr key={u.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900">
                      {u.firstName} {u.lastName}
                    </span>
                    {!u.isActive && <span className="ml-2 text-xs text-gray-400">(inactive)</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {PROFILE_LABEL[u.permissionProfile] ?? u.permissionProfile}
                    </span>
                  </td>
                  <td className="px-4 py-3 capitalize text-gray-600">{u.type}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                    {u.capacityHoursPerWeek ? `${Number(u.capacityHoursPerWeek)}h/wk` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{hrs(totalMin)}h</td>
                  <td className="px-4 py-3 text-right tabular-nums">{billableCents > 0 ? formatCents(billableCents) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">Tracked / billable are all-time totals in this demo.</p>
    </div>
  )
}
