/**
 * Resolve whose timesheet the signed-in user is acting on (the /timesheet person switcher).
 *
 * The client may send a `user` / `forUserId`, but it is never trusted: every call re-checks
 * the target's account (INV-5) and the actor's `view_edit_others_time` scope via canActFor.
 */
import { prisma } from '@/lib/prisma'
import type { CurrentUser } from '@/lib/session'
import type { Actor, PermissionProfile } from '@/modules/shared/permissions'
import { isCapabilityScoped } from '@/modules/shared/permissions'
import { canActFor, canActForOthers, LOGGABLE_PROJECT_WHERE } from '@/modules/time/actingFor'

export function actorOf(u: CurrentUser): Actor {
  return { permissionProfile: u.permissionProfile as PermissionProfile, permissionOverrides: u.permissionOverrides }
}

/** Active assignments on projects where `managerId` is an active project manager. */
function managedAssignmentWhere(accountId: string, managerId: string) {
  return {
    accountId,
    isActive: true,
    project: { accountId, userAssignments: { some: { userId: managerId, isProjectManager: true, isActive: true } } },
  }
}

/**
 * True when `current` may act for `targetUserId` (self always; others per canActFor).
 * One small indexed lookup per check; no time-entry scans.
 */
export async function mayActFor(current: CurrentUser, targetUserId: string): Promise<boolean> {
  if (!targetUserId) return false
  if (targetUserId === current.userId) return true
  const actor = actorOf(current)
  if (!canActForOthers(actor)) return false
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { accountId: true } })
  const scoped = isCapabilityScoped(actor, 'view_edit_others_time')
  const targetIsManaged =
    scoped && target?.accountId === current.accountId
      ? (await prisma.projectUserAssignment.count({
          where: { ...managedAssignmentWhere(current.accountId, current.userId), userId: targetUserId },
        })) > 0
      : false
  return canActFor({
    actor,
    actorUserId: current.userId,
    actorAccountId: current.accountId,
    targetUserId,
    targetAccountId: target?.accountId ?? null,
    targetIsManaged,
  })
}

/**
 * Project ids where a scoped actor (project manager) is an active PM, or null when the actor's
 * `view_edit_others_time` is account-wide. A PM may only touch someone else's time on these.
 */
export async function managedProjectIdsFor(current: CurrentUser): Promise<Set<string> | null> {
  if (!isCapabilityScoped(actorOf(current), 'view_edit_others_time')) return null
  const rows = await prisma.projectUserAssignment.findMany({
    where: { accountId: current.accountId, userId: current.userId, isProjectManager: true, isActive: true },
    select: { projectId: true },
  })
  return new Set(rows.map((r) => r.projectId))
}

/**
 * mayActFor narrowed to one project: a project manager may act for someone only on projects they
 * manage, not on every project that person is on.
 */
export async function mayActForOnProject(current: CurrentUser, targetUserId: string, projectId: string): Promise<boolean> {
  if (targetUserId === current.userId) return true
  if (!(await mayActFor(current, targetUserId))) return false
  const managed = await managedProjectIdsFor(current)
  return managed === null || managed.has(projectId)
}

/**
 * The user id an action should operate on: the requested one if permitted, otherwise null.
 * An empty request means "myself".
 */
export async function resolveSubjectUserId(current: CurrentUser, requested: string | null | undefined): Promise<string | null> {
  const want = (requested ?? '').trim()
  if (!want || want === current.userId) return current.userId
  return (await mayActFor(current, want)) ? want : null
}

export interface PersonOption {
  id: string
  name: string
}

/**
 * People the actor may switch to on /timesheet (active members only), self first.
 * Empty when the actor lacks `view_edit_others_time` — the switcher is then hidden.
 */
export async function listActablePeople(current: CurrentUser): Promise<PersonOption[]> {
  const actor = actorOf(current)
  if (!canActForOthers(actor)) return []
  const scoped = isCapabilityScoped(actor, 'view_edit_others_time')
  const people = await prisma.user.findMany({
    where: {
      accountId: current.accountId,
      isActive: true,
      ...(scoped
        ? {
            OR: [
              { id: current.userId },
              { projectAssignments: { some: managedAssignmentWhere(current.accountId, current.userId) } },
            ],
          }
        : {}),
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  })
  const opts = people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim() }))
  const self = opts.filter((p) => p.id === current.userId)
  return [...self, ...opts.filter((p) => p.id !== current.userId)]
}

export interface LoggableProjectOption {
  id: string
  name: string
  code: string | null
  tasks: { id: string; name: string }[]
}

/**
 * Projects (with active, non-archived tasks) `userId` may log time against: their active assignments on
 * active projects of active clients (BugHerd #1). Shared by the timesheet and the top bar.
 */
export async function loggableProjectsFor(userId: string): Promise<LoggableProjectOption[]> {
  const assignments = await prisma.projectUserAssignment.findMany({
    where: { userId, isActive: true, project: LOGGABLE_PROJECT_WHERE },
    select: {
      project: {
        select: {
          id: true,
          name: true,
          code: true,
          taskAssignments: { where: { isActive: true, task: { isActive: true } }, select: { task: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: { project: { name: 'asc' } },
  })
  return assignments.map((a) => ({
    id: a.project.id,
    name: a.project.name,
    code: a.project.code,
    tasks: a.project.taskAssignments.map((ta) => ta.task),
  }))
}
