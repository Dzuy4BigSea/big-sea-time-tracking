/**
 * Team overview (Harvest parity, specs/28-team-parity.md): the "Everyone" filter, pins, and the rules
 * for who may be assigned to a Manager. Pure functions; the page and actions do the DB work.
 */
import type { PermissionProfile } from '@/modules/shared/permissions'

/** One parsed value of the Team overview's `?role=` filter. */
export type TeamFilter =
  | { kind: 'everyone' }
  | { kind: 'pins' }
  | { kind: 'assigned' }
  | { kind: 'profile'; profile: PermissionProfile }
  | { kind: 'type'; type: 'employee' | 'contractor' }
  | { kind: 'role'; role: string }

const PROFILES: readonly PermissionProfile[] = [
  'member',
  'project_manager',
  'people_admin',
  'accounting',
  'executive_manager',
  'administrator',
]

/**
 * Harvest: "By default, Administrators will see everyone in the account while Managers will see only
 * their assigned people." So an empty filter means "assigned" for a Manager who has assigned people and
 * "everyone" otherwise. The explicit `everyone` value lets that Manager switch back.
 */
export function parseTeamFilter(raw: string | undefined | null, opts: { hasAssignedPeople: boolean }): TeamFilter {
  const v = (raw ?? '').trim()
  if (!v) return opts.hasAssignedPeople ? { kind: 'assigned' } : { kind: 'everyone' }
  if (v === 'everyone') return { kind: 'everyone' }
  if (v === 'pins') return { kind: 'pins' }
  if (v === 'assigned') return opts.hasAssignedPeople ? { kind: 'assigned' } : { kind: 'everyone' }
  if (v.startsWith('type:')) {
    const t = v.slice(5)
    if (t === 'employee' || t === 'contractor') return { kind: 'type', type: t }
    return { kind: 'everyone' }
  }
  if (v.startsWith('role:')) {
    const role = v.slice(5).trim()
    return role ? { kind: 'role', role } : { kind: 'everyone' }
  }
  if ((PROFILES as readonly string[]).includes(v)) return { kind: 'profile', profile: v as PermissionProfile }
  return { kind: 'everyone' }
}

export interface FilterOption {
  value: string
  label: string
  group?: string
}

/**
 * Options for the "Everyone" dropdown, in Harvest's order: Everyone, My pins, My assigned people
 * (Managers with assigned people only), then roles. Track2 also keeps its access-level and
 * Employee/Contractor filters below those. The option whose value is '' is the default.
 */
export function teamFilterOptions(opts: {
  hasAssignedPeople: boolean
  roles: readonly string[]
  profileLabels: Record<string, string>
}): FilterOption[] {
  const out: FilterOption[] = []
  if (opts.hasAssignedPeople) {
    out.push({ value: '', label: 'My assigned people' })
    out.push({ value: 'everyone', label: 'Everyone' })
  } else {
    out.push({ value: '', label: 'Everyone' })
  }
  out.push({ value: 'pins', label: 'My pins' })
  const roles = [...new Set(opts.roles.map((r) => r.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  for (const r of roles) out.push({ value: `role:${r}`, label: r, group: 'Roles' })
  for (const [value, label] of Object.entries(opts.profileLabels)) out.push({ value, label, group: 'Access level' })
  out.push({ value: 'type:employee', label: 'Employees', group: 'Type' })
  out.push({ value: 'type:contractor', label: 'Contractors', group: 'Type' })
  return out
}

/** The `?role=` value that selects `filter` (inverse of parseTeamFilter for the current viewer). */
export function teamFilterValue(filter: TeamFilter, opts: { hasAssignedPeople: boolean }): string {
  switch (filter.kind) {
    case 'everyone':
      return opts.hasAssignedPeople ? 'everyone' : ''
    case 'assigned':
      return ''
    case 'pins':
      return 'pins'
    case 'profile':
      return filter.profile
    case 'type':
      return `type:${filter.type}`
    case 'role':
      return `role:${filter.role}`
  }
}

/** Harvest moves pinned people to the top of the Team overview. Stable within each half. */
export function pinnedFirst<T extends { id: string }>(rows: readonly T[], pinned: ReadonlySet<string>): T[] {
  return [...rows.filter((r) => pinned.has(r.id)), ...rows.filter((r) => !pinned.has(r.id))]
}

/**
 * Who can hold assigned people. Harvest: "Team members with Manager permissions can be assigned a group
 * of people." In Track2 that is the Project Manager access level; the account-wide profiles
 * (Administrator, Executive Manager, People Admin) already see everyone, and Members and Accounting
 * have no time oversight.
 */
export function canHoldAssignedPeople(profile: PermissionProfile | string): boolean {
  return profile === 'project_manager'
}

export interface PersonLite {
  id: string
  name: string
  isActive: boolean
  type?: 'employee' | 'contractor'
}

/**
 * People offered in "Find and select people to assign…": active teammates other than the manager who
 * aren't assigned yet, alphabetical.
 */
export function assignableToManager<T extends PersonLite>(people: readonly T[], managerId: string, assigned: ReadonlySet<string>): T[] {
  return people
    .filter((p) => p.isActive && p.id !== managerId && !assigned.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Validate an "Assign people" submission: drops blanks, duplicates, the manager themself and ids not in
 * the account (`validIds`). Returns the ids to insert.
 */
export function cleanAssignIds(raw: readonly string[], managerId: string, validIds: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const r of raw.flatMap((x) => x.split(','))) {
    const id = r.trim()
    if (!id || id === managerId || !validIds.has(id) || out.includes(id)) continue
    out.push(id)
  }
  return out
}

/**
 * Archive guard (Harvest: "Administrators can Archive anyone except the Account Owner. You can't archive
 * yourself"). Returns an error message or null.
 */
export function archiveError(opts: { actorId: string; targetId: string; accountOwnerId: string | null }): string | null {
  if (opts.targetId === opts.actorId) return 'You can’t archive yourself.'
  if (opts.accountOwnerId && opts.targetId === opts.accountOwnerId) return 'The account owner can’t be archived.'
  return null
}
