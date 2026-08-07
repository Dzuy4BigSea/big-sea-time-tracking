import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { requireModule } from '@/lib/modules'
import { NewPersonForm } from '@/components/NewPersonForm'
import { EntityChip } from '@/components/EntitySelect'
import { listEntities } from '@/lib/entities'

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

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Everyone' },
  ...Object.entries(PROFILE_LABEL).map(([value, label]) => ({ value, label })),
  { value: 'type:employee', label: 'Employees' },
  { value: 'type:contractor', label: 'Contractors' },
]

export default async function TeamPage({
  searchParams,
}: {
  searchParams: { q?: string; role?: string; archived?: string }
}) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  await requireModule(accountId, 'team')
  const canManage = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_people')

  const showArchived = searchParams.archived === '1'
  const q = (searchParams.q ?? '').trim()
  const role = searchParams.role ?? ''
  const roleFilter =
    role.startsWith('type:')
      ? { type: role.slice(5) as 'employee' | 'contractor' }
      : role
        ? { permissionProfile: role as PermissionProfile }
        : {}

  const [users, activeCount, archivedCount, entities] = await Promise.all([
    prisma.user.findMany({
      where: {
        accountId,
        archivedAt: null,
        ...(showArchived ? {} : { isActive: true }),
        ...roleFilter,
        ...(q
          ? { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        permissionProfile: true,
        type: true,
        capacityHoursPerWeek: true,
        isActive: true,
        homeEntity: { select: { code: true, name: true } },
        timeEntries: { select: { minutes: true, isBillable: true, billableRateCents: true } },
      },
      orderBy: [{ firstName: 'asc' }],
    }),
    prisma.user.count({ where: { accountId, archivedAt: null, isActive: true } }),
    prisma.user.count({ where: { accountId, archivedAt: null, isActive: false } }),
    listEntities(accountId),
  ])

  const qp = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q ? { q } : {}), ...(role ? { role } : {}), ...(showArchived ? { archived: '1' } : {}), ...over })
    const s = p.toString()
    return s ? `/team?${s}` : '/team'
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Team</h1>
      <p className="mb-6 text-sm text-gray-500">
        {activeCount} active {activeCount === 1 ? 'person' : 'people'}
        {archivedCount > 0 && ` · ${archivedCount} inactive`}
      </p>

      {canManage && <NewPersonForm entities={entities.map((e) => ({ id: e.id, name: e.name, code: e.code }))} />}

      {/* Filter bar: name search + role dropdown + active/archived toggle */}
      <form className="mb-3 flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Filter by name"
          className="w-56 rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
        <select name="role" defaultValue={role} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {showArchived && <input type="hidden" name="archived" value="1" />}
        <button className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Apply</button>
        {(q || role) && (
          <Link href={qp({ q: '', role: '' })} className="text-sm text-gray-400 hover:text-gray-600">Clear</Link>
        )}
        <Link
          href={showArchived ? qp({ archived: '' }) : qp({ archived: '1' })}
          className="ml-auto text-sm text-brand-teal hover:underline"
        >
          {showArchived ? 'Hide inactive people' : `View archived people${archivedCount > 0 ? ` (${archivedCount})` : ''} →`}
        </Link>
      </form>

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
              {canManage && <th className="px-4 py-3" />}
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
                    {u.homeEntity && <span className="ml-2"><EntityChip code={u.homeEntity.code} name={u.homeEntity.name} /></span>}
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
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <Link href={`/team/${u.id}`} className="text-xs text-gray-500 hover:text-brand-teal">
                        Manage
                      </Link>
                    </td>
                  )}
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
