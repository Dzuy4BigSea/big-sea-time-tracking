/**
 * MCP OAuth 2.1 code and token lifecycle (specs/22 §OAuth), written against a small storage interface
 * so the rules are unit-tested with an in-memory store; lib/oauth/store.ts is the Prisma version.
 *
 *   consent      → issueAuthorizationCode   (10 min, hashed, bound to client/redirect/user/PKCE/resource)
 *   code + PKCE  → exchangeAuthorizationCode (one-time; a replayed code revokes what it produced)
 *   refresh      → refreshTokens            (rotating; a replayed refresh token revokes the grant)
 *   revoke       → revokeToken              (RFC 7009: revokes the whole grant)
 *   /api/mcp     → resolveAccessToken
 */
import { randomBytes } from 'node:crypto'
import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_TTL_MS,
  AUTH_CODE_PREFIX,
  AUTH_CODE_TTL_MS,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_MS,
  isWellFormed,
  mintSecret,
  sha256Hex,
  verifyPkceS256,
  type Random,
} from './crypto'

// ── Storage contract ───────────────────────────────────────────────────────────────────────────

export interface CodeRecord {
  id: string
  clientId: string // OAuthClient row id
  accountId: string
  userId: string
  redirectUri: string
  codeChallenge: string
  resource: string
  scope: string | null
  expiresAt: Date
  grantId: string | null
}

export interface GrantRecord {
  id: string
  accountId: string
  userId: string
  clientId: string // OAuthClient row id
  resource: string
  scope: string | null
  revokedAt: Date | null
  /** Throttled "last used" for the connected-apps list (optional for stores that don't track it). */
  lastUsedAt?: Date | null
}

export interface TokenRecord {
  id: string
  kind: 'access' | 'refresh'
  expiresAt: Date
  rotatedAt: Date | null
  revokedAt: Date | null
  grant: GrantRecord
}

export interface NewToken {
  kind: 'access' | 'refresh'
  tokenHash: string
  expiresAt: Date
}

export interface OAuthStore {
  createCode(code: Omit<CodeRecord, 'id' | 'grantId'> & { codeHash: string }): Promise<void>
  /** Atomically mark the code used. 'reused' when it had already been consumed. */
  consumeCode(codeHash: string, now: Date): Promise<{ status: 'ok'; code: CodeRecord } | { status: 'reused'; code: CodeRecord } | { status: 'missing' }>
  /** Create the grant and its first tokens, and remember the grant on the code — one transaction. */
  createGrant(input: { codeId: string; grant: Omit<GrantRecord, 'id' | 'revokedAt' | 'lastUsedAt'>; tokens: NewToken[] }): Promise<string>
  findToken(tokenHash: string): Promise<TokenRecord | null>
  /** Atomically mark a refresh token rotated and add the new tokens. False if it was already rotated. */
  rotateRefresh(oldTokenId: string, grantId: string, now: Date, tokens: NewToken[]): Promise<boolean>
  revokeGrant(grantId: string, now: Date): Promise<void>
}

// ── Results ────────────────────────────────────────────────────────────────────────────────────

export type OAuthErrorCode = 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unsupported_grant_type' | 'invalid_target'

export interface OAuthError {
  error: OAuthErrorCode
  error_description: string
}

export interface TokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope?: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: OAuthError }

const err = (error: OAuthErrorCode, error_description: string): { ok: false; error: OAuthError } => ({ ok: false, error: { error, error_description } })

function mintPair(now: Date, random: Random): { access: string; refresh: string; tokens: NewToken[] } {
  const a = mintSecret(ACCESS_TOKEN_PREFIX, random)
  const r = mintSecret(REFRESH_TOKEN_PREFIX, random)
  return {
    access: a.value,
    refresh: r.value,
    tokens: [
      { kind: 'access', tokenHash: a.hash, expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS) },
      { kind: 'refresh', tokenHash: r.hash, expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS) },
    ],
  }
}

function tokenResponse(pair: { access: string; refresh: string }, scope: string | null): TokenResponse {
  return {
    access_token: pair.access,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: pair.refresh,
    ...(scope ? { scope } : {}),
  }
}

// ── Authorization code ─────────────────────────────────────────────────────────────────────────

export async function issueAuthorizationCode(
  store: OAuthStore,
  input: { clientRowId: string; accountId: string; userId: string; redirectUri: string; codeChallenge: string; resource: string; scope?: string },
  now: Date = new Date(),
  random: Random = randomBytes,
): Promise<string> {
  const code = mintSecret(AUTH_CODE_PREFIX, random)
  await store.createCode({
    codeHash: code.hash,
    clientId: input.clientRowId,
    accountId: input.accountId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    resource: input.resource,
    scope: input.scope ?? null,
    expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_MS),
  })
  return code.value
}

/**
 * grant_type=authorization_code. The code is consumed first (atomically), so any failure afterwards
 * — wrong verifier, wrong redirect_uri — still burns it. A replayed code revokes the grant it issued
 * (OAuth 2.1 §4.1.3).
 */
export async function exchangeAuthorizationCode(
  store: OAuthStore,
  input: { clientRowId: string; code: string | undefined; codeVerifier: string | undefined; redirectUri: string | undefined; resource: string | null },
  now: Date = new Date(),
  random: Random = randomBytes,
): Promise<Result<TokenResponse>> {
  if (!input.code || !isWellFormed(input.code, AUTH_CODE_PREFIX)) return err('invalid_grant', 'Invalid authorization code')
  if (!input.codeVerifier) return err('invalid_request', 'code_verifier is required')
  const consumed = await store.consumeCode(sha256Hex(input.code), now)
  if (consumed.status === 'missing') return err('invalid_grant', 'Invalid authorization code')
  const code = consumed.code
  if (consumed.status === 'reused') {
    if (code.grantId) await store.revokeGrant(code.grantId, now)
    return err('invalid_grant', 'Authorization code already used')
  }
  if (code.clientId !== input.clientRowId) return err('invalid_grant', 'Authorization code was issued to another client')
  if (code.expiresAt.getTime() <= now.getTime()) return err('invalid_grant', 'Authorization code expired')
  if (!input.redirectUri || input.redirectUri !== code.redirectUri) return err('invalid_grant', 'redirect_uri does not match the authorization request')
  if (!verifyPkceS256(input.codeVerifier, code.codeChallenge)) return err('invalid_grant', 'PKCE verification failed')
  if (input.resource !== null && input.resource !== code.resource) return err('invalid_target', 'resource does not match the authorization request')

  const pair = mintPair(now, random)
  await store.createGrant({
    codeId: code.id,
    grant: { accountId: code.accountId, userId: code.userId, clientId: code.clientId, resource: code.resource, scope: code.scope },
    tokens: pair.tokens,
  })
  return { ok: true, value: tokenResponse(pair, code.scope) }
}

// ── Refresh ────────────────────────────────────────────────────────────────────────────────────

/** grant_type=refresh_token with rotation; presenting an already-rotated token revokes the grant. */
export async function refreshTokens(
  store: OAuthStore,
  input: { clientRowId: string; refreshToken: string | undefined; resource: string | null },
  now: Date = new Date(),
  random: Random = randomBytes,
): Promise<Result<TokenResponse>> {
  if (!input.refreshToken || !isWellFormed(input.refreshToken, REFRESH_TOKEN_PREFIX)) return err('invalid_grant', 'Invalid refresh token')
  const t = await store.findToken(sha256Hex(input.refreshToken))
  if (!t || t.kind !== 'refresh') return err('invalid_grant', 'Invalid refresh token')
  if (t.grant.clientId !== input.clientRowId) return err('invalid_grant', 'Refresh token was issued to another client')
  if (t.grant.revokedAt || t.revokedAt) return err('invalid_grant', 'Refresh token revoked')
  if (t.rotatedAt) {
    // Replay of a rotated token: someone else may hold the family. Kill it.
    await store.revokeGrant(t.grant.id, now)
    return err('invalid_grant', 'Refresh token already used')
  }
  if (t.expiresAt.getTime() <= now.getTime()) return err('invalid_grant', 'Refresh token expired')
  if (input.resource !== null && input.resource !== t.grant.resource) return err('invalid_target', 'resource does not match the grant')

  const pair = mintPair(now, random)
  const rotated = await store.rotateRefresh(t.id, t.grant.id, now, pair.tokens)
  if (!rotated) {
    await store.revokeGrant(t.grant.id, now)
    return err('invalid_grant', 'Refresh token already used')
  }
  return { ok: true, value: tokenResponse(pair, t.grant.scope) }
}

// ── Revocation (RFC 7009) ──────────────────────────────────────────────────────────────────────

/** Revoke the grant behind an access or refresh token. Unknown / foreign tokens are ignored (200). */
export async function revokeToken(store: OAuthStore, input: { clientRowId: string; token: string | undefined }, now: Date = new Date()): Promise<void> {
  const token = input.token
  if (!token || !(isWellFormed(token, ACCESS_TOKEN_PREFIX) || isWellFormed(token, REFRESH_TOKEN_PREFIX))) return
  const t = await store.findToken(sha256Hex(token))
  if (!t || t.grant.clientId !== input.clientRowId || t.grant.revokedAt) return
  await store.revokeGrant(t.grant.id, now)
}

// ── Resource server ────────────────────────────────────────────────────────────────────────────

/** The live grant behind an access token for `resource`, or null (unknown, expired, revoked, other audience). */
export async function resolveAccessToken(store: Pick<OAuthStore, 'findToken'>, token: string, resource: string, now: Date = new Date()): Promise<GrantRecord | null> {
  if (!isWellFormed(token, ACCESS_TOKEN_PREFIX)) return null
  const t = await store.findToken(sha256Hex(token))
  if (!t || t.kind !== 'access' || t.revokedAt || t.grant.revokedAt) return null
  if (t.expiresAt.getTime() <= now.getTime()) return null
  if (t.grant.resource !== resource) return null
  return t.grant
}
