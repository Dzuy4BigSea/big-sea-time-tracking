import 'server-only'
import { prisma } from '@/lib/prisma'
import type { CodeRecord, OAuthStore, TokenRecord } from '@/modules/oauth/service'

/** Prisma implementation of the OAuth storage contract (modules/oauth/service.ts). */
export const prismaOAuthStore: OAuthStore = {
  async createCode(c) {
    await prisma.oAuthAuthorizationCode.create({
      data: {
        codeHash: c.codeHash,
        clientId: c.clientId,
        accountId: c.accountId,
        userId: c.userId,
        redirectUri: c.redirectUri,
        codeChallenge: c.codeChallenge,
        resource: c.resource,
        scope: c.scope,
        expiresAt: c.expiresAt,
      },
    })
  },

  async consumeCode(codeHash, now) {
    const row = await prisma.oAuthAuthorizationCode.findUnique({ where: { codeHash } })
    if (!row) return { status: 'missing' }
    const code: CodeRecord = {
      id: row.id,
      clientId: row.clientId,
      accountId: row.accountId,
      userId: row.userId,
      redirectUri: row.redirectUri,
      codeChallenge: row.codeChallenge,
      resource: row.resource,
      scope: row.scope,
      expiresAt: row.expiresAt,
      grantId: row.grantId,
    }
    if (row.usedAt) return { status: 'reused', code }
    // Compare-and-set: only one concurrent exchange can flip usedAt.
    const { count } = await prisma.oAuthAuthorizationCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } })
    if (count !== 1) {
      const again = await prisma.oAuthAuthorizationCode.findUnique({ where: { id: row.id }, select: { grantId: true } })
      return { status: 'reused', code: { ...code, grantId: again?.grantId ?? null } }
    }
    return { status: 'ok', code }
  },

  async createGrant({ codeId, grant, tokens }) {
    return prisma.$transaction(async (tx) => {
      const g = await tx.oAuthGrant.create({ data: { ...grant }, select: { id: true } })
      await tx.oAuthToken.createMany({ data: tokens.map((t) => ({ ...t, grantId: g.id })) })
      await tx.oAuthAuthorizationCode.update({ where: { id: codeId }, data: { grantId: g.id } })
      return g.id
    })
  },

  async findToken(tokenHash) {
    const row = await prisma.oAuthToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        kind: true,
        expiresAt: true,
        rotatedAt: true,
        revokedAt: true,
        grant: { select: { id: true, accountId: true, userId: true, clientId: true, resource: true, scope: true, revokedAt: true, lastUsedAt: true } },
      },
    })
    if (!row) return null
    return { ...row, kind: row.kind === 'refresh' ? 'refresh' : 'access' } satisfies TokenRecord
  },

  async rotateRefresh(oldTokenId, grantId, now, tokens) {
    return prisma.$transaction(async (tx) => {
      const { count } = await tx.oAuthToken.updateMany({ where: { id: oldTokenId, rotatedAt: null, revokedAt: null }, data: { rotatedAt: now } })
      if (count !== 1) return false
      await tx.oAuthToken.createMany({ data: tokens.map((t) => ({ ...t, grantId })) })
      return true
    })
  },

  async revokeGrant(grantId, now) {
    await prisma.$transaction([
      prisma.oAuthGrant.updateMany({ where: { id: grantId, revokedAt: null }, data: { revokedAt: now } }),
      prisma.oAuthToken.updateMany({ where: { grantId, revokedAt: null }, data: { revokedAt: now } }),
    ])
  },
}
