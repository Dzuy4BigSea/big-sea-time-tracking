import Link from 'next/link'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { getAccountClock } from '@/lib/accountClock'
import { todayIn } from '@/lib/tz'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { requireModule } from '@/lib/modules'
import { NewPersonForm } from '@/components/NewPersonForm'
import { EntityChip } from '@/components/EntitySelect'
import { LiveSearchInput, LiveSelect } from '@/components/LiveFilters'
import { DropdownMenu } from '@/components/DropdownMenu'
import { listEntities } from '@/lib/entities'
import { startOfWeek, addDays, ymd, parseYmd } from '@/lib/week'
import { groupTeammates } from '@/lib/teammates'
import { canHoldAssignedPeople, parseTeamFilter, pinnedFirst, teamFilterOptions, type TeamFilter } from '@/modules/team/teamOverview'
import { togglePinAction, setPersonArchivedAction } from '@/app/team/actions'

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

/** Prisma `where` for one Everyone-dropdown choice (specs/28 AC-TEAM-003). */
function filterWhere(f: TeamFilter, ctx: { pinned: string[]; assigned: string[] }): Prisma.UserWhereInput {
  switch (f.kind) {
    case 'everyone':
      return {}
    case 'pins':
      return { id: { in: ctx.pinned } }
    case 'assigned':
      return { id: { in: ctx.assigned } }
    case 'profile':
      return { permissionProfile: f.profile }
    case 'type':
      return { type: f.type }
    case 'role':
      return { roleTags: { has: f.role } }
  }
}

const menuItem = 'block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50'

export default async function TeamPage({
  searchParams,
}: {
  searchParams: { tab?: string; q?: string; role?: string; archived?: string; week?: string }
}) {
  const { userId: selfId, accountId, permissionProfile, permissionOverrides } = await requireUser()
  await requireModule(accountId, 'team')
  const canManage = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_people')

  const tab = searchParams.tab === 'assignments' ? 'assignments' : 'members'
  const showArchived = searchParams.archived === '1'
  const q = (searchParams.q ?? '').trim()
  const role = searchParams.role ?? ''

  const { weekStartsOn, timezone } = await getAccountClock(accountId)
  const today = todayIn(timezone) // the account's calendar day, not the server's UTC day
  const weekStart = startOfWeek(parseYmd(searchParams.week) ?? today, weekStartsOn)
  const weekEnd = addDays(weekStart, 7) // exclusive
  const weekEndDisplay = addDays(weekStart, 6)
  const isThisWeek = ymd(weekStart) === ymd(startOfWeek(today, weekStartsOn))

  // The viewer's pins and (for a Manager) assigned people drive the Everyone dropdown and its default.
  const [pins, myAssignments, roleRows] = await Promise.all([
    prisma.teamPin.findMany({ where: { accountId, userId: selfId }, select: { pinnedUserId: true } }),
    canHoldAssignedPeople(permissionProfile)
      ? prisma.managerAssignment.findMany({ where: { accountId, managerId: selfId }, select: { userId: true } })
      : Promise.resolve([] as { userId: string }[]),
    prisma.$queryRaw<{ role: string }[]>`SELECT DISTINCT unnest("roleTags") AS role FROM "User" WHERE "accountId" = ${accountId}`,
  ])
  const pinnedIds = pins.map((p) => p.pinnedUserId)
  const pinnedSet = new Set(pinnedIds)
  const assignedIds = myAssignments.map((a) => a.userId)
  const hasAssignedPeople = assignedIds.length > 0
  const filter = parseTeamFilter(role, { hasAssignedPeople })
  const filterOptions = teamFilterOptions({ hasAssignedPeople, roles: roleRows.map((r) => r.role), profileLabels: PROFILE_LABEL })
  const filterActive = role !== '' && !(role === 'everyone' && hasAssignedPeople)

  const [users, activeCount, archivedCount, entities, weekAgg, running] = await Promise.all([
    prisma.user.findMany({
      where: {
        accountId,
        archivedAt: null,
        isActive: !showArchived,
        ...(showArchived ? {} : filterWhere(filter, { pinned: pinnedIds, assigned: assignedIds })),
        ...(q ? { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      select: { id: true, firstName: true, lastName: true, permissionProfile: true, type: true, capacityHoursPerWeek: true, isActive: true, homeEntity: { select: { code: true, name: true } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    }),
    prisma.user.count({ where: { accountId, archivedAt: null, isActive: true } }),
    prisma.user.count({ where: { accountId, archivedAt: null, isActive: false } }),
    listEntities(accountId),
    showArchived
      ? Promise.resolve([])
      : prisma.timeEntry.groupBy({
          by: ['userId', 'isBillable'],
          where: { accountId, spentDate: { gte: weekStart, lt: weekEnd } },
          _sum: { minutes: true },
        }),
    // Harvest's orange dot: who has a timer running right now (at most one per user, partial unique index).
    prisma.timeEntry.findMany({ where: { accountId, isRunning: true }, select: { userId: true } }),
  ])
  const runningSet = new Set(running.map((r) => r.userId))

  // userId → { billable, nonBillable } minutes for the selected week.
  const weekBy = new Map<string, { b: number; n: number }>()
  for (const r of weekAgg) {
    const cur = weekBy.get(r.userId) ?? { b: 0, n: 0 }
    if (r.isBillable) cur.b += r._sum.minutes ?? 0
    else cur.n += r._sum.minutes ?? 0
    weekBy.set(r.userId, cur)
  }

  const rows = pinnedFirst(
    users.map((u) => {
      const wk = weekBy.get(u.id) ?? { b: 0, n: 0 }
      const total = wk.b + wk.n
      const capMin = u.capacityHoursPerWeek ? Number(u.capacityHoursPerWeek) * 60 : 0
      const util = capMin > 0 ? Math.round((total / capMin) * 100) : 0
      return { id: u.id, name: `${u.firstName} ${u.lastName}`, type: u.type, u, billMin: wk.b, nonBillMin: wk.n, total, capMin, util }
    }),
    pinnedSet,
  )
  // Harvest splits the list into Employees then Contractors when both kinds of teammate are present.
  // Order within each group is the query's order (pinned people first), so filters still apply per group.
  const groups = groupTeammates(rows)
  const sectioned = groups.length > 1
  const colCount = 6
  const sum = rows.reduce((a, r) => ({ total: a.total + r.total, bill: a.bill + r.billMin, nonbill: a.nonbill + r.nonBillMin, cap: a.cap + r.capMin }), { total: 0, bill: 0, nonbill: 0, cap: 0 })
  const teamUtilBill = sum.cap > 0 ? (sum.bill / sum.cap) * 100 : 0
  const teamUtilNon = sum.cap > 0 ? (sum.nonbill / sum.cap) * 100 : 0

  const qp = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(tab !== 'members' ? { tab } : {}), ...(q ? { q } : {}), ...(role ? { role } : {}), ...(showArchived ? { archived: '1' } : {}), ...(searchParams.week ? { week: searchParams.week } : {}), ...over })
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k)
    const s = p.toString()
    return s ? `/team?${s}` : '/team'
  }
  const weekQp = (d: Date) => qp({ week: ymd(d) })

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Team</h1>
      <p className="mb-4 text-sm text-gray-500">
        {activeCount} active {activeCount === 1 ? 'person' : 'people'}{archivedCount > 0 && ` · ${archivedCount} archived`}
      </p>

      {/* Members / Assignments tabs */}
      <div className="mb-5 flex gap-6 border-b border-gray-200 text-sm">
        <Link href={qp({ tab: '' })} className={`-mb-px border-b-2 pb-2 ${tab === 'members' ? 'border-brand-teal font-medium text-brand-teal' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>Members</Link>
        <Link href={qp({ tab: 'assignments' })} className={`-mb-px border-b-2 pb-2 ${tab === 'assignments' ? 'border-brand-teal font-medium text-brand-teal' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>Assignments</Link>
      </div>

      {tab === 'assignments' ? (
        <AssignmentsTab accountId={accountId} />
      ) : showArchived ? (
        <ArchivedPeople
          people={users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), profile: PROFILE_LABEL[u.permissionProfile] ?? u.permissionProfile }))}
          canManage={canManage}
          backHref={qp({ archived: '' })}
        />
      ) : (
        <>
          {canManage && <NewPersonForm entities={entities.map((e) => ({ id: e.id, name: e.name, code: e.code }))} />}

          {/* Week selector (Harvest: arrows, then "Return to this week" once you leave it) */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm">
              <Link href={weekQp(addDays(weekStart, -7))} aria-label="Previous week" className="rounded px-1.5 text-gray-500 hover:bg-gray-100">←</Link>
              <span className="text-gray-700">{isThisWeek ? 'This week' : 'Week of'} {fmtRange(weekStart, weekEndDisplay)}</span>
              <Link href={weekQp(addDays(weekStart, 7))} aria-label="Next week" className="rounded px-1.5 text-gray-500 hover:bg-gray-100">→</Link>
            </div>
            {!isThisWeek && <Link href={qp({ week: '' })} className="text-sm text-blue-600 underline hover:no-underline">Return to this week</Link>}
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

          {/* Filters (apply live; no Apply button). The first dropdown is Harvest's "Everyone" filter. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <LiveSearchInput param="q" placeholder="Filter by name" className="w-56 rounded border border-gray-300 px-3 py-1.5 text-sm" />
            <LiveSelect param="role" options={filterOptions} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
            {(q || filterActive) && <Link href={qp({ q: '', role: '' })} className="text-sm text-gray-400 hover:text-gray-600">Clear</Link>}
            {archivedCount > 0 && (
              <Link href={qp({ archived: '1' })} className="ml-auto rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                View archived people ({archivedCount})
              </Link>
            )}
          </div>

          <div className="overflow-visible rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3 font-medium">{sectioned ? `Name (${rows.length})` : `${groups[0]?.label ?? 'Employees'} (${rows.length})`}</th>
                  <th className="px-4 py-3 font-medium">Hours</th>
                  <th className="px-4 py-3 text-right font-medium">Utilization</th>
                  <th className="px-4 py-3 text-right font-medium">Capacity</th>
                  <th className="px-4 py-3 text-right font-medium">Billable</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => [
                  sectioned && (
                    <tr key={`section-${g.label}`} className="border-b border-gray-200 bg-gray-50">
                      <th colSpan={colCount} scope="colgroup" className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                        {g.label} <span className="font-normal text-gray-400">({g.people.length})</span>
                      </th>
                    </tr>
                  ),
                  ...g.people.map(({ u, billMin, nonBillMin, total, capMin, util }) => {
                  const over = util > 100
                  const billW = capMin > 0 ? Math.min(100, (billMin / capMin) * 100) : 0
                  const nonW = capMin > 0 ? Math.min(Math.max(0, 100 - billW), (nonBillMin / capMin) * 100) : 0
                  const isRunning = runningSet.has(u.id)
                  const isPinned = pinnedSet.has(u.id)
                  const fullName = `${u.firstName} ${u.lastName}`
                  return (
                    <tr key={u.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span
                          className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${isRunning ? 'bg-brand-orange' : 'bg-gray-300'}`}
                          title={isRunning ? 'Timer running' : 'No timer running'}
                          aria-label={isRunning ? 'Timer running' : undefined}
                        />
                        {canManage ? (
                          <Link href={`/team/${u.id}`} className="font-medium text-gray-900 hover:text-brand-teal">{fullName}</Link>
                        ) : (
                          <span className="font-medium text-gray-900">{fullName}</span>
                        )}
                        {isPinned && <span className="ml-1.5 text-xs text-gray-400" title="Pinned">📌</span>}
                        {u.homeEntity && <span className="ml-2"><EntityChip code={u.homeEntity.code} name={u.homeEntity.name} /></span>}
                        {u.permissionProfile !== 'member' && (
                          <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{PROFILE_LABEL[u.permissionProfile] ?? u.permissionProfile}</span>
                        )}
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
                      <td className="px-4 py-3 text-right">
                        <DropdownMenu label="Actions ▾">
                          {canManage && <Link href={`/team/${u.id}`} className={menuItem}>Edit</Link>}
                          <form action={togglePinAction}>
                            <input type="hidden" name="userId" value={u.id} />
                            <button className={menuItem}>{isPinned ? 'Unpin' : 'Pin'}</button>
                          </form>
                          {canManage && <Link href={`/team/${u.id}?tab=rates`} className={menuItem}>Rates</Link>}
                          {canManage && <Link href={`/team/${u.id}?tab=permissions`} className={menuItem}>Permissions</Link>}
                          <Link href={`/reports?group=teammate`} className={menuItem}>View in reports</Link>
                          {canManage && u.id !== selfId && (
                            <form action={setPersonArchivedAction} className="border-t border-gray-100">
                              <input type="hidden" name="userId" value={u.id} />
                              <input type="hidden" name="archive" value="1" />
                              <button className={`${menuItem} text-red-600`}>Archive</button>
                            </form>
                          )}
                        </DropdownMenu>
                      </td>
                    </tr>
                  )
                  }),
                ])}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-8 text-center text-gray-400">
                      {filter.kind === 'pins' ? 'You haven’t pinned anyone yet. Use Actions → Pin on a teammate.' : 'No people match.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Hours, utilization &amp; billable are for the selected week. Utilization = hours ÷ weekly capacity. An orange dot means a timer is running.
          </p>
        </>
      )}
    </div>
  )
}

/* ---------- View archived people (Harvest: list with Restore) ---------- */
function ArchivedPeople({ people, canManage, backHref }: { people: { id: string; name: string; profile: string }[]; canManage: boolean; backHref: string }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Archived people ({people.length})</h2>
        <Link href={backHref} className="text-sm text-brand-teal hover:underline">← Back to active people</Link>
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="px-4 py-3">
                  {canManage ? <Link href={`/team/${p.id}`} className="font-medium text-gray-800 hover:text-brand-teal">{p.name}</Link> : <span className="font-medium text-gray-800">{p.name}</span>}
                  <span className="ml-2 text-xs text-gray-400">{p.profile}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  {canManage && (
                    <form action={setPersonArchivedAction}>
                      <input type="hidden" name="userId" value={p.id} />
                      <input type="hidden" name="archive" value="0" />
                      <button className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">Restore</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {people.length === 0 && (
              <tr><td className="px-4 py-8 text-center text-gray-400">No archived people.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">Archived people can’t sign in; their time and expenses stay in reports and invoices. Restoring doesn’t re-add them to projects.</p>
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
