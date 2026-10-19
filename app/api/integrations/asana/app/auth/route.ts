import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { resolveAppUrl } from '@/lib/appUrl'
import {
  asanaAppConfig, ASANA_APP_BASE_PATH, ASANA_APP_CALLBACK_PATH, ASANA_NONCE_COOKIE, ASANA_STATE_TTL_MS, buildAsanaAuthorizeUrl, popupResultHtml, signAsanaState,
} from '@/modules/integrations/asanaApp/oauth'

export const dynamic = 'force-dynamic'

/**
 * The Asana app's Authentication URL (specs/29, AC-ASANAAPP-011). Asana opens it in a popup when the app
 * is added; a person can also open it directly to link their Asana user. Requires a Track2 session
 * (signed-out people sign in and come back), then sends them through Asana OAuth.
 */
export async function GET(req: Request) {
  const cfg = asanaAppConfig()
  const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!cfg || !authSecret) return html(popupResultHtml(false, 'The Track2 Asana app isn’t configured yet. Ask a Track2 admin.'), 503)
  const me = await getCurrentUser()
  if (!me) return NextResponse.redirect(new URL(`/login?callbackUrl=${encodeURIComponent(`${ASANA_APP_BASE_PATH}/auth`)}`, req.url), 303)

  const { state, nonce } = signAsanaState({ userId: me.userId, accountId: me.accountId }, authSecret)
  const res = NextResponse.redirect(buildAsanaAuthorizeUrl({ clientId: cfg.clientId, redirectUri: `${resolveAppUrl()}${ASANA_APP_CALLBACK_PATH}`, state }), 303)
  // Binds the state to this browser; Lax so it rides Asana's top-level redirect back.
  res.cookies.set(ASANA_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: new URL(req.url).protocol === 'https:',
    sameSite: 'lax',
    path: ASANA_APP_BASE_PATH,
    maxAge: Math.floor(ASANA_STATE_TTL_MS / 1000),
  })
  return res
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}
