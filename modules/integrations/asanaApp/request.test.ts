import { describe, it, expect } from 'vitest'
import { checkGet, checkPost, isExpired, parseExpiresAt, signAsanaPayload, verifyAsanaSignature } from './request'

const SECRET = 'app-secret'
const NOW = Date.parse('2026-10-19T12:00:00Z')
const LATER = '2026-10-19T12:05:00.000Z'

describe('verifyAsanaSignature', () => {
  it('accepts the hex HMAC of the payload, case-insensitively', () => {
    const sig = signAsanaPayload('a=1&b=2', SECRET)
    expect(verifyAsanaSignature('a=1&b=2', sig, SECRET)).toBe(true)
    expect(verifyAsanaSignature('a=1&b=2', sig.toUpperCase(), SECRET)).toBe(true)
  })
  it('rejects a changed payload, wrong secret, missing or malformed signature', () => {
    const sig = signAsanaPayload('a=1', SECRET)
    expect(verifyAsanaSignature('a=2', sig, SECRET)).toBe(false)
    expect(verifyAsanaSignature('a=1', sig, 'other')).toBe(false)
    expect(verifyAsanaSignature('a=1', null, SECRET)).toBe(false)
    expect(verifyAsanaSignature('a=1', 'zz', SECRET)).toBe(false)
    expect(verifyAsanaSignature('a=1', sig, '')).toBe(false)
  })
})

describe('expires_at', () => {
  it('parses epoch ms and ISO', () => {
    expect(parseExpiresAt('1760875200000')).toBe(1760875200000)
    expect(parseExpiresAt(1760875200000)).toBe(1760875200000)
    expect(parseExpiresAt(LATER)).toBe(Date.parse(LATER))
    expect(parseExpiresAt('nope')).toBeNull()
  })
  it('treats missing or past as expired', () => {
    expect(isExpired(undefined, NOW)).toBe(true)
    expect(isExpired('2026-10-19T11:59:59Z', NOW)).toBe(true)
    expect(isExpired(LATER, NOW)).toBe(false)
  })
})

describe('checkGet (AC-ASANAAPP-001)', () => {
  const q = `workspace=1&user=2&task=3&expires_at=${encodeURIComponent(LATER)}`
  it('accepts a signed, unexpired call and reads its params', () => {
    const r = checkGet(q, signAsanaPayload(q, SECRET), SECRET, NOW)
    expect(r.ok && r.call).toMatchObject({ workspace: '1', user: '2', task: '3' })
  })
  it('refuses a bad signature, an expired call, or a call without workspace/user', () => {
    expect(checkGet(q, signAsanaPayload(q + 'x', SECRET), SECRET, NOW)).toMatchObject({ ok: false, reason: 'signature' })
    const old = 'workspace=1&user=2&expires_at=2026-01-01T00:00:00Z'
    expect(checkGet(old, signAsanaPayload(old, SECRET), SECRET, NOW)).toMatchObject({ ok: false, reason: 'expired' })
    const bare = `task=3&expires_at=${LATER}`
    expect(checkGet(bare, signAsanaPayload(bare, SECRET), SECRET, NOW)).toMatchObject({ ok: false, reason: 'malformed' })
  })
})

describe('checkPost (AC-ASANAAPP-001)', () => {
  const inner = JSON.stringify({ workspace: '1', user: '2', task: '3', expires_at: LATER, values: { what: 'start' }, changed_field: 'what' })
  it('verifies the data string and unwraps it', () => {
    const r = checkPost(JSON.stringify({ data: inner }), signAsanaPayload(inner, SECRET), SECRET, NOW)
    expect(r.ok && r.call).toMatchObject({ workspace: '1', values: { what: 'start' }, changedField: 'what' })
  })
  it('accepts top-level fields signed over the raw body', () => {
    const r = checkPost(inner, signAsanaPayload(inner, SECRET), SECRET, NOW)
    expect(r.ok).toBe(true)
  })
  it('refuses a body whose data was altered after signing', () => {
    const sig = signAsanaPayload(inner, SECRET)
    const tampered = inner.replace('"start"', '"stop"')
    expect(checkPost(JSON.stringify({ data: tampered }), sig, SECRET, NOW)).toMatchObject({ ok: false, reason: 'signature' })
  })
  it('refuses non-JSON', () => {
    expect(checkPost('nope', 'x', SECRET, NOW)).toMatchObject({ ok: false, reason: 'malformed' })
  })
})
