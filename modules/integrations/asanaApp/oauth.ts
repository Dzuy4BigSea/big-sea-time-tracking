/**
 * Linking a Track2 person to their Asana user (specs/29 §3, AC-ASANAAPP-011). Pure + DB-free → unit-tested.
 *
 * Asana opens the app's Authentication URL in a popup. The person must be signed in to Track2; we then
 * send them through Asana OAuth (which proves which Asana user they are), save that user gid on their
 * Track2 user, and post "success" back to app.asana.com. The state is signed with AUTH_SECRET and bound to
 * the Track2 user and a browser nonce cookie, like the Xero flow.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { ASANA_ORIGIN } from './request'

export const ASANA_AUTHORIZE_URL = 'https://app.asana.com/-/oauth_authorize'
export const ASANA_TOKEN_URL = 'https://app.asana.com/-/oauth_token'
export const ASANA_APP_BASE_PATH = '/api/integrations/asana/app'
export const ASANA_APP_CALLBACK_PATH = `${ASANA_APP_BASE_PATH}/auth/callback`
export const ASANA_NONCE_COOKIE = 't2_asana_nonce'
export const ASANA_STATE_TTL_MS = 10 * 60 * 1000

export interface AsanaAppConfig {
  clientId: string
  clientSecret: string
}

/** The Asana app's credentials (Vercel env), or null when the app isn't set up here. */
export function asanaAppConfig(env: Record<string, string | undefined> = process.env): AsanaAppConfig | null {
  const clientId = (env.ASANA_APP_CLIENT_ID ?? '').trim()
  const clientSecret = (env.ASANA_APP_CLIENT_SECRET ?? '').trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

interface AsanaState {
  userId: string
  accountId: string
  nonce: string
  expiresAt: number
}

const b64url = (b: Buffer) => b.toString('base64url')
const stateKey = (secret: string) => createHmac('sha256', secret).update('track2:asana-app-state:v1').digest()

export function signAsanaState(input: { userId: string; accountId: string; nonce?: string }, secret: string, now: number = Date.now()): { state: string; nonce: string } {
  if (!secret) throw new Error('AUTH_SECRET is not set.')
  const nonce = input.nonce ?? b64url(randomBytes(18))
  const body: AsanaState = { userId: input.userId, accountId: input.accountId, nonce, expiresAt: now + ASANA_STATE_TTL_MS }
  const payload = b64url(Buffer.from(JSON.stringify(body), 'utf8'))
  return { state: `${payload}.${b64url(createHmac('sha256', stateKey(secret)).update(payload).digest())}`, nonce }
}

export function verifyAsanaState(
  raw: unknown,
  secret: string,
  expect: { userId: string; accountId: string; nonce: string | null | undefined },
  now: number = Date.now(),
): boolean {
  if (typeof raw !== 'string' || raw.length > 4000 || !secret) return false
  const dot = raw.indexOf('.')
  if (dot <= 0 || dot !== raw.lastIndexOf('.')) return false
  const payload = raw.slice(0, dot)
  const given = Buffer.from(raw.slice(dot + 1), 'base64url')
  const want = createHmac('sha256', stateKey(secret)).update(payload).digest()
  if (given.length !== want.length || !timingSafeEqual(given, want)) return false
  let s: AsanaState
  try {
    s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return false
  }
  if (!s || typeof s.userId !== 'string' || typeof s.nonce !== 'string' || typeof s.expiresAt !== 'number') return false
  if (now > s.expiresAt || s.userId !== expect.userId || s.accountId !== expect.accountId) return false
  const n = Buffer.from(String(expect.nonce ?? ''), 'utf8')
  const sn = Buffer.from(s.nonce, 'utf8')
  return !!expect.nonce && n.length === sn.length && timingSafeEqual(n, sn)
}

export function buildAsanaAuthorizeUrl(p: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({ response_type: 'code', client_id: p.clientId, redirect_uri: p.redirectUri, state: p.state })
  return `${ASANA_AUTHORIZE_URL}?${q.toString()}`
}

/** Exchange the code; Asana's token response names the user in `data` ({ gid, name, email }). */
export async function exchangeAsanaCode(
  fetchImpl: typeof fetch,
  p: AsanaAppConfig & { code: string; redirectUri: string },
): Promise<{ ok: true; userGid: string; email: string | null; name: string | null } | { ok: false; error: string }> {
  let res: Response
  try {
    res = await fetchImpl(ASANA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: p.clientId, client_secret: p.clientSecret, redirect_uri: p.redirectUri, code: p.code }).toString(),
    })
  } catch {
    return { ok: false, error: 'network' }
  }
  if (!res.ok) return { ok: false, error: `status_${res.status}` }
  const json = (await res.json().catch(() => null)) as { data?: { gid?: unknown; id?: unknown; email?: unknown; name?: unknown } } | null
  const gid = json?.data?.gid ?? json?.data?.id
  if (gid == null || !/^\d{1,32}$/.test(String(gid))) return { ok: false, error: 'no_user' }
  return {
    ok: true,
    userGid: String(gid),
    email: typeof json?.data?.email === 'string' ? json.data.email : null,
    name: typeof json?.data?.name === 'string' ? json.data.name : null,
  }
}

/**
 * The popup's last page: tells Asana the result and closes. The message goes only to app.asana.com.
 * Nothing user-controlled is interpolated into the script.
 */
export function popupResultHtml(ok: boolean, message: string): string {
  const esc = message.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
  const result = ok ? 'success' : 'error'
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Track2 · Asana</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f7f7f8;color:#1f2328}main{max-width:28rem;padding:2rem;text-align:center}</style></head>
<body><main><h1 style="font-size:1.25rem">${ok ? 'Linked to Track2' : 'Couldn’t link Track2'}</h1><p>${esc}</p><p>You can close this window.</p></main>
<script>try{if(window.opener){window.opener.postMessage(${JSON.stringify(result)},${JSON.stringify(ASANA_ORIGIN)});${ok ? 'setTimeout(function(){window.close()},800)' : ''}}}catch(e){}</script></body></html>`
}
