'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { writeAudit } from '@/lib/audit'
import { mintToken, validateTokenName } from '@/modules/apiTokens/token'

export type CreateTokenState = { error?: string; token?: string; name?: string }

/** Max active tokens per person — enough for a few machines/clients, small enough to keep tidy. */
const MAX_ACTIVE_TOKENS = 10

/**
 * Mint a personal access token for the signed-in user (specs/22). Any active user may manage their own
 * tokens; a token only ever acts as its owner. The plaintext is returned once and never stored.
 */
export async function createApiTokenAction(_prev: CreateTokenState, formData: FormData): Promise<CreateTokenState> {
  const { userId, accountId } = await requireUser()
  const v = validateTokenName(String(formData.get('name') ?? ''))
  if ('error' in v) return { error: v.error }
  const active = await prisma.apiToken.count({ where: { userId, accountId, revokedAt: null } })
  if (active >= MAX_ACTIVE_TOKENS) return { error: `You already have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one you no longer use first.` }
  const minted = mintToken()
  const row = await prisma.apiToken.create({
    data: { accountId, userId, name: v.name, tokenHash: minted.tokenHash, prefix: minted.prefix },
    select: { id: true },
  })
  await writeAudit({ accountId, actorUserId: userId, entityType: 'api_token', entityId: row.id, action: 'create', summary: `Personal access token “${v.name}” created` })
  revalidatePath('/settings/tokens')
  return { token: minted.token, name: v.name }
}

/** Revoke one of the signed-in user's own tokens (immediate: the next API call with it gets 401). */
export async function revokeApiTokenAction(formData: FormData): Promise<void> {
  const { userId, accountId } = await requireUser()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const { count } = await prisma.apiToken.updateMany({ where: { id, userId, accountId, revokedAt: null }, data: { revokedAt: new Date() } })
  if (count > 0) {
    await writeAudit({ accountId, actorUserId: userId, entityType: 'api_token', entityId: id, action: 'state_change', summary: 'Personal access token revoked' })
  }
  revalidatePath('/settings/tokens')
}

/**
 * Disconnect an OAuth-connected app (e.g. a claude.ai connector, specs/22 §OAuth): revokes the grant
 * and every access/refresh token under it. Only the signed-in user's own grants.
 */
export async function revokeOAuthGrantAction(formData: FormData): Promise<void> {
  const { userId, accountId } = await requireUser()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const now = new Date()
  const grant = await prisma.oAuthGrant.findFirst({ where: { id, userId, accountId, revokedAt: null }, select: { id: true, client: { select: { clientName: true } } } })
  if (!grant) return
  await prisma.$transaction([
    prisma.oAuthGrant.updateMany({ where: { id: grant.id, revokedAt: null }, data: { revokedAt: now } }),
    prisma.oAuthToken.updateMany({ where: { grantId: grant.id, revokedAt: null }, data: { revokedAt: now } }),
  ])
  await writeAudit({ accountId, actorUserId: userId, entityType: 'oauth_grant', entityId: grant.id, action: 'state_change', summary: `Connected app “${grant.client.clientName}” disconnected` })
  revalidatePath('/settings/tokens')
}
