import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import type { PermissionOverrides } from '@/modules/shared/permissions'

export interface CurrentUser {
  userId: string
  accountId: string
  permissionProfile: string
  /** Per-user capability overrides (specs/16/17); loaded fresh so changes apply next request. */
  permissionOverrides: PermissionOverrides | null
}

/** The logged-in user's identity + tenant, or null if unauthenticated. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth()
  const u = session?.user
  if (!u?.id || !u?.accountId) return null
  // Load overrides from the DB (not the JWT) so an admin's permission change takes effect on the
  // member's next request rather than only after they sign in again.
  const row = await prisma.user.findUnique({ where: { id: u.id }, select: { permissionOverrides: true } })
  return {
    userId: u.id,
    accountId: u.accountId,
    permissionProfile: u.profile ?? 'member',
    permissionOverrides: (row?.permissionOverrides as PermissionOverrides | null) ?? null,
  }
}

/** Like getCurrentUser but throws when unauthenticated (use in server actions). */
export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser()
  if (!u) throw new Error('Not authenticated')
  return u
}
