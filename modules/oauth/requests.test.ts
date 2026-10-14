import { describe, it, expect } from 'vitest'
import { isSameOriginPost, validateAuthorizeRequest, validateRegistration, type ClientView } from './requests'
import { clientAuthenticates, clientCredentials } from './clientAuth'
import { mintSecret } from './crypto'

const APP = 'https://track2.bigseabridge.com'
const CB = 'https://claude.ai/api/mcp/auth_callback'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
const client: ClientView = { id: 'row1', clientId: 'track2_client_abc', clientName: 'Claude', redirectUris: [CB] }

describe('validateRegistration (RFC 7591)', () => {
  it("accepts Claude's registration as a public client", () => {
    const r = validateRegistration({
      client_name: 'Claude',
      redirect_uris: [CB],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    })
    expect(r).toEqual({ ok: true, value: { clientName: 'Claude', redirectUris: [CB], tokenEndpointAuthMethod: 'none' } })
  })

  it('defaults to a public client and a generic name; de-dupes URIs; strips control chars', () => {
    const r = validateRegistration({ redirect_uris: [CB, CB], client_name: 'My\u0000 App' })
    expect(r).toEqual({ ok: true, value: { clientName: 'My App', redirectUris: [CB], tokenEndpointAuthMethod: 'none' } })
    expect(validateRegistration({ redirect_uris: [CB] })).toMatchObject({ ok: true, value: { clientName: 'MCP client' } })
  })

  it('allows confidential methods', () => {
    expect(validateRegistration({ redirect_uris: [CB], token_endpoint_auth_method: 'client_secret_post' })).toMatchObject({ ok: true })
  })

  it('rejects bad redirect URIs and metadata', () => {
    expect(validateRegistration({ redirect_uris: ['http://evil.com/cb'] })).toMatchObject({ ok: false, error: 'invalid_redirect_uri' })
    expect(validateRegistration({ redirect_uris: [] })).toMatchObject({ ok: false, error: 'invalid_redirect_uri' })
    expect(validateRegistration({})).toMatchObject({ ok: false, error: 'invalid_redirect_uri' })
    expect(validateRegistration({ redirect_uris: Array(11).fill(CB) })).toMatchObject({ ok: false })
    expect(validateRegistration({ redirect_uris: [CB], grant_types: ['implicit'] })).toMatchObject({ ok: false, error: 'invalid_client_metadata' })
    expect(validateRegistration({ redirect_uris: [CB], response_types: ['token'] })).toMatchObject({ ok: false })
    expect(validateRegistration({ redirect_uris: [CB], token_endpoint_auth_method: 'private_key_jwt' })).toMatchObject({ ok: false })
    expect(validateRegistration({ redirect_uris: [CB], client_name: 'x'.repeat(101) })).toMatchObject({ ok: false })
    expect(validateRegistration([CB])).toMatchObject({ ok: false })
  })
})

describe('validateAuthorizeRequest', () => {
  const good = {
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: CB,
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    resource: `${APP}/api/mcp`,
  }

  it('accepts a well-formed request', () => {
    expect(validateAuthorizeRequest(good, client, APP)).toEqual({
      kind: 'ok',
      request: { clientId: client.clientId, redirectUri: CB, state: 'xyz', codeChallenge: CHALLENGE, resource: `${APP}/api/mcp`, scope: undefined },
    })
  })

  it('never redirects for an unknown client or unregistered redirect URI (no open redirect)', () => {
    expect(validateAuthorizeRequest(good, null, APP).kind).toBe('fatal')
    expect(validateAuthorizeRequest({ ...good, client_id: undefined }, client, APP).kind).toBe('fatal')
    expect(validateAuthorizeRequest({ ...good, client_id: 'other' }, client, APP).kind).toBe('fatal')
    expect(validateAuthorizeRequest({ ...good, redirect_uri: 'https://evil.com/cb' }, client, APP).kind).toBe('fatal')
    expect(validateAuthorizeRequest({ ...good, redirect_uri: [CB, 'https://evil.com'] }, client, APP).kind).toBe('fatal')
  })

  it('uses the only registered URI when redirect_uri is omitted', () => {
    const r = validateAuthorizeRequest({ ...good, redirect_uri: undefined }, client, APP)
    expect(r).toMatchObject({ kind: 'ok', request: { redirectUri: CB } })
  })

  it('sends other errors back to the client with state', () => {
    const cases: Array<[Record<string, string | undefined>, string]> = [
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ code_challenge: undefined }, 'invalid_request'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ code_challenge_method: undefined }, 'invalid_request'],
      [{ code_challenge: 'short' }, 'invalid_request'],
      [{ resource: 'https://evil.com/api/mcp' }, 'invalid_target'],
    ]
    for (const [patch, error] of cases) {
      const r = validateAuthorizeRequest({ ...good, ...patch }, client, APP)
      expect(r).toMatchObject({ kind: 'redirect_error', redirectUri: CB, error, state: 'xyz' })
    }
  })

  it('accepts a missing resource (defaults to the MCP server)', () => {
    expect(validateAuthorizeRequest({ ...good, resource: undefined }, client, APP)).toMatchObject({ kind: 'ok', request: { resource: `${APP}/api/mcp` } })
  })
})

describe('consent CSRF guard', () => {
  it('requires the app origin', () => {
    expect(isSameOriginPost(APP, null, APP)).toBe(true)
    expect(isSameOriginPost('https://evil.com', 'same-origin', APP)).toBe(false)
    expect(isSameOriginPost('null', null, APP)).toBe(false)
    expect(isSameOriginPost(null, 'same-origin', APP)).toBe(true)
    expect(isSameOriginPost(null, 'cross-site', APP)).toBe(false)
    expect(isSameOriginPost(null, null, APP)).toBe(false)
  })
})

describe('client authentication', () => {
  const secret = mintSecret('track2_ocs_')

  it('public clients send client_id only', () => {
    const c = clientCredentials(null, { client_id: 'c1' })
    expect(c).toEqual({ clientId: 'c1', clientSecret: undefined, via: 'none' })
    expect(clientAuthenticates({ clientSecretHash: null }, c as never)).toBe(true)
    expect(clientAuthenticates({ clientSecretHash: null }, { clientId: 'c1', clientSecret: 'x', via: 'body' })).toBe(false)
  })

  it('confidential clients must present the secret (post or basic)', () => {
    const post = clientCredentials(null, { client_id: 'c1', client_secret: secret.value })
    expect(clientAuthenticates({ clientSecretHash: secret.hash }, post as never)).toBe(true)
    const basic = clientCredentials(`Basic ${Buffer.from(`c1:${encodeURIComponent(secret.value)}`).toString('base64')}`, {})
    expect(basic).toMatchObject({ clientId: 'c1', via: 'basic' })
    expect(clientAuthenticates({ clientSecretHash: secret.hash }, basic as never)).toBe(true)
    expect(clientAuthenticates({ clientSecretHash: secret.hash }, { clientId: 'c1', clientSecret: undefined, via: 'none' })).toBe(false)
    expect(clientAuthenticates({ clientSecretHash: secret.hash }, { clientId: 'c1', clientSecret: 'wrong', via: 'body' })).toBe(false)
  })

  it('rejects conflicting credentials', () => {
    const basic = `Basic ${Buffer.from('c1:s').toString('base64')}`
    expect(clientCredentials(basic, { client_id: 'c2' })).toHaveProperty('error')
    expect(clientCredentials(basic, { client_secret: 's' })).toHaveProperty('error')
    expect(clientCredentials(`Basic ${Buffer.from('nocolon').toString('base64')}`, {})).toHaveProperty('error')
  })
})
