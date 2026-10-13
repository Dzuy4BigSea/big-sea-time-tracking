import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/session'
import { appRedirect, driveConfig, errorRedirect, runDriveExport, saveGrant } from '@/lib/googleDrive'
import { exchangeCode, hasDriveScope, idTokenEmail, NONCE_COOKIE, verifyState, withDriveResult } from '@/modules/integrations/googleDrive'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // may run the pending export straight after consent

/**
 * Google redirects here after the drive.file consent screen. Checks, in order: a Track2 session, the
 * signed + unexpired state for THIS user and browser (nonce cookie), the code exchange, that drive.file
 * was granted, and that the Google account is the user's own (verified email = their Track2 email).
 * Then stores the refresh token encrypted and, if the user came from an export, runs it.
 */
export async function GET(req: Request) {
  const me = await getCurrentUser()
  if (!me) return appRedirect(req, '/login')
  const cfg = driveConfig()
  if (!cfg) return appRedirect(req, withDriveResult('/', { driveError: 'not_configured' }))

  const sp = new URL(req.url).searchParams
  const nonce = cookies().get(NONCE_COOKIE)?.value
  const checked = verifyState(sp.get('state'), cfg.authSecret, { userId: me.userId, accountId: me.accountId, nonce })
  if (!checked.ok) return clearNonce(errorRedirect(req, '/', 'state'))
  const { returnTo, exportHref } = checked.state

  if (sp.get('error')) return clearNonce(errorRedirect(req, returnTo, 'denied'))
  const code = sp.get('code')
  if (!code) return clearNonce(errorRedirect(req, returnTo, 'denied'))

  const tok = await exchangeCode(fetch, { code, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri })
  if (!tok.ok) {
    console.warn(`[google-drive] code exchange failed (${tok.error}${tok.status ? ` ${tok.status}` : ''})`)
    return clearNonce(errorRedirect(req, returnTo, 'token'))
  }
  if (!hasDriveScope(tok.scope)) return clearNonce(errorRedirect(req, returnTo, 'scope'))

  const user = await prisma.user.findFirst({ where: { id: me.userId, accountId: me.accountId }, select: { email: true } })
  const google = idTokenEmail(tok.idToken)
  if (!user || !google || !google.verified || google.email !== user.email.trim().toLowerCase()) {
    return clearNonce(errorRedirect(req, returnTo, 'account_mismatch'))
  }
  if (!tok.refreshToken) return clearNonce(errorRedirect(req, returnTo, 'no_refresh_token'))

  await saveGrant(me, { refreshToken: tok.refreshToken, scope: tok.scope, googleEmail: google.email })

  if (!exportHref) return clearNonce(appRedirect(req, withDriveResult(returnTo, { drive: 'connected' })))
  const result = await runDriveExport(me, exportHref, tok.accessToken)
  return clearNonce(appRedirect(req, withDriveResult(returnTo, result.ok ? { driveFile: result.fileId } : { driveError: result.code })))
}

/** The nonce is single-use: drop the cookie whatever the outcome. */
function clearNonce(res: NextResponse): NextResponse {
  res.cookies.set(NONCE_COOKIE, '', { path: '/api/google/drive', maxAge: 0 })
  return res
}
