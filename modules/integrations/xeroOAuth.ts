import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * "Connect to Xero" (OPS.md "Xero sync", specs/14 AC-XERO-014): pure, DB-free pieces of the in-app
 * OAuth2 code flow. The routes live in app/api/integrations/xero/{connect,callback}.
 *
 * - One sign-in per company (business entity): each gets its own token set, so two connections never
 *   share a rotating refresh token.
 * - The `state` is HMAC-signed with AUTH_SECRET, bound to the Track2 user, the entity and a browser
 *   nonce cookie, and expires after XERO_STATE_TTL_MS.
 * - The organisation is the one picked on Xero's consent screen: connections are filtered by the
 *   access token's `authentication_event_id`.
 *
 * Nothing here logs or returns token values; error results carry only codes and HTTP statuses.
 */

export const XERO_AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize'
export const XERO_CALLBACK_PATH = '/api/integrations/xero/callback'
export const XERO_NONCE_COOKIE = 't2_xero_nonce'
export const XERO_STATE_TTL_MS = 10 * 60 * 1000

/**
 * Xero's granular scopes (apps created after 2 March 2026 get only these). `offline_access` gives the
 * refresh token; `accounting.settings.read` lets the health check read the Organisation.
 * Override with XERO_SCOPES (e.g. `offline_access accounting.transactions accounting.contacts` for an
 * older app on the broad scopes).
 */
export const XERO_DEFAULT_SCOPES = 'offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings.read'

export function xeroScopes(env: Record<string, string | undefined> = process.env): string {
  const s = (env.XERO_SCOPES ?? '').trim().split(/\s+/).filter(Boolean)
  if (!s.length) return XERO_DEFAULT_SCOPES
  if (!s.includes('offline_access')) s.unshift('offline_access')
  return s.join(' ')
}

/**
 * The Xero app's credentials for one connection: the connection's own (Settings fields) first, then
 * Vercel env. The connect flow and the token refresh must resolve the same app, or Xero refuses the
 * refresh (`invalid_client`).
 */
export function resolveXeroApp(
  cfg: Record<string, unknown>,
  secrets: Record<string, string>,
  env: Record<string, string | undefined> = process.env,
): { clientId: string; clientSecret: string } | null {
  const clientId = String(cfg.clientId ?? '').trim() || (env.XERO_CLIENT_ID ?? '').trim()
  const clientSecret = (secrets.clientSecret ?? '').trim() || (env.XERO_CLIENT_SECRET ?? '').trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

// ── State ───────────────────────────────────────────────────────────────────────────────────────

export interface XeroState {
  userId: string
  accountId: string
  entityId: string
  nonce: string
  expiresAt: number
}

const b64url = (b: Buffer) => b.toString('base64url')

function stateKey(secret: string): Buffer {
  // Domain-separated from Auth.js and the Google Drive flow, which use the same AUTH_SECRET.
  return createHmac('sha256', secret).update('track2:xero-oauth-state:v1').digest()
}

export function signXeroState(
  input: { userId: string; accountId: string; entityId: string; nonce?: string },
  secret: string,
  now: number = Date.now(),
): { state: string; nonce: string } {
  if (!secret) throw new Error('AUTH_SECRET is not set.')
  const nonce = input.nonce ?? b64url(randomBytes(18))
  const body: XeroState = { userId: input.userId, accountId: input.accountId, entityId: input.entityId, nonce, expiresAt: now + XERO_STATE_TTL_MS }
  const payload = b64url(Buffer.from(JSON.stringify(body), 'utf8'))
  const sig = b64url(createHmac('sha256', stateKey(secret)).update(payload).digest())
  return { state: `${payload}.${sig}`, nonce }
}

export type XeroStateCheck = { ok: true; state: XeroState } | { ok: false; reason: 'malformed' | 'signature' | 'expired' | 'user' | 'nonce' }

/** Verify signature, expiry, the signed-in user and the browser nonce cookie. */
export function verifyXeroState(
  raw: unknown,
  secret: string,
  expect: { userId: string; accountId: string; nonce: string | null | undefined },
  now: number = Date.now(),
): XeroStateCheck {
  if (typeof raw !== 'string' || raw.length > 4000 || !secret) return { ok: false, reason: 'malformed' }
  const dot = raw.indexOf('.')
  if (dot <= 0 || dot !== raw.lastIndexOf('.')) return { ok: false, reason: 'malformed' }
  const payload = raw.slice(0, dot)
  const given = Buffer.from(raw.slice(dot + 1), 'base64url')
  const want = createHmac('sha256', stateKey(secret)).update(payload).digest()
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { ok: false, reason: 'signature' }
  let s: XeroState
  try {
    s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!s || typeof s !== 'object' || typeof s.userId !== 'string' || typeof s.entityId !== 'string' || typeof s.nonce !== 'string' || typeof s.expiresAt !== 'number') {
    return { ok: false, reason: 'malformed' }
  }
  if (now > s.expiresAt) return { ok: false, reason: 'expired' }
  if (s.userId !== expect.userId || s.accountId !== expect.accountId) return { ok: false, reason: 'user' }
  const n = Buffer.from(String(expect.nonce ?? ''), 'utf8')
  const sn = Buffer.from(s.nonce, 'utf8')
  if (!expect.nonce || n.length !== sn.length || !timingSafeEqual(n, sn)) return { ok: false, reason: 'nonce' }
  return { ok: true, state: s }
}

// ── OAuth ───────────────────────────────────────────────────────────────────────────────────────

export function buildXeroAuthorizeUrl(p: { clientId: string; redirectUri: string; scope: string; state: string }): string {
  const q = new URLSearchParams({ response_type: 'code', client_id: p.clientId, redirect_uri: p.redirectUri, scope: p.scope, state: p.state })
  return `${XERO_AUTHORIZE_URL}?${q.toString()}`
}

/** The `authentication_event_id` claim of Xero's (JWT) access token, or null. Not a signature check: the token came straight from Xero over TLS. */
export function xeroAuthEventId(accessToken: string): string | null {
  const parts = accessToken.split('.')
  if (parts.length !== 3) return null
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return typeof claims?.authentication_event_id === 'string' ? claims.authentication_event_id : null
  } catch {
    return null
  }
}

export interface XeroTenantRow {
  tenantId: string
  tenantName: string
  tenantType: string
  authEventId: string | null
}

export type TenantPick = { ok: true; tenant: XeroTenantRow } | { ok: false; error: 'no_organisation' | 'several_organisations' }

/**
 * The organisation this sign-in authorised. Xero's /connections lists every org the app is connected
 * to for this user; the ones from this sign-in share the token's authentication_event_id. Several
 * matches: keep the connection's current tenant if it is one of them, else ask for a single org.
 */
export function pickXeroTenant(rows: XeroTenantRow[], authEventId: string | null, currentTenantId: string | null): TenantPick {
  const orgs = rows.filter((r) => r.tenantType === 'ORGANISATION')
  const fromThisSignIn = authEventId ? orgs.filter((r) => r.authEventId === authEventId) : []
  const candidates = fromThisSignIn.length ? fromThisSignIn : orgs
  if (candidates.length === 1) return { ok: true, tenant: candidates[0] }
  if (!candidates.length) return { ok: false, error: 'no_organisation' }
  const current = currentTenantId ? candidates.find((r) => r.tenantId === currentTenantId) : undefined
  return current ? { ok: true, tenant: current } : { ok: false, error: 'several_organisations' }
}

export type XeroCodeResult =
  | { ok: true; accessToken: string; refreshToken: string | null; expiresIn: number }
  | { ok: false; error: 'invalid_grant' | 'http' | 'network'; status?: number }

export async function exchangeXeroCode(
  fetchFn: typeof fetch,
  p: { tokenUrl: string; code: string; clientId: string; clientSecret: string; redirectUri: string },
): Promise<XeroCodeResult> {
  let res: Response
  try {
    res = await fetchFn(p.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${p.clientId}:${p.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri }).toString(),
      cache: 'no-store',
    })
  } catch {
    return { ok: false, error: 'network' }
  }
  let json: Record<string, unknown> = {}
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) return { ok: false, error: json.error === 'invalid_grant' ? 'invalid_grant' : 'http', status: res.status }
  if (typeof json.access_token !== 'string' || !json.access_token) return { ok: false, error: 'http', status: res.status }
  return {
    ok: true,
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' && json.refresh_token ? json.refresh_token : null,
    expiresIn: Number(json.expires_in ?? 1800) || 1800,
  }
}

/** Result codes the callback hands back to the settings page (`?xero=` / `?xeroError=`). */
export const XERO_CONNECT_ERRORS = {
  not_configured: 'Set XERO_CLIENT_ID and XERO_CLIENT_SECRET (or the client fields below) before connecting.',
  state: 'The Xero sign-in expired or came from another browser. Try Connect again.',
  denied: 'Xero sign-in was cancelled.',
  token: 'Xero refused the sign-in code. Check the app’s redirect URI and client secret, then try again.',
  no_refresh_token: 'Xero sent no refresh token. The app needs the offline_access scope.',
  no_organisation: 'No Xero organisation was authorised. Pick an organisation on Xero’s consent screen.',
  several_organisations: 'Several Xero organisations were authorised at once. Connect again and pick only this company’s organisation.',
  connections: 'Could not read the authorised organisation from Xero. Try again.',
  forbidden: 'You do not have permission to manage integrations.',
} as const

export type XeroConnectError = keyof typeof XERO_CONNECT_ERRORS

export function isXeroConnectError(v: unknown): v is XeroConnectError {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(XERO_CONNECT_ERRORS, v)
}
