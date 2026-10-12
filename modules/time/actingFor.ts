/**
 * Acting on another person's timesheet (Harvest "view & edit others' time").
 *
 * Pure rules for (a) which projects a time entry may be logged against and (b) whether an actor
 * may view/log/edit time on behalf of another person. The server actions and the timesheet page
 * resolve the DB facts (target's account, the actor's managed people) and defer to these.
 *
 * Scope (specs/02 permission model): `view_edit_others_time` is account-wide for
 * administrator / executive_manager / people_admin (or a per-user grant), and resource-scoped
 * for project_manager: a PM may act only for people assigned to a project they manage
 * (ProjectUserAssignment.isProjectManager on an active assignment).
 */
import { can, isCapabilityScoped, type Actor } from '@/modules/shared/permissions'

// ---------------------------------------------------------------------------
// Loggable projects (BugHerd #1: archived projects are not offered / accepted)
// ---------------------------------------------------------------------------

/**
 * Prisma `where` for a Project that can take new time: active, not archived, and its client is
 * active too (archiving a client hides its projects from the time-entry pickers).
 */
export const LOGGABLE_PROJECT_WHERE = {
  isActive: true,
  archivedAt: null,
  client: { isActive: true, archivedAt: null },
} as const

export interface LoggableProjectFacts {
  accountId: string
  isActive: boolean
  archivedAt: Date | null
  client: { isActive: boolean; archivedAt: Date | null }
}

/**
 * Why time can't be logged to this project, or null if it can. Checks tenancy (INV-5) and the
 * archived state of the project and its client.
 */
export function loggableProjectError(project: LoggableProjectFacts | null, accountId: string): string | null {
  if (!project || project.accountId !== accountId) return 'Project not found.'
  if (!project.isActive || project.archivedAt) return 'This project is archived. Pick an active project.'
  if (!project.client.isActive || project.client.archivedAt) return 'This project’s client is archived. Pick an active project.'
  return null
}

// ---------------------------------------------------------------------------
// Acting on behalf of another person (BugHerd #2)
// ---------------------------------------------------------------------------

/** May this actor see the person switcher at all (i.e. act for anyone besides themself)? */
export function canActForOthers(actor: Actor): boolean {
  return can(actor, 'view_edit_others_time')
}

export interface ActForInput {
  actor: Actor
  actorUserId: string
  actorAccountId: string
  targetUserId: string
  /** The target's account, or null if no such user. Must equal the actor's (INV-5). */
  targetAccountId: string | null
  /**
   * For a scoped actor (project manager): is the target on a project the actor manages?
   * Ignored for unscoped actors.
   */
  targetIsManaged: boolean
}

/**
 * Can the actor view/log/edit time for `targetUserId`? Self is always allowed (the existing
 * own-timesheet behavior). Anyone else requires `view_edit_others_time`, the same account, and —
 * when the capability is scoped for the actor's profile — that the target is on a project the
 * actor manages.
 */
export function canActFor(input: ActForInput): boolean {
  if (input.targetAccountId === null || input.targetAccountId !== input.actorAccountId) return false
  if (input.targetUserId === input.actorUserId) return true
  if (!canActForOthers(input.actor)) return false
  if (isCapabilityScoped(input.actor, 'view_edit_others_time')) return input.targetIsManaged
  return true
}
