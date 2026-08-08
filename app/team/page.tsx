import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { requireModule } from '@/lib/modules'
import { NewPersonForm } from '@/components/NewPersonForm'
import { EntityChip } from '@/components/EntitySelect'
import { listEntities } from '@/lib/entities'
import { startOfWeek, addDays, ymd, parseYmd } from '@/lib/week'

export const dynamic = 'force-dynamic'

const PROFILE_LABEL: Record<string, string> = {
  member: 'Member',
  project_manager: 'Project Manager',
  people_admin: 'People Admin',
  accounting: 'Accounting',
  executive_manager: 'Executive Manager',
  administrator: 'Administrator',
}
const hrs = (m: number) => (m / 60).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtRange = (a: Date, b: Date) => {
  const f = (d: Date, withMonth = true) => new Intl.DateTimeFormat('en-US', { day: '2-digit', ...(withMonth ? { month: 'short' } : {}), year: 'numeric', timeZone: 'UTC' }).format(d)
  return `${new Intl.DateTimeFormat('en-US', { day: '2-digit', timeZone: 'UTC' }).format(a)} – ${f(b)}`
}

const ROLE_OPTIONS = [
  { value: '', label: 'Everyone' },
  ...Object.entries(PROFILE_LABEL).map(([value, label]) => ({ value, label })),
  { value: 'type:employee', label: 'Employees' },
  { value: 'type:contractor', label: 'Contractors' },
]

export default async function TeamPage({
  searchParams,
}: {
  searchParams: { tab?: string; q?: string; role?: string; archived?: string; week?: string }
}) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  await requireModule(accountId, 'team')
  const canManage = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_people')

  const tab = searchParams.tab === 'assignments' ? 'assignments' : 'members'
  const showArchived = searchParams.archived === '1'
  const q = (searchParams.q ?? '').trim()
  const role = searchParams.role ?? ''
  const roleFilter =
    role.startsWith('type:') ? { type: role.slice(5) as 'employee' | 'contractor' } : role ? { permissionProfile: role as PermissionProfile } : {}

  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { weekStartsOn: true } })
  const weekStartsOn = (account?.weekStartsOn ?? 'monday') as 'monday' | 'sunday'
  const weekStart = startOfWeek(parseYmd(searchParams.week) ?? new Date(), weekStartsOn)
  const weekEnd = addDays(weekStart, 7) // exclusive
  const weekEndDisplay = addDays(weekStart, 6)
  const isThisWeek = ymd(weekStart) === ymd(startOfWeek(new Date(), weekStartsOn))

  const [users, activeCount, archivedCount, entities, weekAgg] = await Promise.all([
    prisma.user.findMany({
      where: {
        accountId,
        archivedAt: null,
        ...(showArchived ? {} : { isActive: true }),
        ...roleFilter,
        ...(q ? { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      select: { id: true, firstName: true, lastName: true, permissionProfile: true, type: true, capacityHoursPerWeek: true, isActive: true, homeEntity: { select: { code: true, name: true } } },
      orderBy: [{ firstName: 'asc' }],
    }),
    prisma.user.count({ where: { accountId, archivedAt: null, isActive: true } }),
    prisma.user.count({ where: { accountId, archivedAt: null, isActive: false } }),
    listEntities(accountId),
    prisma.timeEntry.groupBy({
      by: ['userId', 'isBillable'],
      where: { accountId, spentDate: { gte: weekStart, lt: weekEnd } },
      _sum: { minutes: true },
    }),
  ])

  // userId → { billable, nonBillable } minutes for the selected week.
  const weekBy = new Map<string, { b: number; n: number }>()
  for (const r of weekAgg) {
    const cur = weekBy.get(r.userId) ?? { b: 0, n: 0 }
    if (r.isBillable) cur.b += r._sum.minutes ?? 0
    else cur.n += r._sum.minutes ?? 0
    weekBy.set(r.userId, cur)
  }

  const rows = users.map((u) => {
    const wk = weekBy.get(u.id) ?? { b: 0, n: 0 }
    const total = wk.b + wk.n
    const capMin = u.capacityHoursPerWeek ? Number(u.capacityHoursPerWeek) * 60 : 0
    const util = capMin > 0 ? Math.round((total / capMin) * 100) : 0
    return { u, billMin: wk.b, nonBillMin: wk.n, total, capMin, util }
  })
  const sum = rows.reduce((a, r) => ({ total: a.total + r.total, bill: a.bill + r.billMin, nonbill: a.nonbill + r.nonBillMin, cap: a.cap + r.capMin }), { total: 0, bill: 0, nonbill: 0, cap: 0 })
  const teamUtilBill = sum.cap > 0 ? (sum.bill / sum.cap) * 100 : 0
  const teamUtilNon = sum.cap > 0 ? (sum.nonbill / sum.cap) * 100 : 0

  const qp = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(tab !== 'members' ? { tab } : {}), ...(q ? { q } : {}), ...(role ? { role } : {}), ...(showArchived ? { archived: '1' } : {}), ...(searchParams.week ? { week: searchParams.week } : {}), ...over })
    const s = p.toString()
    return s ? `/team?${s}` : '/team'
  }
  const weekQp = (d: Date) => qp({ week: ymd(d) })

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Team</h1>
      <p className="mb-4 text-sm text-gray-500">
        {activeCount} active {activeCount === 1 ? 'person' : 'people'}{archivedCount > 0 && ` · ${archivedCount} inactive`}
      </p>

      {/* Members / Assignments tabs */}
      <div className="mb-5 flex gap-6 border-b border-gray-200 text-sm">
        <Link href={qp({ tab: '' })} className={`-mb-px border-b-2 pb-2 ${tab === 'members' ? 'border-brand-teal font-medium text-brand-teal' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>Members</Link>
        <Link href={qp({ tab: 'assignments' })} className={`-mb-px border-b-2 pb-2 ${tab === 'assignments' ? 'border-brand-teal font-medium text-brand-teal' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>Assignments</Link>
      </div>

      {tab === 'assignments' ? (
        <AssignmentsTab accountId={accountId} />
      ) : (
        <>
          {canManage && <NewPersonForm entities={entities.map((e) => ({ id: e.id, name: e.name, code: e.code }))} />}

          {/* Week selector */}
          <div className="mb-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm">
            <Link href={weekQp(addDays(weekStart, -7))} className="rounded px-1.5 text-gray-500 hover:bg-gray-100">←</Link>
            <span className="text-gray-700">{isThisWeek ? 'This week' : 'Week of'} {fmtRange(weekStart, weekEndDisplay)}</span>
            <Link href={weekQp(addDays(weekStart, 7))} className="rounded px-1.5 text-gray-500 hover:bg-gray-100">→</Link>
          </div>

          {/* Summary band */}
          <div className="mb-5 flex flex-wrap items-center gap-x-10 gap-y-3 rounded-lg border border-gray-200 bg-white p-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">Total hours</div>
              <div className="text-2xl font-semibold">{hrs(sum.total)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">Team capacity</div>
              <div className="text-2xl font-semibold">{hrs(sum.cap)}</div>
            </div>
            <div className="min-w-[220px] flex-1">
              <div className="mb-1 flex justify-between text-xs">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-teal" />Billable <span className="font-medium text-gray-700">{hrs(sum.bill)}</span></span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-teal/40" />Non-billable <span className="font-medium text-gray-700">{hrs(sum.nonbill)}</span></span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
                <div className="flex h-full">
                  <div className="h-full bg-brand-teal" style={{ width: `${Math.min(100, teamUtilBill)}%` }} />
                  <div className="h-full bg-brand-teal/40" style={{ width: `${Math.min(100 - Math.min(100, teamUtilBill), teamUtilNon)}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <form className="mb-3 flex flex-wrap items-center gap-2">
            {searchParams.week && <input type="hidden" name="week" value={searchParams.week} />}
            <input name="q" defaultValue={q} placeholder="Filter by name" className="w-56 rounded border border-gray-300 px-3 py-1.5 text-sm" />
            <select name="role" defaultValue={role} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {showArchived && <input type="hidden" name="archived" value="1" />}
            <button className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Apply</button>
            {(q || role) && <Link href={qp({ q: '', role: '' })} className="text-sm text-gray-400 hover:text-gray-600">Clear</Link>}
            <Link href={showArchived ? qp({ archived: '' }) : qp({ archived: '1' })} className="ml-auto text-sm text-brand-teal hover:underline">
              {showArchived ? 'Hide inactive people' : `View archived people${archivedCount > 0 ? ` (${archivedCount})` : ''} →`}
            </Link>
          </form>

          <div className="overflow-visible rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3 font-medium">Employees ({rows.length})</th>
                  <th className="px-4 py-3 font-medium">Hours</th>
                  <th className="px-4 py-3 text-right font-medium">Utilization</th>
                  <th className="px-4 py-3 text-right font-medium">Capacity</th>
                  <th className="px-4 py-3 text-right font-medium">Billable</th>
                  {canManage && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ u, billMin, nonBillMin, total, capMin, util }) => {
                  const over = util > 100
                  const billW = capMin > 0 ? Math.min(100, (billMin / capMin) * 100) : 0
                  const nonW = capMin > 0 ? Math.min(Math.max(0, 100 - billW), (nonBillMin / capMin) * 100) : 0
                  return (
                    <tr key={u.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900">{u.firstName} {u.lastName}</span>
                        {u.homeEntity && <span className="ml-2"><EntityChip code={u.homeEntity.code} name={u.homeEntity.name} /></span>}
                        <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{PROFILE_LABEL[u.permissionProfile] ?? u.permissionProfile}</span>
                        {!u.isActive && <span className="ml-2 text-xs text-gray-400">(inactive)</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-12 tabular-nums text-gray-700">{hrs(total)}</span>
                          <span className="h-2 w-32 overflow-hidden rounded-full bg-gray-100">
                            <span className="flex h-full">
                              <span className="h-full" style={{ width: `${billW}%`, background: over ? '#c9342c' : '#004348' }} />
                              <span className="h-full" style={{ width: `${nonW}%`, background: over ? '#e59a95' : '#5fa8ac' }} />
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${over ? 'font-medium text-red-600' : 'text-gray-600'}`}>{capMin > 0 ? `${util}%` : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-500">{capMin > 0 ? hrs(capMin) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{hrs(billMin)}</td>
                      {canManage && (
                        <td className="px-4 py-3 text-right">
                          <details className="relative inline-block text-left">
                            <summary className="cursor-pointer list-none rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">Actions ▾</summary>
                            <div className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg">
                              <Link href={`/team/${u.id}`} className="block px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">Manage</Link>
                              <Link href={`/team/${u.id}?tab=rates`} className="block px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">Rates</Link>
                              <Link href={`/team/${u.id}?tab=permissions`} className="block px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">Permissions</Link>
                              <Link href={`/reports?group=teammate`} className="block px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">View in reports</Link>
                            </div>
                          </details>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={canManage ? 6 : 5} className="px-4 py-8 text-center text-gray-400">No people match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-400">Hours, utilization &amp; billable are for the selected week. Utilization = hours ÷ weekly capacity.</p>
        </>
      )}
    </div>
  )
}

/* ---------- Assignments tab: people grouped by permission profile ---------- */
async function AssignmentsTab({ accountId }: { accountId: string }) {
  const users = await prisma.user.findMany({
    where: { accountId, archivedAt: null, isActive: true },
    select: { id: true, firstName: true, lastName: true, permissionProfile: true },
    orderBy: [{ firstName: 'asc' }],
  })
  const byProfile = new Map<string, typeof users>()
  for (const u of users) {
    const arr = byProfile.get(u.permissionProfile) ?? []
    arr.push(u)
    byProfile.set(u.permissionProfile, arr)
  }
  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">Permission profiles and who holds them. Manage an individual&apos;s profile from their <span className="text-gray-700">Permissions</span> tab.</p>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Profile</th>
              <th className="px-4 py-3 font-medium">People</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(PROFILE_LABEL).map((key) => {
              const people = byProfile.get(key) ?? []
              if (people.length === 0) return null
              return (
                <tr key={key} className="border-b border-gray-100 last:border-0 align-top">
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-800">{PROFILE_LABEL[key]}</span>
                    <span className="ml-2 text-xs text-gray-400">{people.length}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {people.map((u) => (
                        <Link key={u.id} href={`/team/${u.id}?tab=permissions`} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700 hover:bg-gray-200">
                          {u.firstName} {u.lastName}
                        </Link>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-400">Roles &amp; departments (Harvest&apos;s other Assignments sub-tabs) aren&apos;t modeled yet — tracked as a follow-up.</p>
    </div>
  )
}
