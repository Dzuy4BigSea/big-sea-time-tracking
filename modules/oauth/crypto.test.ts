import { describe, it, expect } from 'vitest'
import {
  ACCESS_TOKEN_PREFIX,
  REFRESH_TOKEN_PREFIX,
  isValidCodeChallenge,
  isValidCodeVerifier,
  isWellFormed,
  mintClientId,
  mintSecret,
  s256Challenge,
  safeEqual,
  sha256Hex,
  verifyPkceS256,
  verifySecret,
} from './crypto'

describe('PKCE S256', () => {
  // Independent vector: printf '%s' "$verifier" | openssl dgst -sha256 -binary | base64url (unpadded).
  const verifier = 'dBjftJeZ4CVP-mJ92K9iHSWQR1ZgV1xWXz6Ph8FzgTk'
  const challenge = 'rW43cS4IRMTV75Yfgzv_f2IU2xWNs0cu_0l-V87Sv10'

  it('matches an openssl-computed S256 vector', () => {
    expect(s256Challenge(verifier)).toBe(challenge)
    expect(verifyPkceS256(verifier, challenge)).toBe(true)
  })

  it('rejects a wrong, missing or malformed verifier', () => {
    expect(verifyPkceS256(verifier.slice(0, -1) + 'x', challenge)).toBe(false)
    expect(verifyPkceS256(undefined, challenge)).toBe(false)
    expect(verifyPkceS256('', challenge)).toBe(false)
    expect(verifyPkceS256('short', s256Challenge('short'))).toBe(false) // < 43 chars
    expect(verifyPkceS256('a'.repeat(129), s256Challenge('a'.repeat(129)))).toBe(false) // > 128 chars
    expect(verifyPkceS256('a'.repeat(42) + '!', s256Challenge('a'.repeat(42) + '!'))).toBe(false) // bad charset
  })

  it('never accepts the plain method (challenge == verifier)', () => {
    const v = 'a'.repeat(43)
    expect(verifyPkceS256(v, v)).toBe(false)
  })

  it('validates verifier and challenge shapes', () => {
    expect(isValidCodeVerifier('A-._~'.repeat(9))).toBe(true)
    expect(isValidCodeVerifier('a'.repeat(128))).toBe(true)
    expect(isValidCodeChallenge(challenge)).toBe(true)
    expect(isValidCodeChallenge(challenge + '=')).toBe(false)
    expect(isValidCodeChallenge(challenge.slice(1))).toBe(false)
  })
})

describe('secrets', () => {
  it('mints prefixed 256-bit secrets with a sha256 hex hash', () => {
    const a = mintSecret(ACCESS_TOKEN_PREFIX)
    expect(isWellFormed(a.value, ACCESS_TOKEN_PREFIX)).toBe(true)
    expect(isWellFormed(a.value, REFRESH_TOKEN_PREFIX)).toBe(false)
    expect(a.hash).toBe(sha256Hex(a.value))
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(mintSecret(ACCESS_TOKEN_PREFIX).value).not.toBe(a.value)
  })

  it('verifies secrets against the stored hash in constant time', () => {
    const s = mintSecret('track2_ocs_')
    expect(verifySecret(s.value, s.hash)).toBe(true)
    expect(verifySecret(s.value + 'x', s.hash)).toBe(false)
    expect(verifySecret(s.value, 'nothex')).toBe(false)
  })

  it('compares strings safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })

  it('mints unguessable client ids', () => {
    expect(mintClientId()).toMatch(/^track2_client_[A-Za-z0-9_-]{24}$/)
    expect(mintClientId()).not.toBe(mintClientId())
  })
})
