/**
 * Personal access tokens (specs/22 §Auth model). Pure helpers: minting, hashing, parsing.
 *
 * Format: `track2_pat_<43 base64url chars>` (32 random bytes). Only the SHA-256 hex digest is stored
 * (ApiToken.tokenHash, unique); the plaintext is shown once at creation. `prefix` keeps the first 8
 * characters of the secret part so the settings page can tell tokens apart without exposing them.
 * A high-entropy random secret needs no salt or slow hash: lookup is by digest equality.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const TOKEN_PREFIX = 'track2_pat_'
const SECRET_BYTES = 32
/** base64url of 32 bytes, unpadded. */
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/
export const MAX_TOKEN_NAME = 80

export interface MintedToken {
  /** The full token, shown to the user exactly once. */
  token: string
  /** SHA-256 hex digest stored in the DB. */
  tokenHash: string
  /** First 8 chars of the secret part, for display ("track2_pat_abcd1234…"). */
  prefix: string
}

export function mintToken(random: (n: number) => Buffer = randomBytes): MintedToken {
  const secret = random(SECRET_BYTES).toString('base64url')
  const token = `${TOKEN_PREFIX}${secret}`
  return { token, tokenHash: hashToken(token), prefix: secret.slice(0, 8) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** True when the string has the exact shape of a Track2 personal token. */
export function isWellFormedToken(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX) && SECRET_RE.test(token.slice(TOKEN_PREFIX.length))
}

/** Constant-time check that `token` hashes to `storedHash`. */
export function verifyToken(token: string, storedHash: string): boolean {
  if (!isWellFormedToken(token)) return false
  const a = Buffer.from(hashToken(token), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The token from an `Authorization: Bearer …` header, or null when absent / not a Track2 token.
 * The scheme is case-insensitive (RFC 6750); the token itself is not.
 */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null
  const m = /^\s*bearer\s+(\S+)\s*$/i.exec(header)
  if (!m) return null
  return isWellFormedToken(m[1]) ? m[1] : null
}

/** Masked display form for lists: "track2_pat_abcd1234…". */
export function displayToken(prefix: string): string {
  return `${TOKEN_PREFIX}${prefix}…`
}

/** Trimmed token name, or an error message. */
export function validateTokenName(raw: string): { name: string } | { error: string } {
  const name = raw.trim()
  if (!name) return { error: 'Give the token a name (e.g. “Claude on my laptop”).' }
  if (name.length > MAX_TOKEN_NAME) return { error: `Keep the name under ${MAX_TOKEN_NAME} characters.` }
  return { name }
}

/** Only touch lastUsedAt when it is older than this, so every call isn't a write. */
export const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000

export function shouldTouchLastUsed(lastUsedAt: Date | null, now: Date): boolean {
  return !lastUsedAt || now.getTime() - lastUsedAt.getTime() >= LAST_USED_RESOLUTION_MS
}
