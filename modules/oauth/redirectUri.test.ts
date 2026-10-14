import { describe, it, expect } from 'vitest'
import { redirectUriMatches, validateRedirectUri, withParams } from './redirectUri'

describe('validateRedirectUri', () => {
  it("accepts Claude's callback and other https URIs", () => {
    expect(validateRedirectUri('https://claude.ai/api/mcp/auth_callback')).toEqual({ ok: true, uri: 'https://claude.ai/api/mcp/auth_callback' })
    expect(validateRedirectUri('https://example.com/cb?x=1').ok).toBe(true)
  })

  it('accepts http only on loopback hosts', () => {
    expect(validateRedirectUri('http://localhost:6274/oauth/callback').ok).toBe(true)
    expect(validateRedirectUri('http://127.0.0.1:33418/callback').ok).toBe(true)
    expect(validateRedirectUri('http://[::1]:8080/cb').ok).toBe(true)
    expect(validateRedirectUri('http://example.com/cb').ok).toBe(false)
    expect(validateRedirectUri('http://localhost.evil.com/cb').ok).toBe(false)
  })

  it('rejects custom schemes, fragments, credentials, junk', () => {
    expect(validateRedirectUri('javascript:alert(1)').ok).toBe(false)
    expect(validateRedirectUri('cursor://anysphere/cb').ok).toBe(false)
    expect(validateRedirectUri('data:text/html,hi').ok).toBe(false)
    expect(validateRedirectUri('https://claude.ai/cb#frag').ok).toBe(false)
    expect(validateRedirectUri('https://user:pw@claude.ai/cb').ok).toBe(false)
    expect(validateRedirectUri('/relative').ok).toBe(false)
    expect(validateRedirectUri('').ok).toBe(false)
    expect(validateRedirectUri(42).ok).toBe(false)
    expect(validateRedirectUri('https://a.com/' + 'x'.repeat(2100)).ok).toBe(false)
  })
})

describe('redirectUriMatches', () => {
  const registered = ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1:5000/callback']

  it('requires an exact match for https', () => {
    expect(redirectUriMatches(registered, 'https://claude.ai/api/mcp/auth_callback')).toBe(true)
    expect(redirectUriMatches(registered, 'https://claude.ai/api/mcp/auth_callback/')).toBe(false)
    expect(redirectUriMatches(registered, 'https://claude.ai/api/mcp/auth_callback?x=1')).toBe(false)
    expect(redirectUriMatches(registered, 'https://CLAUDE.ai/api/mcp/auth_callback')).toBe(false)
    expect(redirectUriMatches(registered, 'https://evil.com/api/mcp/auth_callback')).toBe(false)
  })

  it('lets a loopback URI change only its port (RFC 8252)', () => {
    expect(redirectUriMatches(registered, 'http://127.0.0.1:61234/callback')).toBe(true)
    expect(redirectUriMatches(registered, 'http://127.0.0.1:61234/other')).toBe(false)
    expect(redirectUriMatches(registered, 'http://localhost:5000/callback')).toBe(false)
  })
})

describe('withParams', () => {
  it('keeps the existing query and encodes values', () => {
    expect(withParams('https://claude.ai/cb?a=1', { code: 'c d', state: 's&t', missing: undefined })).toBe('https://claude.ai/cb?a=1&code=c+d&state=s%26t')
  })
})
