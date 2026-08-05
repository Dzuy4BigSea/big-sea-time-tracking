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
