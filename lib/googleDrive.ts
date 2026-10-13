import 'server-only'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decryptSecret, encryptSecret, isEncryptionConfigured } from '@/lib/crypto'
import { resolveAppUrl } from '@/lib/appUrl'
import { collectCsv } from '@/lib/csvStream'
import type { CurrentUser } from '@/lib/session'
import { isGoogleConfigured, parseAllowedDomains } from '@/modules/shared/googleSignIn'
import {
  buildConsentUrl,
  CALLBACK_PATH,
  DRIVE_MAX_BYTES,
  DRIVE_MAX_CELLS,
  NONCE_COOKIE,
  parseExportHref,
  refreshAccessToken,
  revokeToken,
  signState,
  STATE_TTL_MS,
  uploadCsvAsSheet,
  withDriveResult,
  type DriveErrorCode,
} from '@/modules/integrations/googleDrive'
import { buildExport } from '@/modules/reports/exports'

/**
 * Server glue for "Export → Google Drive" (OPS.md §8). Pure logic is in modules/integrations/googleDrive.ts.
 * Tokens never leave the server and are never logged; the refresh token is stored AES-GCM encrypted.
 * Every grant lookup is by the signed-in user's own id + account, so nobody can use someone else's grant.
 */

export interface DriveConfig {
  clientId: string
  clientSecret: string
  authSecret: string
  redirectUri: string
  hostedDomain: string | null
}

/** Null (Drive option hidden) unless Google OAuth, INTEGRATION_ENC_KEY and AUTH_SECRET are all set. */
export function driveConfig(env: Record<string, string | undefined> = process.env): DriveConfig | null {
  if (!isGoogleConfigured({ AUTH_GOOGLE_ID: env.AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET: env.AUTH_GOOGLE_SECRET })) return null
  if (!isEncryptionConfigured()) return null
  const authSecret = env.AUTH_SECRET ?? env.NEXTAUTH_SECRET
  if (!authSecret) return null
  const domains = parseAllowedDomains(env.AUTH_GOOGLE_ALLOWED_DOMAINS)
  return {
    clientId: env.AUTH_GOOGLE_ID!.trim(),
    clientSecret: env.AUTH_GOOGLE_SECRET!.trim(),
    authSecret,
    redirectUri: `${resolveAppUrl(env)}${CALLBACK_PATH}`,
    hostedDomain: domains.length === 1 ? domains[0] : null,
  }
}

export function isDriveExportEnabled(): boolean {
  return driveConfig() !== null
}

/** Redirect (303) within the app to a validated relative path. */
export function appRedirect(req: Request, relative: string): NextResponse {
  return NextResponse.redirect(new URL(relative, req.url), 303)
}

export function errorRedirect(req: Request, returnTo: string, code: DriveErrorCode): NextResponse {
  return appRedirect(req, withDriveResult(returnTo, { driveError: code }))
}

/** Send the user to Google's consent screen; the signed state carries where to go (and what to export) after. */
export async function startConsent(
  req: Request,
  me: CurrentUser,
  cfg: DriveConfig,
  next: { returnTo: string; exportHref: string | null },
): Promise<NextResponse> {
  const user = await prisma.user.findFirst({ where: { id: me.userId, accountId: me.accountId }, select: { email: true } })
  const { state, nonce } = signState({ userId: me.userId, accountId: me.accountId, returnTo: next.returnTo, exportHref: next.exportHref }, cfg.authSecret)
  const res = NextResponse.redirect(
    buildConsentUrl({ clientId: cfg.clientId, redirectUri: cfg.redirectUri, state, loginHint: user?.email, hostedDomain: cfg.hostedDomain }),
    303,
  )
  // Binds the state to this browser (login-CSRF / code-injection guard). Lax so it rides Google's top-level redirect back.
  res.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: new URL(req.url).protocol === 'https:',
    sameSite: 'lax',
    path: '/api/google/drive',
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  })
  return res
}

export async function getGrantStatus(me: CurrentUser): Promise<{ googleEmail: string } | null> {
  return prisma.googleDriveGrant.findFirst({ where: { userId: me.userId, accountId: me.accountId }, select: { googleEmail: true } })
}

export async function saveGrant(me: CurrentUser, g: { refreshToken: string; scope: string; googleEmail: string }): Promise<void> {
  const data = { accountId: me.accountId, encryptedRefreshToken: encryptSecret(g.refreshToken), scope: g.scope, googleEmail: g.googleEmail }
  await prisma.googleDriveGrant.upsert({ where: { userId: me.userId }, create: { userId: me.userId, ...data }, update: data })
}

/** Delete the user's grant (and revoke it at Google when asked). */
export async function deleteGrant(me: CurrentUser, opts: { revoke: boolean }): Promise<void> {
  const row = await prisma.googleDriveGrant.findFirst({ where: { userId: me.userId, accountId: me.accountId } })
  if (!row) return
  await prisma.googleDriveGrant.deleteMany({ where: { id: row.id, userId: me.userId } })
  if (opts.revoke) {
    try {
      await revokeToken(fetch, decryptSecret(row.encryptedRefreshToken))
    } catch {
      /* best effort; the local grant is gone either way */
    }
  }
}

export type AccessTokenResult = { ok: true; accessToken: string } | { ok: false; reason: 'no_grant' | 'reconnect' | 'error' }

/** A fresh short-lived access token from the user's own stored refresh token. */
export async function accessTokenFor(me: CurrentUser, cfg: DriveConfig): Promise<AccessTokenResult> {
  const row = await prisma.googleDriveGrant.findFirst({ where: { userId: me.userId, accountId: me.accountId } })
  if (!row) return { ok: false, reason: 'no_grant' }
  let refreshToken: string
  try {
    refreshToken = decryptSecret(row.encryptedRefreshToken)
  } catch {
    // Key rotated or row corrupt: the grant is unusable, so drop it and ask again.
    await prisma.googleDriveGrant.deleteMany({ where: { id: row.id } })
    return { ok: false, reason: 'reconnect' }
  }
  const t = await refreshAccessToken(fetch, { refreshToken, clientId: cfg.clientId, clientSecret: cfg.clientSecret })
  if (t.ok) return { ok: true, accessToken: t.accessToken }
  if (t.error === 'invalid_grant') {
    // Revoked at Google / expired: forget it and send the user through consent again.
    await prisma.googleDriveGrant.deleteMany({ where: { id: row.id } })
    return { ok: false, reason: 'reconnect' }
  }
  console.warn(`[google-drive] token refresh failed (${t.error}${t.status ? ` ${t.status}` : ''})`)
  return { ok: false, reason: 'error' }
}

export type DriveExportResult = { ok: true; fileId: string } | { ok: false; code: DriveErrorCode }

/** Build the CSV with the same generator as the download, then upload it as a new Sheet in the user's My Drive. */
export async function runDriveExport(me: CurrentUser, exportHref: string, accessToken: string): Promise<DriveExportResult> {
  const target = parseExportHref(exportHref)
  if (!target) return { ok: false, code: 'export_not_found' }
  const built = await buildExport(me, target)
  if (!built.ok) return { ok: false, code: built.status === 403 ? 'export_forbidden' : 'export_not_found' }
  const collected = await collectCsv(built.spec.headers, built.spec.batches, { maxCells: DRIVE_MAX_CELLS, maxBytes: DRIVE_MAX_BYTES })
  if (!collected.ok) return { ok: false, code: 'export_too_large' }
  const up = await uploadCsvAsSheet(fetch, { accessToken, name: built.spec.sheetName, csv: collected.csv })
  if (!up.ok) {
    console.warn(`[google-drive] upload failed (${up.error}${up.status ? ` ${up.status}` : ''})`)
    return { ok: false, code: up.error }
  }
  return { ok: true, fileId: up.fileId }
}
