import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveAppUrl } from '@/lib/appUrl'
import { currentUserForToken, type CurrentUser } from '@/lib/session'
import { prismaOAuthStore } from '@/lib/oauth/store'
import { bearerToken, hashToken, shouldTouchLastUsed } from '@/modules/apiTokens/token'
import { ACCESS_TOKEN_PREFIX } from '@/modules/oauth/crypto'
import { mcpResource } from '@/modules/oauth/metadata'
import { resolveAccessToken } from '@/modules/oauth/service'

export interface TokenPrincipal {
  user: CurrentUser
  /** ApiToken id for a personal access token; OAuthGrant id for an OAuth access token. */
  tokenId: string
  kind: 'pat' | 'oauth'
}

/** The raw credential of an `Authorization: Bearer …` header (any shape), or null. */
export function rawBearer(authorization: string | null): string | null {
  const m = authorization ? /^\s*bearer\s+(\S+)\s*$/i.exec(authorization) : null
  return m ? m[1] : null
}

/**
 * Resolve `Authorization: Bearer …` to the token's user (specs/22): a personal access token
 * (`track2_pat_…`) or an OAuth access token (`track2_oat_…`, issued to an MCP client such as a
 * claude.ai connector). Null for a missing, malformed, unknown, expired or revoked token, or a user who
 * is deactivated / moved account — the caller answers 401. Both kinds resolve through
 * currentUserForToken(), so isActive / profile / overrides are re-read on every request.
 */
export async function authenticateBearer(authorization: string | null, now: Date = new Date()): Promise<TokenPrincipal | null> {
  const raw = rawBearer(authorization)
  if (raw?.startsWith(ACCESS_TOKEN_PREFIX)) return authenticateOAuth(raw, now)

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
  return { user, tokenId: row.id, kind: 'pat' }
}

async function authenticateOAuth(token: string, now: Date): Promise<TokenPrincipal | null> {
  const grant = await resolveAccessToken(prismaOAuthStore, token, mcpResource(resolveAppUrl()), now)
  if (!grant) return null
  const user = await currentUserForToken(grant)
  if (!user) return null
  if (shouldTouchLastUsed(grant.lastUsedAt ?? null, now)) {
    await prisma.oAuthGrant.update({ where: { id: grant.id }, data: { lastUsedAt: now } }).catch(() => {})
  }
  return { user, tokenId: grant.id, kind: 'oauth' }
}
