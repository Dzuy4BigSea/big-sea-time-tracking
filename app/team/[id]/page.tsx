import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { requireModule } from '@/lib/modules'
import {
  can,
  baseHas,
  baseScoped,
  ALL_PROFILES,
  ALL_CAPABILITIES,
  CAPABILITY_GROUPS,
  CAPABILITY_LABELS,
  PROFILE_LABELS,
  PROFILE_DESCRIPTIONS,
  type PermissionProfile,
  type PermissionOverrides,
  type Capability,
} from '@/modules/shared/permissions'
import { listEntities } from '@/lib/entities'
import { formatCents, formatDate } from '@/lib/format'
import { ymd } from '@/lib/week'
import { PersonBasicForm } from '@/components/PersonBasicForm'
import { PermissionsForm } from '@/components/PermissionsForm'
import { PersonSecurityForm } from '@/components/PersonSecurityForm'
import { AddRateForm } from '@/components/AddRateForm'
import {
  setAssignedToAllAction,
  assignProjectToPersonAction,
  unassignProjectFromPersonAction,
  toggleManagesProjectAction,
} from '@/app/team/actions'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'basic', label: 'Basic info' },
  { key: 'rates', label: 'Rates' },
  { key: 'projects', label: 'Assigned projects' },
  { key: 'people', label: 'Assigned people' },
  { key: 'permissions', label: 'Permissions' },
  { key: 'security', label: 'Security' },
] as const

export default async function TeamMemberPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { tab?: string }
}) {
  const { accountId, userId, permissionProfile, permissionOverrides } = await requireUser()
  await requireModule(accountId, 'team')
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_people')) redirect('/team')

  const [person, entities] = await Promise.all([
    prisma.user.findFirst({
      where: { id: params.id, accountId },
      select: {
        id: true, firstName: true, lastName: true, email: true, type: true,
        capacityHoursPerWeek: true, homeEntityId: true, isActive: true, assignedToAllProjects: true,
        permissionProfile: true, permissionOverrides: true,
        homeEntity: { select: { code: true, name: true } },
      },
    }),
    listEntities(accountId),
  ])
  if (!person) notFound()

  const tab = TABS.some((t) => t.key === searchParams.tab) ? searchParams.tab! : 'basic'
  const fullName = `${person.firstName} ${person.lastName}`.trim()
  const initials = `${person.firstName[0] ?? ''}${person.lastName[0] ?? ''}`.toUpperCase()
  const entityOpts = entities.map((e) => ({ id: e.id, name: e.name, code: e.code }))
  const actor = { permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }
  const canSetRates = can(actor, 'set_rates')
  const canViewCost = can(actor, 'view_cost_rates')

  // Per-tab data (fetched only for the active tab).
  const projectsData =
    tab === 'projects'
      ? await Promise.all([
          prisma.projectUserAssignment.findMany({
            where: { userId: person.id, isActive: true },
            include: { project: { select: { id: true, name: true, client: { select: { name: true } } } } },
          }),
          prisma.project.findMany({
            where: { accountId, userAssignments: { none: { userId: person.id, isActive: true } } },
            select: { id: true, name: true, client: { select: { name: true } } },
            orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
            take: 500,
          }),
        ]).then(([assignments, addable]) => ({ assignments, addable }))
      : null

  const ratesData =
    tab === 'rates'
      ? await Promise.all([
          prisma.personBillableRate.findMany({ where: { userId: person.id }, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }] }),
          canViewCost
            ? prisma.personCostRate.findMany({ where: { userId: person.id }, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }] })
            : Promise.resolve([]),
        ]).then(([billable, cost]) => ({ billable, cost }))
      : null

  const peopleData =
    tab === 'people'
      ? await (async () => {
          const mine = await prisma.projectUserAssignment.findMany({ where: { userId: person.id, isActive: true }, select: { projectId: true } })
          const ids = mine.map((m) => m.projectId)
          if (ids.length === 0) return [] as { id: string; name: string }[]
          const others = await prisma.projectUserAssignment.findMany({
            where: { projectId: { in: ids }, userId: { not: person.id }, isActive: true },
            select: { user: { select: { id: true, firstName: true, lastName: true } } },
          })
          const seen = new Map<string, { id: string; name: string }>()
          for (const o of others) seen.set(o.user.id, { id: o.user.id, name: `${o.user.firstName} ${o.user.lastName}`.trim() })
          return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
        })()
      : null

  return (
    <div>
      <Link href="/team" className="text-sm text-gray-500 hover:text-brand-teal">← Back to Team</Link>

      <div className="mb-6 mt-2 flex items-center gap-3">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-brand-teal-50 text-sm font-bold text-brand-teal">{initials}</span>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {fullName}
            {!person.isActive && <span className="text-sm font-normal text-gray-400">(inactive)</span>}
          </h1>
          <div className="text-sm text-gray-500">
            {person.email} · {PROFILE_LABELS[person.permissionProfile as PermissionProfile]}
            {person.homeEntity ? ` · ${person.homeEntity.name}` : ''}
          </div>
        </div>
      </div>

      <div className="flex gap-8">
        {/* Sub-nav */}
        <nav className="w-48 flex-none">
          <ul className="space-y-0.5 text-sm">
            {TABS.map((t) => (
              <li key={t.key}>
                <Link
                  href={`/team/${person.id}?tab=${t.key}`}
                  className={`block rounded-md px-3 py-2 ${tab === t.key ? 'bg-brand-teal-50 font-medium text-brand-teal' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Tab content */}
        <div className="min-w-0 flex-1">
          {tab === 'basic' && (
            <PersonBasicForm
              person={{
                id: person.id, firstName: person.firstName, lastName: person.lastName, email: person.email,
                type: person.type, capacityHoursPerWeek: person.capacityHoursPerWeek ? Number(person.capacityHoursPerWeek) : null,
                homeEntityId: person.homeEntityId,
              }}
              entities={entityOpts}
            />
          )}

          {tab === 'permissions' && (
            <PermissionsForm
              personId={person.id}
              initialProfile={person.permissionProfile}
              initialChecked={ALL_CAPABILITIES.filter((c) =>
                can({ permissionProfile: person.permissionProfile as PermissionProfile, permissionOverrides: person.permissionOverrides as PermissionOverrides | null }, c),
              )}
              profiles={ALL_PROFILES.map((p) => ({ value: p, label: PROFILE_LABELS[p], description: PROFILE_DESCRIPTIONS[p] }))}
              profileBase={Object.fromEntries(ALL_PROFILES.map((p) => [p, ALL_CAPABILITIES.filter((c) => baseHas(p, c))])) as Record<string, string[]>}
              scoped={Object.fromEntries(ALL_PROFILES.map((p) => [p, ALL_CAPABILITIES.filter((c) => baseScoped(p, c))])) as Record<string, string[]>}
              groups={CAPABILITY_GROUPS.map((g) => ({ heading: g.heading, capabilities: g.capabilities.map((c: Capability) => ({ key: c, label: CAPABILITY_LABELS[c] })) }))}
              selfEditingLocked={person.id === userId}
            />
          )}

          {tab === 'security' && (
            <PersonSecurityForm person={{ id: person.id, email: person.email, isActive: person.isActive }} />
          )}

          {tab === 'rates' && ratesData && (
            <div className="space-y-6">
              <div className="rounded-lg border border-gray-200 bg-white p-5">
                <h2 className="mb-1 text-sm font-semibold text-gray-800">Billable rate</h2>
                <p className="mb-3 text-xs text-gray-500">The hourly rate used when this person’s time is billed at the person level.</p>
                <RateHistory rows={ratesData.billable} />
                {canSetRates && <div className="mt-3 border-t border-gray-100 pt-3"><AddRateForm personId={person.id} kind="billable" todayYmd={ymd(new Date())} /></div>}
              </div>
              {canViewCost ? (
                <div className="rounded-lg border border-gray-200 bg-white p-5">
                  <h2 className="mb-1 text-sm font-semibold text-gray-800">Internal cost rate</h2>
                  <p className="mb-3 text-xs text-gray-500">What this person costs the business per hour (used for profitability). Admin-only.</p>
                  <RateHistory rows={ratesData.cost} />
                  {canSetRates && <div className="mt-3 border-t border-gray-100 pt-3"><AddRateForm personId={person.id} kind="cost" todayYmd={ymd(new Date())} /></div>}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">Internal cost rates are visible to administrators only.</div>
              )}
            </div>
          )}

          {tab === 'projects' && projectsData && (
            <div className="space-y-4">
              {person.assignedToAllProjects ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-teal-50 bg-brand-teal-50 p-4 text-sm text-brand-teal">
                  <span><strong>{person.firstName}</strong> is assigned to all projects — and all future ones.</span>
                  <form action={setAssignedToAllAction}>
                    <input type="hidden" name="id" value={person.id} />
                    <input type="hidden" name="value" value="off" />
                    <button className="rounded border border-brand-teal px-3 py-1 text-xs font-medium text-brand-teal hover:bg-white">Disable</button>
                  </form>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-gray-500">Assign this person to the projects they can track time to.</p>
                  <form action={setAssignedToAllAction}>
                    <input type="hidden" name="id" value={person.id} />
                    <input type="hidden" name="value" value="on" />
                    <button className="rounded border border-brand-green px-3 py-1.5 text-sm font-medium text-brand-green hover:bg-green-50">Assign to all projects</button>
                  </form>
                </div>
              )}

              {/* Assigned list */}
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                      <th className="px-4 py-2 font-medium">Project</th>
                      <th className="px-4 py-2 text-center font-medium">Manages</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {projectsData.assignments.map((a) => (
                      <tr key={a.id} className="border-b border-gray-100 last:border-0">
                        <td className="px-4 py-2">
                          <span className="text-gray-400">{a.project.client.name} · </span>
                          <Link href={`/projects/${a.project.id}`} className="text-gray-800 hover:text-brand-teal">{a.project.name}</Link>
                        </td>
                        <td className="px-4 py-2 text-center">
                          <form action={toggleManagesProjectAction}>
                            <input type="hidden" name="id" value={person.id} />
                            <input type="hidden" name="projectId" value={a.project.id} />
                            <button className={`rounded px-2 py-0.5 text-xs font-medium ${a.isProjectManager ? 'bg-brand-teal-50 text-brand-teal' : 'border border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                              {a.isProjectManager ? 'Manager ✓' : 'Make manager'}
                            </button>
                          </form>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <form action={unassignProjectFromPersonAction}>
                            <input type="hidden" name="id" value={person.id} />
                            <input type="hidden" name="projectId" value={a.project.id} />
                            <button className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-red-50 hover:text-red-600">Remove</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                    {projectsData.assignments.length === 0 && (
                      <tr><td colSpan={3} className="px-4 py-4 text-center text-gray-400">Not assigned to any projects yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Add a project */}
              {!person.assignedToAllProjects && projectsData.addable.length > 0 && (
                <form action={assignProjectToPersonAction} className="flex items-end gap-2">
                  <input type="hidden" name="id" value={person.id} />
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-wide text-gray-400">Add a project</span>
                    <select name="projectId" className="min-w-72 rounded border border-gray-300 px-2 py-1.5 text-sm">
                      {projectsData.addable.map((p) => (
                        <option key={p.id} value={p.id}>{p.client.name} · {p.name}</option>
                      ))}
                    </select>
                  </label>
                  <button className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Add</button>
                </form>
              )}
            </div>
          )}

          {tab === 'people' && peopleData && (
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <h2 className="mb-1 text-sm font-semibold text-gray-800">People they work with</h2>
              <p className="mb-3 text-xs text-gray-500">Teammates assigned to the same projects.</p>
              {peopleData.length === 0 ? (
                <p className="text-sm text-gray-400">No shared projects yet.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {peopleData.map((p) => (
                    <li key={p.id}>
                      <Link href={`/team/${p.id}`} className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700 hover:bg-brand-teal-50 hover:text-brand-teal">{p.name}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RateHistory({ rows }: { rows: { id: string; hourlyRateCents: number; startDate: Date | null }[] }) {
  if (rows.length === 0) return <p className="text-sm text-gray-400">No rate set yet.</p>
  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {rows.map((r, i) => (
        <li key={r.id} className="flex items-center justify-between py-1.5">
          <span className={i === 0 ? 'font-medium text-gray-800' : 'text-gray-500'}>
            {formatCents(r.hourlyRateCents)}/h
            {i === 0 && <span className="ml-2 text-[11px] uppercase tracking-wide text-brand-teal">current</span>}
          </span>
          <span className="text-xs text-gray-400">{r.startDate ? `from ${formatDate(r.startDate)}` : 'all time'}</span>
        </li>
      ))}
    </ul>
  )
}
