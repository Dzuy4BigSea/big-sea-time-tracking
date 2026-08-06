'use server'

import { revalidatePath } from 'next/cache'
import bcrypt from 'bcryptjs'
import type { PermissionProfile as DbProfile, UserType as DbUserType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'

export type NewPersonState = { error?: string; ok?: boolean }

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
  const { accountId, permissionProfile } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile }, 'manage_people')) {
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
