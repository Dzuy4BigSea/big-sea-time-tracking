import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { canManageIntegrations, findEntity, findXeroRow, settingsRedirect, xeroAppFor, xeroOAuthConfig } from '@/lib/xeroConnect'
import { buildXeroAuthorizeUrl, signXeroState, XERO_NONCE_COOKIE, XERO_STATE_TTL_MS } from '@/modules/integrations/xeroOAuth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/integrations/xero/connect?entityId=… → Xero's consent screen, to connect ONE company's Xero
 * organisation (Settings → Integrations → company → Xero → "Connect to Xero"). Each company signs in
 * separately so each gets its own refresh token.
 */
export async function GET(req: Request) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.redirect(new URL('/login', req.url), 303)
  const entity = await findEntity(me.accountId, new URL(req.url).searchParams.get('entityId'))
  if (!entity) return new Response('Not found', { status: 404 })
  if (!canManageIntegrations(me)) return settingsRedirect(req, entity.id, { xeroError: 'forbidden' })

  const cfg = xeroOAuthConfig()
  const app = cfg ? xeroAppFor(await findXeroRow(me.accountId, entity.id)) : null
  if (!cfg || !app) return settingsRedirect(req, entity.id, { xeroError: 'not_configured' })

  const { state, nonce } = signXeroState({ userId: me.userId, accountId: me.accountId, entityId: entity.id }, cfg.authSecret)
  const res = NextResponse.redirect(buildXeroAuthorizeUrl({ clientId: app.clientId, redirectUri: cfg.redirectUri, scope: cfg.scope, state }), 303)
  // Binds the state to this browser (login-CSRF / code-injection guard). Lax so it rides Xero's top-level redirect back.
  res.cookies.set(XERO_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: new URL(req.url).protocol === 'https:',
    sameSite: 'lax',
    path: '/api/integrations/xero',
    maxAge: Math.floor(XERO_STATE_TTL_MS / 1000),
  })
  return res
}
