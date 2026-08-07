/**
 * Permission layer (specs/02-auth-accounts.md §Permission model).
 *
 * Pure capability predicate over the 6 base profiles, layered with per-user overrides.
 * The service layer calls `can()` on every mutating action (defense in depth — the UI
 * hiding a control is never the only guard). Account-wide capabilities live here; a few
 * capabilities are *resource-scoped* for some profiles (e.g. a Project Manager only over
 * their own projects) — see `capabilityScope` and enforce ownership at the resource layer.
 */

export type PermissionProfile =
  | 'member'
  | 'project_manager'
  | 'people_admin'
  | 'accounting'
  | 'executive_manager'
  | 'administrator'

export type Capability =
  | 'edit_account_settings'
  | 'manage_people'
  | 'view_billable_rates'
  | 'view_cost_rates'
  | 'set_rates'
  | 'manage_clients'
  | 'manage_projects'
  | 'manage_tasks'
  | 'track_own_time'
  | 'view_edit_others_time'
  | 'approve_timesheets'
  | 'manage_invoices'
  | 'run_account_reports'

/** Base capabilities granted by each profile (from the spec matrix). */
const PROFILE_CAPABILITIES: Record<PermissionProfile, ReadonlySet<Capability>> = {
  member: new Set(['track_own_time']),
  project_manager: new Set([
    'track_own_time',
    'manage_clients',
    'manage_projects',
    'manage_tasks',
    'view_edit_others_time', // scoped: their team
    'approve_timesheets', // scoped: their projects
  ]),
  people_admin: new Set([
    'track_own_time',
    'manage_people',
    'view_edit_others_time',
    'approve_timesheets',
  ]),
  accounting: new Set([
    'track_own_time',
    'manage_clients',
    'view_billable_rates',
    'manage_invoices',
    'run_account_reports',
  ]),
  executive_manager: new Set([
    'track_own_time',
    'manage_people',
    'manage_clients',
    'manage_projects',
    'manage_tasks',
    'view_edit_others_time',
    'approve_timesheets',
    'view_billable_rates',
    'manage_invoices',
    'run_account_reports',
  ]),
  administrator: new Set([
    'edit_account_settings',
    'manage_people',
    'view_billable_rates',
    'view_cost_rates',
    'set_rates',
    'manage_clients',
    'manage_projects',
    'manage_tasks',
    'track_own_time',
    'view_edit_others_time',
    'approve_timesheets',
    'manage_invoices',
    'run_account_reports',
  ]),
}

/** Capabilities that are resource-scoped (not account-wide) for the given profile. */
const SCOPED_FOR: Partial<Record<PermissionProfile, ReadonlySet<Capability>>> = {
  project_manager: new Set(['view_edit_others_time', 'approve_timesheets']),
}

/** Per-user overrides layered on the base profile (from User.permissionOverrides). */
export interface PermissionOverrides {
  grant?: Capability[]
  revoke?: Capability[]
}

export interface Actor {
  permissionProfile: PermissionProfile
  permissionOverrides?: PermissionOverrides | null
}

/**
 * Does this actor hold `capability` account-wide? Overrides win over the base profile.
 * For scoped capabilities this returns whether the actor has it *at all*; the caller must
 * still verify resource ownership (see isCapabilityScoped).
 */
export function can(actor: Actor, capability: Capability): boolean {
  const ov = actor.permissionOverrides
  if (ov?.revoke?.includes(capability)) return false
  if (ov?.grant?.includes(capability)) return true
  return PROFILE_CAPABILITIES[actor.permissionProfile].has(capability)
}

/** Is this capability resource-scoped (e.g. "own projects only") for the actor's profile? */
export function isCapabilityScoped(actor: Actor, capability: Capability): boolean {
  return SCOPED_FOR[actor.permissionProfile]?.has(capability) ?? false
}

// ---------------------------------------------------------------------------
// Metadata + override math for the team-member Permissions tab (specs/16/17)
// ---------------------------------------------------------------------------

export const ALL_PROFILES: PermissionProfile[] = [
  'administrator',
  'executive_manager',
  'accounting',
  'people_admin',
  'project_manager',
  'member',
]

export const PROFILE_LABELS: Record<PermissionProfile, string> = {
  administrator: 'Administrator',
  executive_manager: 'Executive Manager',
  accounting: 'Accounting',
  people_admin: 'People Admin',
  project_manager: 'Project Manager',
  member: 'Member',
}

export const PROFILE_DESCRIPTIONS: Record<PermissionProfile, string> = {
  administrator: 'Full access to everything, including account settings and rates.',
  executive_manager: 'Manages projects, people, clients, invoices and reports — no account settings.',
  accounting: 'Clients, invoices, billable rates and reports.',
  people_admin: 'Manages team members and approves time.',
  project_manager: 'Manages their own projects, clients and tasks; approves their teams’ time.',
  member: 'Tracks their own time and expenses on assigned projects.',
}

/** Ordered capability list, grouped for the Permissions tab (Harvest-style ability toggles). */
export const CAPABILITY_GROUPS: { heading: string; capabilities: Capability[] }[] = [
  { heading: 'Projects & clients', capabilities: ['manage_projects', 'manage_tasks', 'manage_clients'] },
  { heading: 'Time', capabilities: ['track_own_time', 'view_edit_others_time', 'approve_timesheets'] },
  { heading: 'People', capabilities: ['manage_people'] },
  { heading: 'Money & reports', capabilities: ['manage_invoices', 'view_billable_rates', 'view_cost_rates', 'set_rates', 'run_account_reports'] },
  { heading: 'Account', capabilities: ['edit_account_settings'] },
]

export const ALL_CAPABILITIES: Capability[] = CAPABILITY_GROUPS.flatMap((g) => g.capabilities)

export const CAPABILITY_LABELS: Record<Capability, string> = {
  edit_account_settings: 'Manage account settings',
  manage_people: 'Manage team members',
  view_billable_rates: 'See billable rates & amounts',
  view_cost_rates: 'See internal cost rates',
  set_rates: 'Set people’s rates',
  manage_clients: 'Manage clients',
  manage_projects: 'Create & edit projects',
  manage_tasks: 'Manage tasks',
  track_own_time: 'Track own time & expenses',
  view_edit_others_time: 'See & edit others’ time',
  approve_timesheets: 'Approve timesheets',
  manage_invoices: 'Manage invoices, estimates & payments',
  run_account_reports: 'Run account-wide reports',
}

/** Whether a base profile grants a capability (before overrides) — for rendering defaults. */
export function baseHas(profile: PermissionProfile, capability: Capability): boolean {
  return PROFILE_CAPABILITIES[profile].has(capability)
}

/** Whether a base profile grants the capability only within a scope (e.g. own projects). */
export function baseScoped(profile: PermissionProfile, capability: Capability): boolean {
  return SCOPED_FOR[profile]?.has(capability) ?? false
}

/**
 * Given a chosen profile and the set of capabilities an admin ticked, derive the minimal
 * grant/revoke overrides vs. the profile's defaults. Pure + testable.
 */
export function computeOverrides(profile: PermissionProfile, checked: Capability[]): PermissionOverrides {
  const on = new Set(checked)
  const grant: Capability[] = []
  const revoke: Capability[] = []
  for (const cap of ALL_CAPABILITIES) {
    const base = baseHas(profile, cap)
    if (on.has(cap) && !base) grant.push(cap)
    if (!on.has(cap) && base) revoke.push(cap)
  }
  const out: PermissionOverrides = {}
  if (grant.length) out.grant = grant
  if (revoke.length) out.revoke = revoke
  return out
}
