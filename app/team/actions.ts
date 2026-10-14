'use server'

import { revalidatePath } from 'next/cache'
import bcrypt from 'bcryptjs'
import type { PermissionProfile as DbProfile, UserType as DbUserType } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import {
  can,
  checkAccessChange,
  checkSecurityChange,
  computeOverrides,
  ALL_CAPABILITIES,
  PROFILE_LABELS,
  type Capability,
  type PermissionOverrides,
  type PermissionProfile,
} from '@/modules/shared/permissions'
import { validEntityId } from '@/lib/entities'
import { writeAudit } from '@/lib/audit'
import { archiveError, canHoldAssignedPeople, cleanAssignIds } from '@/modules/team/teamOverview'
import { parseEmployeeId, parseRoleTags, parseTimezone } from '@/modules/team/personBasic'

export type NewPersonState = { error?: string; ok?: boolean }
export type EditPersonState = { error?: string; ok?: boolean }

const PROFILES: DbProfile[] = [
  'member',
  'project_manager',
  'people_admin',
  'accounting',
  'executive_manager',
  'administrator',
]
const TYPES: DbUserType[] = ['employee', 'contractor']

export async function createPersonAction(_prev: NewPersonState, formData: FormData): Promise<NewPersonState> {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_people')) {
    return { error: 'You do not have permission to add people.' }
  }

  const firstName = String(formData.get('firstName') ?? '').trim()
  const lastName = String(formData.get('lastName') ?? '').trim()
  const email = String(formData.get('email') ?? '').toLowerCase().trim()
  const profileRaw = String(formData.get('profile') ?? 'member') as DbProfile
  const profile = PROFILES.includes(profileRaw) ? profileRaw : 'member'
  const typeRaw = String(formData.get('type') ?? 'employee') as DbUserType
  const type = TYPES.includes(typeRaw) ? typeRaw : 'employee'
  const password = String(formData.get('password') ?? '')
  const capRaw = Number(String(formData.get('capacity') ?? ''))
  const capacityHoursPerWeek = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : null

  if (!firstName) return { error: 'First name is required.' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email.' }
  if (password.length < 8) return { error: 'Initial password must be at least 8 characters.' }

  const accessError = checkAccessChange(
    { permissionProfile: permissionProfile as PermissionProfile, permissionOverrides },
    null,
    { permissionProfile: profile },
  )
  if (accessError) return { error: accessError }

  const homeEntityId = await validEntityId(accountId, String(formData.get('homeEntityId') ?? ''))
  try {
    await prisma.user.create({
      data: {
        accountId,
        email,
        passwordHash: bcrypt.hashSync(password, 10),
        firstName,
        lastName,
        permissionProfile: profile,
        type,
        capacityHoursPerWeek,
        homeEntityId,
      },
    })
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') {
      return { error: 'A user with that email already exists in this account.' }
    }
    return { error: 'Could not create the user.' }
  }

  revalidatePath('/team')
  return { ok: true }
}

/** Basic info tab — name, type, capacity, home company (specs/17 team detail). */
export async function updatePersonBasicAction(_prev: EditPersonState, formData: FormData): Promise<EditPersonState> {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_people')) {
    return { error: 'You do not have permission to edit people.' }
  }
  const id = String(formData.get('id') ?? '')
  const firstName = String(formData.get('firstName') ?? '').trim()
  const lastName = String(formData.get('lastName') ?? '').trim()
  const typeRaw = String(formData.get('type') ?? 'employee') as DbUserType
  const type = TYPES.includes(typeRaw) ? typeRaw : 'employee'
  const capRaw = Number(String(formData.get('capacity') ?? ''))
  const capacityHoursPerWeek = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : null
  if (!firstName) return { error: 'First name is required.' }
  const user = await prisma.user.findFirst({ where: { id, accountId }, select: { id: true } })
  if (!user) return { error: 'Person not found.' }
  const homeEntityId = await validEntityId(accountId, String(formData.get('homeEntityId') ?? ''))
  // Employee ID / Roles / Timezone (Harvest Basic info, specs/28 AC-TEAM-021). Only touched when the form sends them.
  const extra = {
    ...(formData.has('employeeId') ? { employeeId: parseEmployeeId(String(formData.get('employeeId') ?? '')) } : {}),
    ...(formData.has('roles') ? { roleTags: parseRoleTags(String(formData.get('roles') ?? '')) } : {}),
    ...(formData.has('timezone') ? { timezone: parseTimezone(String(formData.get('timezone') ?? '')) } : {}),
  }
  await prisma.user.updateMany({ where: { id, accountId }, data: { firstName, lastName, type, capacityHoursPerWeek, homeEntityId, ...extra } })
  revalidatePath(`/team/${id}`)
  revalidatePath('/team')
  return { ok: true }
}

/** Permissions tab — access level (profile) + granular ability overrides (specs/17). */
export async function updatePersonPermissionsAction(_prev: EditPersonState, formData: FormData): Promise<EditPersonState> {
  const { userId: selfId, accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_people')) {
    return { error: 'You do not have permission to change access.' }
  }
  const id = String(formData.get('id') ?? '')
  const profileRaw = String(formData.get('profile') ?? 'member') as DbProfile
  const profile = PROFILES.includes(profileRaw) ? profileRaw : 'member'
  const user = await prisma.user.findFirst({
    where: { id, accountId },
    select: { id: true, permissionProfile: true, permissionOverrides: true },
  })
  if (!user) return { error: 'Person not found.' }
  // Guard against self-lockout: you can't drop your own access below Administrator.
  if (id === selfId && profile !== 'administrator') {
    return { error: 'You can’t change your own access level.' }
  }
  const checked = formData.getAll('cap').map(String).filter((c): c is Capability => (ALL_CAPABILITIES as string[]).includes(c))
  const overrides = computeOverrides(profile, checked)
  const hasOverrides = (overrides.grant?.length ?? 0) + (overrides.revoke?.length ?? 0) > 0
  // No escalation: only administrators assign Administrator or edit people who hold more than they
  // do, and nobody can grant a capability they don't hold themselves.
  const accessError = checkAccessChange(
    { permissionProfile: permissionProfile as PermissionProfile, permissionOverrides },
    { permissionProfile: user.permissionProfile, permissionOverrides: user.permissionOverrides as PermissionOverrides | null },
    { permissionProfile: profile, permissionOverrides: overrides },
  )
  if (accessError) return { error: accessError }
  await prisma.user.updateMany({
    where: { id, accountId },
    data: {
      permissionProfile: profile,
      permissionOverrides: hasOverrides ? (overrides as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  })
  await writeAudit({ accountId, actorUserId: selfId, entityType: 'user', entityId: id, action: 'update', summary: `Access set to ${PROFILE_LABELS[profile]}${hasOverrides ? ' (customized)' : ''}` })
  revalidatePath(`/team/${id}`)
  revalidatePath('/team')
  return { ok: true }
}

// ---- Assigned projects tab (specs/17) -------------------------------------

async function teamAdmin() {
  const actor = await requireUser()
  if (!can({ permissionProfile: actor.permissionProfile as PermissionProfile, permissionOverrides: actor.permissionOverrides }, 'manage_people')) return null
  return actor
}

/** Toggle "assigned to all projects" (and future). Enabling assigns to every current project. */
export async function setAssignedToAllAction(formData: FormData): Promise<void> {
  const actor = await teamAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const enable = String(formData.get('value') ?? '') === 'on'
  const user = await prisma.user.findFirst({ where: { id, accountId: actor.accountId }, select: { id: true } })
  if (!user) return
  await prisma.user.updateMany({ where: { id, accountId: actor.accountId }, data: { assignedToAllProjects: enable } })
  if (enable) {
    const projects = await prisma.project.findMany({ where: { accountId: actor.accountId }, select: { id: true } })
    for (const p of projects) {
      await prisma.projectUserAssignment.upsert({
        where: { projectId_userId: { projectId: p.id, userId: id } },
        create: { accountId: actor.accountId, projectId: p.id, userId: id, isActive: true },
        update: { isActive: true },
      })
    }
  }
  revalidatePath(`/team/${id}`)
}

export async function assignProjectToPersonAction(formData: FormData): Promise<void> {
  const actor = await teamAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const projectId = String(formData.get('projectId') ?? '')
  const project = await prisma.project.findFirst({ where: { id: projectId, accountId: actor.accountId }, select: { id: true } })
  const user = await prisma.user.findFirst({ where: { id, accountId: actor.accountId }, select: { id: true } })
  if (!project || !user) return
  await prisma.projectUserAssignment.upsert({
    where: { projectId_userId: { projectId, userId: id } },
    create: { accountId: actor.accountId, projectId, userId: id, isActive: true },
    update: { isActive: true },
  })
  revalidatePath(`/team/${id}`)
}

/** Remove from a project — soft-deactivate if they have tracked time there, else delete the row. */
export async function unassignProjectFromPersonAction(formData: FormData): Promise<void> {
  const actor = await teamAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const projectId = String(formData.get('projectId') ?? '')
  const scope = { projectId, userId: id, accountId: actor.accountId }
  const hasTime = await prisma.timeEntry.count({ where: scope })
  if (hasTime > 0) {
    await prisma.projectUserAssignment.updateMany({ where: scope, data: { isActive: false } })
  } else {
    await prisma.projectUserAssignment.deleteMany({ where: scope })
  }
  // Removing from any single project also turns off the "all projects" flag.
  await prisma.user.updateMany({ where: { id, accountId: actor.accountId }, data: { assignedToAllProjects: false } })
  revalidatePath(`/team/${id}`)
}

export async function toggleManagesProjectAction(formData: FormData): Promise<void> {
  const actor = await teamAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const projectId = String(formData.get('projectId') ?? '')
  const asg = await prisma.projectUserAssignment.findFirst({
    where: { projectId, userId: id, accountId: actor.accountId },
    select: { id: true, isProjectManager: true },
  })
  if (!asg) return
  await prisma.projectUserAssignment.update({ where: { id: asg.id }, data: { isProjectManager: !asg.isProjectManager } })
  revalidatePath(`/team/${id}`)
}

// ---- Rates tab (specs/03/17) ----------------------------------------------

const rateCents = (raw: FormDataEntryValue | null): number | null => {
  const n = Number(String(raw ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}

/** Add an effective-dated billable or cost rate for a person. `kind` = 'billable' | 'cost'. */
export async function addPersonRateAction(_prev: EditPersonState, formData: FormData): Promise<EditPersonState> {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  const actor = { permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }
  if (!can(actor, 'set_rates')) return { error: 'You do not have permission to set rates.' }
  const id = String(formData.get('id') ?? '')
  const kind = String(formData.get('kind') ?? '')
  const cents = rateCents(formData.get('rate'))
  const startRaw = String(formData.get('startDate') ?? '').trim()
  const startDate = startRaw ? new Date(`${startRaw}T00:00:00.000Z`) : null
  if (cents == null) return { error: 'Enter a valid rate.' }
  const user = await prisma.user.findFirst({ where: { id, accountId }, select: { id: true } })
  if (!user) return { error: 'Person not found.' }
  if (kind === 'cost') {
    await prisma.personCostRate.create({ data: { accountId, userId: id, hourlyRateCents: cents, startDate } })
  } else {
    await prisma.personBillableRate.create({ data: { accountId, userId: id, hourlyRateCents: cents, startDate } })
  }
  revalidatePath(`/team/${id}`)
  return { ok: true }
}

// ---- Security tab (specs/17) ----------------------------------------------

export async function updatePersonSecurityAction(_prev: EditPersonState, formData: FormData): Promise<EditPersonState> {
  const { userId: selfId, accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_people')) {
    return { error: 'You do not have permission to change security settings.' }
  }
  const id = String(formData.get('id') ?? '')
  const newPassword = String(formData.get('newPassword') ?? '')
  const isActive = formData.get('isActive') === 'on'
  const email = String(formData.get('email') ?? '').toLowerCase().trim()
  if (newPassword && newPassword.length < 8) return { error: 'New password must be at least 8 characters.' }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email.' }
  const user = await prisma.user.findFirst({
    where: { id, accountId },
    select: { id: true, email: true, permissionProfile: true, permissionOverrides: true },
  })
  if (!user) return { error: 'Person not found.' }
  if (id === selfId && !isActive) return { error: 'You can’t deactivate your own account.' }
  const securityError = checkSecurityChange(
    { permissionProfile: permissionProfile as PermissionProfile, permissionOverrides },
    { permissionProfile: user.permissionProfile, permissionOverrides: user.permissionOverrides as PermissionOverrides | null },
    id === selfId,
  )
  if (securityError) return { error: securityError }
  try {
    await prisma.user.update({
      where: { id },
      data: {
        isActive,
        ...(email && email !== user.email ? { email } : {}),
        ...(newPassword ? { passwordHash: bcrypt.hashSync(newPassword, 10) } : {}),
      },
    })
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return { error: 'That email is already used in this account.' }
    return { error: 'Could not save.' }
  }
  revalidatePath(`/team/${id}`)
  return { ok: true }
}

export async function updatePersonAction(_prev: EditPersonState, formData: FormData): Promise<EditPersonState> {
  const { userId: selfId, accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_people')) {
    return { error: 'You do not have permission to edit people.' }
  }

  const id = String(formData.get('id') ?? '')
  const firstName = String(formData.get('firstName') ?? '').trim()
  const lastName = String(formData.get('lastName') ?? '').trim()
  const profileRaw = String(formData.get('profile') ?? 'member') as DbProfile
  const profile = PROFILES.includes(profileRaw) ? profileRaw : 'member'
  const typeRaw = String(formData.get('type') ?? 'employee') as DbUserType
  const type = TYPES.includes(typeRaw) ? typeRaw : 'employee'
  const isActive = formData.get('isActive') === 'on'
  const newPassword = String(formData.get('newPassword') ?? '')
  const capRaw = Number(String(formData.get('capacity') ?? ''))
  const capacityHoursPerWeek = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : null

  if (!firstName) return { error: 'First name is required.' }
  if (newPassword && newPassword.length < 8) return { error: 'New password must be at least 8 characters.' }

  const user = await prisma.user.findFirst({
    where: { id, accountId },
    select: { id: true, permissionProfile: true, permissionOverrides: true },
  })
  if (!user) return { error: 'Person not found.' }

  // Prevent locking yourself out.
  if (id === selfId && !isActive) return { error: 'You can’t deactivate your own account.' }
  if (id === selfId && profile !== user.permissionProfile) return { error: 'You can’t change your own access level.' }
  const actorP = { permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }
  const targetP = { permissionProfile: user.permissionProfile, permissionOverrides: user.permissionOverrides as PermissionOverrides | null }
  const guardError =
    checkAccessChange(actorP, targetP, { permissionProfile: profile, permissionOverrides: targetP.permissionOverrides }) ??
    checkSecurityChange(actorP, targetP, id === selfId)
  if (guardError) return { error: guardError }

  const homeEntityId = await validEntityId(accountId, String(formData.get('homeEntityId') ?? ''))
  try {
    await prisma.user.update({
      where: { id },
      data: {
        firstName,
        lastName,
        permissionProfile: profile,
        type,
        capacityHoursPerWeek,
        isActive,
        homeEntityId,
        ...(newPassword ? { passwordHash: bcrypt.hashSync(newPassword, 10) } : {}),
      },
    })
  } catch {
    return { error: 'Could not save the person.' }
  }

  revalidatePath('/team')
  return { ok: true }
}

// ---- Assigned people (Harvest "Making people assignments for Managers", specs/28) -----------------
// Administrators only, as in Harvest. Storing an assignment does not grant access yet (specs/28 §AP).

async function peopleAssigner() {
  const actor = await requireUser()
  if (!can({ permissionProfile: actor.permissionProfile as PermissionProfile, permissionOverrides: actor.permissionOverrides }, 'edit_account_settings')) return null
  return actor
}

export async function assignPeopleToManagerAction(formData: FormData): Promise<void> {
  const actor = await peopleAssigner()
  if (!actor) return
  const managerId = String(formData.get('id') ?? '')
  const manager = await prisma.user.findFirst({ where: { id: managerId, accountId: actor.accountId }, select: { id: true, permissionProfile: true } })
  if (!manager || !canHoldAssignedPeople(manager.permissionProfile)) return
  const raw = formData.getAll('userIds').map(String)
  const candidates = raw.flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean)
  if (candidates.length === 0) return
  const valid = await prisma.user.findMany({
    where: { accountId: actor.accountId, isActive: true, id: { in: candidates } },
    select: { id: true },
  })
  const ids = cleanAssignIds(raw, managerId, new Set(valid.map((v) => v.id)))
  if (ids.length === 0) return
  await prisma.managerAssignment.createMany({
    data: ids.map((userId) => ({ accountId: actor.accountId, managerId, userId })),
    skipDuplicates: true,
  })
  await writeAudit({
    accountId: actor.accountId,
    actorUserId: actor.userId,
    entityType: 'user',
    entityId: managerId,
    action: 'update',
    summary: `Assigned ${ids.length} ${ids.length === 1 ? 'person' : 'people'} to this manager`,
    detail: { userIds: ids },
  })
  revalidatePath(`/team/${managerId}`)
  revalidatePath('/team')
}

export async function removeAssignedPersonAction(formData: FormData): Promise<void> {
  const actor = await peopleAssigner()
  if (!actor) return
  const managerId = String(formData.get('id') ?? '')
  const userId = String(formData.get('userId') ?? '')
  const { count } = await prisma.managerAssignment.deleteMany({ where: { accountId: actor.accountId, managerId, userId } })
  if (count > 0) {
    await writeAudit({
      accountId: actor.accountId,
      actorUserId: actor.userId,
      entityType: 'user',
      entityId: managerId,
      action: 'update',
      summary: 'Removed an assigned person from this manager',
      detail: { userId },
    })
  }
  revalidatePath(`/team/${managerId}`)
  revalidatePath('/team')
}

// ---- Team overview row actions: Pin / Archive / Restore (specs/28) -------------------------------

/** Pin or unpin a teammate on your own Team overview. Pins are per viewer. */
export async function togglePinAction(formData: FormData): Promise<void> {
  const { userId, accountId } = await requireUser()
  const targetId = String(formData.get('userId') ?? '')
  const target = await prisma.user.findFirst({ where: { id: targetId, accountId }, select: { id: true } })
  if (!target) return
  const { count } = await prisma.teamPin.deleteMany({ where: { accountId, userId, pinnedUserId: targetId } })
  if (count === 0) {
    await prisma.teamPin.createMany({ data: [{ accountId, userId, pinnedUserId: targetId }], skipDuplicates: true })
  }
  revalidatePath('/team')
}

/** Archive (deactivate) or restore a person. Archived people can't sign in; their data stays. */
export async function setPersonArchivedAction(formData: FormData): Promise<void> {
  const { userId: selfId, accountId, permissionProfile, permissionOverrides } = await requireUser()
  const actor = { permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }
  if (!can(actor, 'manage_people')) return
  const id = String(formData.get('userId') ?? '')
  const archive = String(formData.get('archive') ?? '') === '1'
  const [user, account] = await Promise.all([
    prisma.user.findFirst({ where: { id, accountId }, select: { id: true, permissionProfile: true, permissionOverrides: true, firstName: true, lastName: true } }),
    prisma.account.findUnique({ where: { id: accountId }, select: { accountOwnerUserId: true } }),
  ])
  if (!user) return
  if (archive && archiveError({ actorId: selfId, targetId: id, accountOwnerId: account?.accountOwnerUserId ?? null })) return
  const target = { permissionProfile: user.permissionProfile, permissionOverrides: user.permissionOverrides as PermissionOverrides | null }
  if (checkSecurityChange(actor, target, id === selfId)) return
  await prisma.user.updateMany({ where: { id, accountId }, data: { isActive: !archive } })
  await writeAudit({
    accountId,
    actorUserId: selfId,
    entityType: 'user',
    entityId: id,
    action: 'update',
    summary: `${archive ? 'Archived' : 'Restored'} ${user.firstName} ${user.lastName}`.trim(),
  })
  revalidatePath('/team')
  revalidatePath(`/team/${id}`)
}
