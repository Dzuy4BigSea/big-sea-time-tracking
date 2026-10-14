import { describe, it, expect } from 'vitest'
import {
  mintToken,
  hashToken,
  verifyToken,
  bearerToken,
  isWellFormedToken,
  displayToken,
  validateTokenName,
  shouldTouchLastUsed,
  TOKEN_PREFIX,
} from './token'

describe('personal access tokens', () => {
  it('mints track2_pat_ tokens with a sha256 hash and an 8-char display prefix', () => {
    const t = mintToken()
    expect(t.token.startsWith(TOKEN_PREFIX)).toBe(true)
    expect(isWellFormedToken(t.token)).toBe(true)
    expect(t.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(t.tokenHash).toBe(hashToken(t.token))
    expect(t.prefix).toHaveLength(8)
    expect(t.token.slice(TOKEN_PREFIX.length, TOKEN_PREFIX.length + 8)).toBe(t.prefix)
    expect(displayToken(t.prefix)).toBe(`track2_pat_${t.prefix}…`)
  })

  it('mints a different token each time', () => {
    expect(mintToken().token).not.toBe(mintToken().token)
  })

  it('is deterministic for a given random source', () => {
    const fixed = () => Buffer.alloc(32, 7)
    expect(mintToken(fixed)).toEqual(mintToken(fixed))
  })

  it('verifies only the matching token', () => {
    const a = mintToken()
    const b = mintToken()
    expect(verifyToken(a.token, a.tokenHash)).toBe(true)
    expect(verifyToken(b.token, a.tokenHash)).toBe(false)
    expect(verifyToken(a.token + 'x', a.tokenHash)).toBe(false)
    expect(verifyToken('', a.tokenHash)).toBe(false)
    expect(verifyToken(a.token, 'nothex')).toBe(false)
  })

  it('parses Bearer headers', () => {
    const { token } = mintToken()
    expect(bearerToken(`Bearer ${token}`)).toBe(token)
    expect(bearerToken(`bearer ${token}`)).toBe(token)
    expect(bearerToken(`  Bearer   ${token}  `)).toBe(token)
    expect(bearerToken(token)).toBeNull()
    expect(bearerToken(`Basic ${token}`)).toBeNull()
    expect(bearerToken('Bearer track2_pat_short')).toBeNull()
    expect(bearerToken('Bearer sk-other-token')).toBeNull()
    expect(bearerToken(null)).toBeNull()
  })

  it('validates names', () => {
    expect(validateTokenName('  Claude  ')).toEqual({ name: 'Claude' })
    expect(validateTokenName('   ')).toHaveProperty('error')
    expect(validateTokenName('x'.repeat(81))).toHaveProperty('error')
  })

  it('throttles lastUsedAt writes', () => {
    const now = new Date('2026-10-14T12:00:00Z')
    expect(shouldTouchLastUsed(null, now)).toBe(true)
    expect(shouldTouchLastUsed(new Date('2026-10-14T11:58:00Z'), now)).toBe(false)
    expect(shouldTouchLastUsed(new Date('2026-10-14T11:50:00Z'), now)).toBe(true)
  })
})
