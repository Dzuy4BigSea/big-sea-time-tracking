import { describe, expect, it, vi } from 'vitest'
import {
  buildXeroAuthorizeUrl,
  exchangeXeroCode,
  isXeroConnectError,
  pickXeroTenant,
  resolveXeroApp,
  signXeroState,
  verifyXeroState,
  XERO_DEFAULT_SCOPES,
  XERO_STATE_TTL_MS,
  xeroAuthEventId,
  xeroScopes,
  type XeroTenantRow,
} from './xeroOAuth'

const SECRET = 'test-auth-secret-0123456789'
const NOW = Date.UTC(2026, 9, 15, 12)
const who = { userId: 'u1', accountId: 'a1' }

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`
const org = (tenantId: string, authEventId: string | null, tenantType = 'ORGANISATION'): XeroTenantRow => ({ tenantId, tenantName: `Org ${tenantId}`, tenantType, authEventId })

describe('Xero OAuth state', () => {
  it('round-trips for the same user, entity and browser nonce', () => {
    const { state, nonce } = signXeroState({ ...who, entityId: 'ent-cl' }, SECRET, NOW)
    const r = verifyXeroState(state, SECRET, { ...who, nonce }, NOW + 1000)
    expect(r.ok && r.state.entityId).toBe('ent-cl')
  })

  it('refuses a tampered, expired, other-user or other-browser state', () => {
    const { state, nonce } = signXeroState({ ...who, entityId: 'ent-bs' }, SECRET, NOW)
    const [payload, sig] = state.split('.')
    const forged = Buffer.from(JSON.stringify({ ...who, entityId: 'ent-cl', nonce, expiresAt: NOW + XERO_STATE_TTL_MS })).toString('base64url')
    expect(verifyXeroState(`${forged}.${sig}`, SECRET, { ...who, nonce }, NOW)).toEqual({ ok: false, reason: 'signature' })
    expect(verifyXeroState(state, SECRET, { ...who, nonce }, NOW + XERO_STATE_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' })
    expect(verifyXeroState(state, SECRET, { userId: 'u2', accountId: 'a1', nonce }, NOW)).toEqual({ ok: false, reason: 'user' })
    expect(verifyXeroState(state, SECRET, { ...who, nonce: 'other' }, NOW)).toEqual({ ok: false, reason: 'nonce' })
    expect(verifyXeroState(state, SECRET, { ...who, nonce: undefined }, NOW)).toEqual({ ok: false, reason: 'nonce' })
    expect(verifyXeroState(`${payload}`, SECRET, { ...who, nonce }, NOW)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyXeroState(state, 'another-secret-0123456789', { ...who, nonce }, NOW)).toEqual({ ok: false, reason: 'signature' })
  })
})

describe('Xero app and scopes', () => {
  it('prefers the connection’s own client id / secret, then env, and needs both', () => {
    const env = { XERO_CLIENT_ID: 'env-id', XERO_CLIENT_SECRET: 'env-secret' }
    expect(resolveXeroApp({}, {}, env)).toEqual({ clientId: 'env-id', clientSecret: 'env-secret' })
    expect(resolveXeroApp({ clientId: 'row-id' }, { clientSecret: 'row-secret' }, env)).toEqual({ clientId: 'row-id', clientSecret: 'row-secret' })
    expect(resolveXeroApp({ clientId: 'row-id' }, {}, {})).toBeNull()
  })

  it('defaults to granular scopes and always keeps offline_access', () => {
    expect(xeroScopes({})).toBe(XERO_DEFAULT_SCOPES)
    expect(XERO_DEFAULT_SCOPES).toContain('offline_access')
    expect(xeroScopes({ XERO_SCOPES: ' accounting.transactions  accounting.contacts ' })).toBe('offline_access accounting.transactions accounting.contacts')
  })

  it('builds the authorize URL', () => {
    const u = new URL(buildXeroAuthorizeUrl({ clientId: 'cid', redirectUri: 'https://t2.example.com/api/integrations/xero/callback', scope: 'offline_access accounting.invoices', state: 's.t' }))
    expect(u.origin + u.pathname).toBe('https://login.xero.com/identity/connect/authorize')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'cid',
      redirect_uri: 'https://t2.example.com/api/integrations/xero/callback',
      scope: 'offline_access accounting.invoices',
      state: 's.t',
    })
  })
})

describe('pickXeroTenant', () => {
  it('reads the auth event id from the access token', () => {
    expect(xeroAuthEventId(jwt({ authentication_event_id: 'ev1' }))).toBe('ev1')
    expect(xeroAuthEventId('opaque')).toBeNull()
  })

  it('picks the organisation authorised in this sign-in, ignoring older ones and practices', () => {
    const rows = [org('bs', 'ev-old'), org('cl', 'ev-new'), org('px', 'ev-new', 'PRACTICE')]
    expect(pickXeroTenant(rows, 'ev-new', null)).toEqual({ ok: true, tenant: rows[1] })
  })

  it('keeps the current tenant when several match, otherwise asks for one', () => {
    const rows = [org('bs', 'ev'), org('cl', 'ev')]
    expect(pickXeroTenant(rows, 'ev', 'cl')).toEqual({ ok: true, tenant: rows[1] })
    expect(pickXeroTenant(rows, 'ev', null)).toEqual({ ok: false, error: 'several_organisations' })
    expect(pickXeroTenant([], 'ev', null)).toEqual({ ok: false, error: 'no_organisation' })
  })

  it('falls back to every organisation when the token carries no event id', () => {
    expect(pickXeroTenant([org('bs', null)], null, null)).toEqual({ ok: true, tenant: org('bs', null) })
  })
})

describe('exchangeXeroCode', () => {
  const p = { tokenUrl: 'https://identity.xero.com/connect/token', code: 'c', clientId: 'id', clientSecret: 'sec', redirectUri: 'https://x/cb' }

  it('posts the code with basic auth and returns the tokens', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 1800 }), { status: 200 }))
    expect(await exchangeXeroCode(fetchFn as unknown as typeof fetch, p)).toEqual({ ok: true, accessToken: 'at', refreshToken: 'rt', expiresIn: 1800 })
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('id:sec').toString('base64')}`)
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({ grant_type: 'authorization_code', code: 'c', redirect_uri: 'https://x/cb' })
  })

  it('maps refusals and network errors to codes', async () => {
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))
    expect(await exchangeXeroCode(refused as unknown as typeof fetch, p)).toEqual({ ok: false, error: 'invalid_grant', status: 400 })
    const down = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    expect(await exchangeXeroCode(down as unknown as typeof fetch, p)).toEqual({ ok: false, error: 'network' })
  })
})

it('recognises only known result codes', () => {
  expect(isXeroConnectError('state')).toBe(true)
  expect(isXeroConnectError('toString')).toBe(false)
})
