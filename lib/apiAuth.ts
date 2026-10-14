import 'server-only'
import { prisma } from '@/lib/prisma'
import { currentUserForToken, type CurrentUser } from '@/lib/session'
import { bearerToken, hashToken, shouldTouchLastUsed } from '@/modules/apiTokens/token'

export interface TokenPrincipal {
  user: CurrentUser
  tokenId: string
}

/**
 * Resolve `Authorization: Bearer track2_pat_…` to the token's user (specs/22). Null for a missing,
 * malformed, unknown or revoked token, or a user who is deactivated / moved account — the caller
 * answers 401. lastUsedAt is refreshed at most every few minutes (best-effort).
 */
export async function authenticateBearer(authorization: string | null, now: Date = new Date()): Promise<TokenPrincipal | null> {
  const token = bearerToken(authorization)
  if (!token) return null
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, accountId: true, revokedAt: true, lastUsedAt: true },
  })
  if (!row || row.revokedAt) return null
  const user = await currentUserForToken(row)
  if (!user) return null
  if (shouldTouchLastUsed(row.lastUsedAt, now)) {
    // Awaited: a fire-and-forget write can be dropped when a serverless function freezes.
    await prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: now } }).catch(() => {})
  }
  return { user, tokenId: row.id }
}
