import 'server-only'
import { NextResponse } from 'next/server'
import type { IntegrationConnection, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveAppUrl } from '@/lib/appUrl'
import { encryptSecret, isEncryptionConfigured } from '@/lib/crypto'
import { decryptSecretMap, logSync, xeroTokenLockKey } from '@/lib/integrations'
import { userCan, type CurrentUser } from '@/lib/session'
import { resolveXeroApp, XERO_CALLBACK_PATH, xeroScopes, type XeroConnectError } from '@/modules/integrations/xeroOAuth'

/**
 * Server glue for "Connect to Xero" (app/api/integrations/xero/*): configuration, the per-company
 * connection row, and saving the tokens from a sign-in. The OAuth rules live in
 * modules/integrations/xeroOAuth.ts.
 */

export interface XeroOAuthConfig {
  authSecret: string
  redirectUri: string
  scope: string
}

/**
 * Null when the flow can't run here (no AUTH_SECRET or INTEGRATION_ENC_KEY). The redirect URI comes from
 * configuration (XERO_REDIRECT_URI, else APP_URL…), never request headers, and must be registered on
 * the Xero app exactly as built: `<APP_URL>/api/integrations/xero/callback`.
 */
export function xeroOAuthConfig(env: Record<string, string | undefined> = process.env): XeroOAuthConfig | null {
  if (!isEncryptionConfigured()) return null
  const authSecret = env.AUTH_SECRET ?? env.NEXTAUTH_SECRET
  if (!authSecret) return null
  return {
    authSecret,
    redirectUri: (env.XERO_REDIRECT_URI ?? '').trim() || `${resolveAppUrl(env)}${XERO_CALLBACK_PATH}`,
    scope: xeroScopes(env),
  }
}

export function canManageIntegrations(me: CurrentUser): boolean {
  return userCan(me, 'edit_account_settings')
}

/** The company (business entity) in the user's account, or null. */
export async function findEntity(accountId: string, entityId: string | null | undefined) {
  if (!entityId) return null
  return prisma.businessEntity.findFirst({ where: { id: entityId, accountId }, select: { id: true, name: true } })
}

export async function findXeroRow(accountId: string, entityId: string): Promise<IntegrationConnection | null> {
  return prisma.integrationConnection.findFirst({ where: { accountId, provider: 'xero', entityId } })
}

/** The Xero app to sign in with for this company: its saved client fields, else Vercel env. */
export function xeroAppFor(row: IntegrationConnection | null) {
  return resolveXeroApp((row?.config as Record<string, unknown> | null) ?? {}, decryptSecretMap(row?.secretsEnc))
}

export function settingsRedirect(req: Request, entityId: string | null, result: { xero: 'connected' } | { xeroError: XeroConnectError }): NextResponse {
  const q = new URLSearchParams()
  if (entityId) q.set('company', entityId)
  if ('xero' in result) q.set('xero', result.xero)
  else q.set('xeroError', result.xeroError)
  return NextResponse.redirect(new URL(`/settings/integrations?${q.toString()}`, req.url), 303)
}

/**
 * Store a sign-in's tokens and organisation on the company's Xero connection. Existing config (account
 * codes, cutover date) is kept; the "Reconnect needed" flag is cleared. Runs under the same advisory
 * lock as the token refresh so a concurrent sync never overwrites the new refresh token.
 * Connected = tokens + tenant + the required revenue account code (as the settings form requires).
 */
export async function saveXeroSignIn(
  me: CurrentUser,
  entityId: string,
  t: { accessToken: string; refreshToken: string; expiresAt: Date; tenantId: string; tenantName: string },
): Promise<{ previousTenantId: string | null }> {
  const tokens = { accessToken: encryptSecret(t.accessToken), refreshToken: encryptSecret(t.refreshToken) }
  const nextConfig = (cfg: Record<string, unknown>) => {
    const { needsReconnect: _n, lastError: _e, lastErrorAt: _a, ...rest } = cfg
    return { ...rest, tenantId: t.tenantId, orgName: t.tenantName }
  }
  const statusFor = (cfg: Record<string, unknown>) => (String(cfg.defaultRevenueAccountCode ?? '').trim() ? 'connected' : 'disconnected')

  const existing = await findXeroRow(me.accountId, entityId)
  if (!existing) {
    const config = nextConfig({})
    await prisma.integrationConnection.create({
      data: {
        accountId: me.accountId,
        provider: 'xero',
        entityId,
        secretsEnc: tokens as Prisma.InputJsonValue,
        config: config as Prisma.InputJsonValue,
        status: statusFor(config),
        externalOrgId: t.tenantId,
        externalOrgName: t.tenantName || null,
        expiresAt: t.expiresAt,
        connectedByUserId: me.userId,
      },
    })
    await logSync({ accountId: me.accountId, provider: 'xero', direction: 'outbound', entityType: 'connection', entityId, externalId: t.tenantId, ok: true, message: `Connected to ${t.tenantName || t.tenantId}` })
    return { previousTenantId: null }
  }

  const previousTenantId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${xeroTokenLockKey(existing.id)}))) l`
    const cur = await tx.integrationConnection.findUnique({ where: { id: existing.id }, select: { secretsEnc: true, config: true } })
    const cfg = (cur?.config as Record<string, unknown> | null) ?? {}
    const config = nextConfig(cfg)
    await tx.integrationConnection.update({
      where: { id: existing.id },
      data: {
        secretsEnc: { ...((cur?.secretsEnc as Record<string, string> | null) ?? {}), ...tokens } as Prisma.InputJsonValue,
        config: config as Prisma.InputJsonValue,
        status: statusFor(config),
        externalOrgId: t.tenantId,
        externalOrgName: t.tenantName || null,
        expiresAt: t.expiresAt,
        connectedByUserId: me.userId,
      },
    })
    return String(cfg.tenantId ?? '').trim() || null
  })
  const switched = previousTenantId && previousTenantId !== t.tenantId ? ` (was tenant ${previousTenantId})` : ''
  await logSync({ accountId: me.accountId, provider: 'xero', direction: 'outbound', entityType: 'connection', entityId, externalId: t.tenantId, ok: true, message: `Reconnected to ${t.tenantName || t.tenantId}${switched}` })
  return { previousTenantId }
}
