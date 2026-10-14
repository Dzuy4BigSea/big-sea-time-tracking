import { describe, it, expect } from 'vitest'
import { authorizationServerMetadata, corsHeaders, mcpResource, normalizeResource, protectedResourceMetadata, wwwAuthenticate } from './metadata'

const APP = 'https://track2.bigseabridge.com'

describe('discovery metadata', () => {
  it('protected resource metadata (RFC 9728)', () => {
    const m = protectedResourceMetadata(APP)
    expect(m.resource).toBe('https://track2.bigseabridge.com/api/mcp')
    expect(m.authorization_servers).toEqual([APP])
    expect(m.bearer_methods_supported).toEqual(['header'])
  })

  it('authorization server metadata (RFC 8414)', () => {
    const m = authorizationServerMetadata(APP)
    expect(m).toMatchObject({
      issuer: APP,
      authorization_endpoint: `${APP}/oauth/authorize`,
      token_endpoint: `${APP}/api/oauth/token`,
      registration_endpoint: `${APP}/api/oauth/register`,
      revocation_endpoint: `${APP}/api/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
    })
    expect(m.token_endpoint_auth_methods_supported).toContain('none')
    expect(m.token_endpoint_auth_methods_supported).toContain('client_secret_post')
    expect(m.code_challenge_methods_supported).not.toContain('plain')
    expect(m.grant_types_supported).not.toContain('implicit')
  })
})

describe('WWW-Authenticate', () => {
  it('points at the protected resource metadata', () => {
    const h = wwwAuthenticate(APP)
    expect(h).toMatch(/^Bearer /)
    expect(h).toContain('resource_metadata="https://track2.bigseabridge.com/.well-known/oauth-protected-resource"')
    expect(h).not.toContain('invalid_token')
  })

  it('adds invalid_token only when a token was presented', () => {
    expect(wwwAuthenticate(APP, { tokenPresented: true })).toContain('error="invalid_token"')
  })

  it('is ASCII (header values are ByteStrings)', () => {
    // eslint-disable-next-line no-control-regex
    expect(/^[\x20-\x7e]*$/.test(wwwAuthenticate(APP, { tokenPresented: true }))).toBe(true)
  })
})

describe('resource (RFC 8707)', () => {
  it('defaults to and accepts only the MCP server', () => {
    expect(mcpResource(APP)).toBe(`${APP}/api/mcp`)
    expect(normalizeResource(undefined, APP)).toBe(`${APP}/api/mcp`)
    expect(normalizeResource('', APP)).toBe(`${APP}/api/mcp`)
    expect(normalizeResource(`${APP}/api/mcp`, APP)).toBe(`${APP}/api/mcp`)
    expect(normalizeResource(`${APP}/api/mcp/`, APP)).toBe(`${APP}/api/mcp`)
    expect(normalizeResource('https://evil.com/api/mcp', APP)).toBeNull()
    expect(normalizeResource(`${APP}/api/other`, APP)).toBeNull()
  })
})

describe('CORS', () => {
  it('allows any origin without credentials', () => {
    const h = corsHeaders('POST')
    expect(h['Access-Control-Allow-Origin']).toBe('*')
    expect(h).not.toHaveProperty('Access-Control-Allow-Credentials')
    expect(h['Access-Control-Allow-Headers']).toContain('Authorization')
    expect(h['Access-Control-Allow-Methods']).toBe('POST, OPTIONS')
  })
})
