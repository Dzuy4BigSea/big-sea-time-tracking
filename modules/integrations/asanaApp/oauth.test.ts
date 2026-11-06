import { describe, it, expect, vi } from 'vitest'
import { asanaAppConfig, buildAsanaAuthorizeUrl, exchangeAsanaCode, popupResultHtml, signAsanaState, verifyAsanaState } from './oauth'

const SECRET = 'auth-secret'
const who = { userId: 'u1', accountId: 'a1' }

describe('asanaAppConfig', () => {
  it('needs both id and secret', () => {
    expect(asanaAppConfig({ ASANA_APP_CLIENT_ID: '1', ASANA_APP_CLIENT_SECRET: 's' })).toEqual({ clientId: '1', clientSecret: 's' })
    expect(asanaAppConfig({ ASANA_APP_CLIENT_ID: '1' })).toBeNull()
  })
})

describe('state (AC-ASANAAPP-011)', () => {
  it('verifies for the same user + nonce', () => {
    const { state, nonce } = signAsanaState(who, SECRET, 1000)
    expect(verifyAsanaState(state, SECRET, { ...who, nonce }, 2000)).toBe(true)
  })
  it('refuses another user, another browser, expiry, tampering', () => {
    const { state, nonce } = signAsanaState(who, SECRET, 1000)
    expect(verifyAsanaState(state, SECRET, { ...who, userId: 'u2', nonce }, 2000)).toBe(false)
    expect(verifyAsanaState(state, SECRET, { ...who, nonce: 'other' }, 2000)).toBe(false)
    expect(verifyAsanaState(state, SECRET, { ...who, nonce: null }, 2000)).toBe(false)
    expect(verifyAsanaState(state, SECRET, { ...who, nonce }, 1000 + 11 * 60_000)).toBe(false)
    expect(verifyAsanaState(state.replace(/^./, 'x'), SECRET, { ...who, nonce }, 2000)).toBe(false)
    expect(verifyAsanaState(state, 'other-secret', { ...who, nonce }, 2000)).toBe(false)
  })
})

describe('authorize + exchange', () => {
  it('builds the authorize URL', () => {
    const u = new URL(buildAsanaAuthorizeUrl({ clientId: '12', redirectUri: 'https://t2/cb', state: 's' }))
    expect(u.origin + u.pathname).toBe('https://app.asana.com/-/oauth_authorize')
    expect(Object.fromEntries(u.searchParams)).toEqual({ response_type: 'code', client_id: '12', redirect_uri: 'https://t2/cb', state: 's' })
  })
  it('reads the Asana user from the token response', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ access_token: 'x', data: { gid: '1100', email: 'dana@bigsea.co', name: 'Dana' } }), { status: 200 }))
    expect(await exchangeAsanaCode(f as any, { clientId: '1', clientSecret: 's', code: 'c', redirectUri: 'r' })).toEqual({ ok: true, userGid: '1100', email: 'dana@bigsea.co', name: 'Dana' })
    const body = String((f.mock.calls[0] as any)[1].body)
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('code=c')
  })
  it('fails on HTTP error or missing user', async () => {
    expect(await exchangeAsanaCode((async () => new Response('', { status: 400 })) as any, { clientId: '1', clientSecret: 's', code: 'c', redirectUri: 'r' })).toEqual({ ok: false, error: 'status_400' })
    expect(await exchangeAsanaCode((async () => new Response('{}', { status: 200 })) as any, { clientId: '1', clientSecret: 's', code: 'c', redirectUri: 'r' })).toEqual({ ok: false, error: 'no_user' })
  })
})

describe('popupResultHtml', () => {
  it('posts success only to app.asana.com and escapes the message', () => {
    const html = popupResultHtml(true, '<b>hi</b>')
    expect(html).toContain('postMessage("success","https://app.asana.com")')
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;')
    expect(popupResultHtml(false, 'x')).toContain('postMessage("error"')
  })
})
