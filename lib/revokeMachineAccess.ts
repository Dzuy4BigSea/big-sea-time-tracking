import { prisma } from '@/lib/prisma'

/**
 * Revoke every personal access token and connected-app (OAuth) grant a person holds. Called when
 * someone is deactivated or archived, so reactivating them later doesn't silently bring old
 * MCP/API credentials back to life (they create new ones instead).
 */
export async function revokeMachineAccess(accountId: string, userId: string, now: Date = new Date()): Promise<void> {
  await prisma.$transaction([
    prisma.apiToken.updateMany({ where: { accountId, userId, revokedAt: null }, data: { revokedAt: now } }),
    prisma.oAuthToken.updateMany({ where: { revokedAt: null, grant: { accountId, userId } }, data: { revokedAt: now } }),
    prisma.oAuthGrant.updateMany({ where: { accountId, userId, revokedAt: null }, data: { revokedAt: now } }),
  ])
}
