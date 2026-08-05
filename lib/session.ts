import { auth } from '@/auth'

export interface CurrentUser {
  userId: string
  accountId: string
  permissionProfile: string
}

/** The logged-in user's identity + tenant, or null if unauthenticated. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth()
  const u = session?.user
  if (!u?.id || !u?.accountId) return null
  return { userId: u.id, accountId: u.accountId, permissionProfile: u.profile ?? 'member' }
}

/** Like getCurrentUser but throws when unauthenticated (use in server actions). */
export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser()
  if (!u) throw new Error('Not authenticated')
  return u
}
