/**
 * MCP OAuth 2.1 secrets (specs/22 §OAuth). Pure helpers: minting, hashing, PKCE, constant-time checks.
 *
 * Every secret is 32 random bytes, base64url (43 chars), behind a recognisable prefix so leaked
 * strings are easy to scan for. Only the SHA-256 hex digest is stored; lookup is by digest equality
 * on a unique index (high-entropy secrets need no salt or slow hash), and any comparison against a
 * stored value is constant-time.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const ACCESS_TOKEN_PREFIX = 'track2_oat_'
export const REFRESH_TOKEN_PREFIX = 'track2_ort_'
export const AUTH_CODE_PREFIX = 'track2_oac_'
export const CLIENT_SECRET_PREFIX = 'track2_ocs_'
export const CLIENT_ID_PREFIX = 'track2_client_'

export const AUTH_CODE_TTL_MS = 10 * 60 * 1000
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

const SECRET_RE = /^[A-Za-z0-9_-]{43}$/

export type Random = (n: number) => Buffer

export interface MintedSecret {
  value: string
  hash: string
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

export function mintSecret(prefix: string, random: Random = randomBytes): MintedSecret {
  const value = `${prefix}${random(32).toString('base64url')}`
  return { value, hash: sha256Hex(value) }
}

/** A public client identifier (not a secret, but unguessable so ids can't be enumerated). */
export function mintClientId(random: Random = randomBytes): string {
  return `${CLIENT_ID_PREFIX}${random(18).toString('base64url')}`
}

/** True when `value` has the exact shape of a Track2 secret with this prefix. */
export function isWellFormed(value: string, prefix: string): boolean {
  return typeof value === 'string' && value.startsWith(prefix) && SECRET_RE.test(value.slice(prefix.length))
}

/** Constant-time: does `value` hash to `storedHash` (hex)? */
export function verifySecret(value: string, storedHash: string): boolean {
  const a = Buffer.from(sha256Hex(value), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && b.length === 32 && timingSafeEqual(a, b)
}

/** Constant-time string equality (lengths are not secret). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}

// ── PKCE (RFC 7636), S256 only ──────────────────────────────────────────────────────────────────
/** code_verifier: 43–128 chars of [A-Z a-z 0-9 - . _ ~]. */
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/
/** S256 code_challenge: base64url(sha256) = 43 chars, unpadded. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/

export function isValidCodeVerifier(v: unknown): v is string {
  return typeof v === 'string' && VERIFIER_RE.test(v)
}

export function isValidCodeChallenge(c: unknown): c is string {
  return typeof c === 'string' && CHALLENGE_RE.test(c)
}

export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

/** BASE64URL(SHA256(code_verifier)) == code_challenge, compared in constant time. */
export function verifyPkceS256(verifier: unknown, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier) || !isValidCodeChallenge(challenge)) return false
  return safeEqual(s256Challenge(verifier), challenge)
}
