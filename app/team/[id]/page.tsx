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
import { PersonBasicForm } from '@/components/PersonBasicForm'
import { PermissionsForm } from '@/components/PermissionsForm'

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
        capacityHoursPerWeek: true, homeEntityId: true, isActive: true,
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

          {(tab === 'rates' || tab === 'projects' || tab === 'people' || tab === 'security') && (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-500">
              <div className="mb-1 font-medium text-gray-700">{TABS.find((t) => t.key === tab)!.label}</div>
              This tab is coming next. Basic info and Permissions are ready now.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
