import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { canManageIntegrations, findEntity, findXeroRow, saveXeroSignIn, settingsRedirect, xeroAppFor, xeroOAuthConfig } from '@/lib/xeroConnect'
import { listXeroTenants } from '@/modules/integrations/xeroAuth'
import { XERO_TOKEN_URL } from '@/modules/integrations/xeroClient'
import { exchangeXeroCode, pickXeroTenant, verifyXeroState, XERO_NONCE_COOKIE, xeroAuthEventId, type XeroConnectError } from '@/modules/integrations/xeroOAuth'

export const dynamic = 'force-dynamic'

/**
 * Xero redirects here after the consent screen. Checks, in order: a Track2 session with integrations
 * access, the signed + unexpired state for THIS user and browser (nonce cookie), the company, the code
 * exchange, a refresh token (offline_access), and the one organisation picked in this sign-in. Then
 * stores the tokens encrypted on that company's Xero connection and returns to Settings → Integrations.
 */
export async function GET(req: Request) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.redirect(new URL('/login', req.url), 303)
  const cfg = xeroOAuthConfig()
  const sp = new URL(req.url).searchParams
  const checked = cfg
    ? verifyXeroState(sp.get('state'), cfg.authSecret, { userId: me.userId, accountId: me.accountId, nonce: cookies().get(XERO_NONCE_COOKIE)?.value })
    : null
  const entity = checked?.ok ? await findEntity(me.accountId, checked.state.entityId) : null
  const fail = (code: XeroConnectError) => clearNonce(settingsRedirect(req, entity?.id ?? null, { xeroError: code }))

  if (!cfg) return fail('not_configured')
  if (!checked?.ok || !entity) return fail('state')
  if (!canManageIntegrations(me)) return fail('forbidden')
  if (sp.get('error')) return fail('denied')
  const code = sp.get('code')
  if (!code) return fail('denied')

  const row = await findXeroRow(me.accountId, entity.id)
  const app = xeroAppFor(row)
  if (!app) return fail('not_configured')

  const tok = await exchangeXeroCode(fetch, { tokenUrl: XERO_TOKEN_URL, code, clientId: app.clientId, clientSecret: app.clientSecret, redirectUri: cfg.redirectUri })
  if (!tok.ok) {
    console.warn(`[xero-connect] code exchange failed (${tok.error}${tok.status ? ` ${tok.status}` : ''})`)
    return fail('token')
  }
  if (!tok.refreshToken) return fail('no_refresh_token')

  let tenants
  try {
    tenants = await listXeroTenants({ fetch: (i, init) => fetch(i, init), maxRetries: 1 }, tok.accessToken)
  } catch {
    return fail('connections')
  }
  const currentTenantId = String((row?.config as Record<string, unknown> | null)?.tenantId ?? '').trim() || null
  const pick = pickXeroTenant(tenants, xeroAuthEventId(tok.accessToken), currentTenantId)
  if (!pick.ok) return fail(pick.error)

  await saveXeroSignIn(me, entity.id, {
    accessToken: tok.accessToken,
    refreshToken: tok.refreshToken,
    expiresAt: new Date(Date.now() + tok.expiresIn * 1000),
    tenantId: pick.tenant.tenantId,
    tenantName: pick.tenant.tenantName,
  })
  return clearNonce(settingsRedirect(req, entity.id, { xero: 'connected' }))
}

/** The nonce is single-use: drop the cookie whatever the outcome. */
function clearNonce(res: NextResponse): NextResponse {
  res.cookies.set(XERO_NONCE_COOKIE, '', { path: '/api/integrations/xero', maxAge: 0 })
  return res
}
