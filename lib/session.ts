import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { can, type Capability, type PermissionOverrides, type PermissionProfile } from '@/modules/shared/permissions'

export interface CurrentUser {
  userId: string
  accountId: string
  permissionProfile: string
  /** Per-user capability overrides (specs/16/17); loaded fresh so changes apply next request. */
  permissionOverrides: PermissionOverrides | null
}

/**
 * The logged-in user's identity + tenant, or null if unauthenticated.
 *
 * The JWT only proves *who* signed in. Everything that decides access — whether the person is still
 * active, their account, profile and overrides — is re-read from the DB on every request so that
 * deactivating someone or lowering their access takes effect immediately, not when their JWT expires.
 * Wrapped in React `cache()` so a page + its server components share one query per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth()
  const u = session?.user
  if (!u?.id || !u?.accountId) return null
  const row = await prisma.user.findUnique({
    where: { id: u.id },
    select: { accountId: true, isActive: true, permissionProfile: true, permissionOverrides: true },
  })
  // Deleted, deactivated, or moved to another account since sign-in → treat as signed out.
  if (!row || !row.isActive || row.accountId !== u.accountId) return null
  return {
    userId: u.id,
    accountId: row.accountId,
    permissionProfile: row.permissionProfile,
    permissionOverrides: (row.permissionOverrides as PermissionOverrides | null) ?? null,
  }
})

/**
 * Like getCurrentUser but never returns null: an unauthenticated or deactivated user is sent to the
 * login page (works from server components and server actions). Route handlers that must answer
 * with JSON should call getCurrentUser() and return 401 themselves.
 */
export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser()
  if (!u) redirect('/login')
  return u
}

/** Does the signed-in user hold `capability` (profile + overrides, fresh from the DB)? */
export function userCan(u: CurrentUser, capability: Capability): boolean {
  return can({ permissionProfile: u.permissionProfile as PermissionProfile, permissionOverrides: u.permissionOverrides }, capability)
}

/**
 * Page read-gate: requireUser + the capability, else a 404 (don't reveal that the page exists).
 * For server components only; server actions should return an error instead.
 */
export async function requireCapability(capability: Capability): Promise<CurrentUser> {
  const u = await requireUser()
  if (!userCan(u, capability)) notFound()
  return u
}
