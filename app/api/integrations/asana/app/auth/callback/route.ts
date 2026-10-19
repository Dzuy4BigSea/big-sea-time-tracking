import { cookies } from 'next/headers'
import { getCurrentUser } from '@/lib/session'
import { resolveAppUrl } from '@/lib/appUrl'
import { linkAsanaUser } from '@/lib/asanaApp'
import {
  asanaAppConfig, ASANA_APP_BASE_PATH, ASANA_APP_CALLBACK_PATH, ASANA_NONCE_COOKIE, exchangeAsanaCode, popupResultHtml, verifyAsanaState,
} from '@/modules/integrations/asanaApp/oauth'

export const dynamic = 'force-dynamic'

/**
 * Asana OAuth comes back here (specs/29, AC-ASANAAPP-011): check the Track2 session, the signed state for
 * this user + browser, exchange the code, save the Asana user gid on this person, and tell Asana.
 */
export async function GET(req: Request) {
  const cfg = asanaAppConfig()
  const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!cfg || !authSecret) return done(false, 'The Track2 Asana app isn’t configured yet.', 503)
  const me = await getCurrentUser()
  if (!me) return done(false, 'Sign in to Track2, then try again.', 401)

  const sp = new URL(req.url).searchParams
  const okState = verifyAsanaState(sp.get('state'), authSecret, { userId: me.userId, accountId: me.accountId, nonce: cookies().get(ASANA_NONCE_COOKIE)?.value })
  if (!okState) return done(false, 'This link expired or was opened in another browser. Try again.', 422)
  const code = sp.get('code')
  if (sp.get('error') || !code) return done(false, 'Asana access wasn’t allowed.', 400)

  const tok = await exchangeAsanaCode(fetch, { ...cfg, code, redirectUri: `${resolveAppUrl()}${ASANA_APP_CALLBACK_PATH}` })
  if (!tok.ok) {
    console.warn(`[asana-app] code exchange failed (${tok.error})`)
    return done(false, 'Asana didn’t confirm who you are. Try again.', 502)
  }
  await linkAsanaUser(me.accountId, me.userId, tok.userGid)
  return done(true, `Your Asana account${tok.name ? ` (${tok.name})` : ''} is now linked to Track2.`)
}

function done(ok: boolean, message: string, status = 200): Response {
  const res = new Response(popupResultHtml(ok, message), { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
  // The nonce is single-use.
  res.headers.append('Set-Cookie', `${ASANA_NONCE_COOKIE}=; Path=${ASANA_APP_BASE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax`)
  return res
}
