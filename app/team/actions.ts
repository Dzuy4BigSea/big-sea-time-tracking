'use server'

import { revalidatePath } from 'next/cache'
import bcrypt from 'bcryptjs'
import type { PermissionProfile as DbProfile, UserType as DbUserType } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, computeOverrides, ALL_CAPABILITIES, PROFILE_LABELS, type Capability, type PermissionProfile } from '@/modules/shared/permissions'
import { validEntityId } from '@/lib/entities'
import { writeAudit } from '@/lib/audit'

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
  await prisma.user.update({ where: { id }, data: { firstName, lastName, type, capacityHoursPerWeek, homeEntityId } })
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
  const user = await prisma.user.findFirst({ where: { id, accountId }, select: { id: true } })
  if (!user) return { error: 'Person not found.' }
  // Guard against self-lockout: you can't drop your own access below Administrator.
  if (id === selfId && profile !== 'administrator') {
    return { error: 'You can’t change your own access level.' }
  }
  const checked = formData.getAll('cap').map(String).filter((c): c is Capability => (ALL_CAPABILITIES as string[]).includes(c))
  const overrides = computeOverrides(profile, checked)
  const hasOverrides = (overrides.grant?.length ?? 0) + (overrides.revoke?.length ?? 0) > 0
  await prisma.user.update({
    where: { id },
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

  const user = await prisma.user.findFirst({ where: { id, accountId }, select: { id: true } })
  if (!user) return { error: 'Person not found.' }

  // Prevent locking yourself out.
  if (id === selfId && !isActive) return { error: 'You can’t deactivate your own account.' }

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
