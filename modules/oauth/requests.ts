/**
 * Request validation for the MCP OAuth endpoints (specs/22 §OAuth): dynamic client registration
 * (RFC 7591) and the authorization request (OAuth 2.1 §4.1.1 + PKCE + RFC 8707 resource). Pure.
 */
import { isValidCodeChallenge } from './crypto'
import { normalizeResource, TOKEN_ENDPOINT_AUTH_METHODS, type TokenEndpointAuthMethod } from './metadata'
import { redirectUriMatches, validateRedirectUri } from './redirectUri'

// ── Dynamic client registration ────────────────────────────────────────────────────────────────

export const MAX_REDIRECT_URIS = 10
export const MAX_CLIENT_NAME = 100
export const DEFAULT_CLIENT_NAME = 'MCP client'

export interface RegistrationInput {
  clientName: string
  redirectUris: string[]
  tokenEndpointAuthMethod: TokenEndpointAuthMethod
}

export type RegistrationCheck = { ok: true; value: RegistrationInput } | { ok: false; error: 'invalid_redirect_uri' | 'invalid_client_metadata'; description: string }

export function validateRegistration(body: unknown): RegistrationCheck {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_client_metadata', description: 'Body must be a JSON object' }
  }
  const b = body as Record<string, unknown>
  const uris = b.redirect_uris
  if (!Array.isArray(uris) || uris.length === 0) {
    return { ok: false, error: 'invalid_redirect_uri', description: 'redirect_uris must be a non-empty array' }
  }
  if (uris.length > MAX_REDIRECT_URIS) {
    return { ok: false, error: 'invalid_redirect_uri', description: `At most ${MAX_REDIRECT_URIS} redirect_uris` }
  }
  const redirectUris: string[] = []
  for (const u of uris) {
    const r = validateRedirectUri(u)
    if (!r.ok) return { ok: false, error: 'invalid_redirect_uri', description: r.error }
    if (!redirectUris.includes(r.uri)) redirectUris.push(r.uri)
  }

  let clientName = DEFAULT_CLIENT_NAME
  if (b.client_name !== undefined && b.client_name !== null) {
    if (typeof b.client_name !== 'string') return { ok: false, error: 'invalid_client_metadata', description: 'client_name must be a string' }
    // Strip control characters; the name is shown on the consent screen.
    const n = b.client_name.replace(/[\u0000-\u001f\u007f]/g, '').trim()
    if (n.length > MAX_CLIENT_NAME) return { ok: false, error: 'invalid_client_metadata', description: `client_name must be at most ${MAX_CLIENT_NAME} characters` }
    if (n) clientName = n
  }

  // Public client (PKCE) unless the client asks for a secret. RFC 7591's default (client_secret_basic)
  // doesn't fit MCP clients, which almost all register as public; `none` is the default here.
  let method: TokenEndpointAuthMethod = 'none'
  if (b.token_endpoint_auth_method !== undefined) {
    if (!(TOKEN_ENDPOINT_AUTH_METHODS as readonly unknown[]).includes(b.token_endpoint_auth_method)) {
      return { ok: false, error: 'invalid_client_metadata', description: `token_endpoint_auth_method must be one of ${TOKEN_ENDPOINT_AUTH_METHODS.join(', ')}` }
    }
    method = b.token_endpoint_auth_method as TokenEndpointAuthMethod
  }
  if (b.grant_types !== undefined) {
    if (!Array.isArray(b.grant_types) || b.grant_types.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) {
      return { ok: false, error: 'invalid_client_metadata', description: 'grant_types may only contain authorization_code and refresh_token' }
    }
  }
  if (b.response_types !== undefined) {
    if (!Array.isArray(b.response_types) || b.response_types.some((r) => r !== 'code')) {
      return { ok: false, error: 'invalid_client_metadata', description: 'response_types may only contain code' }
    }
  }
  return { ok: true, value: { clientName, redirectUris, tokenEndpointAuthMethod: method } }
}

// ── Authorization request ──────────────────────────────────────────────────────────────────────

export interface ClientView {
  /** Row id (internal). */
  id: string
  clientId: string
  clientName: string
  redirectUris: string[]
}

export interface AuthorizeRequest {
  clientId: string
  redirectUri: string
  state: string | undefined
  codeChallenge: string
  resource: string
  scope: string | undefined
}

export type AuthorizeCheck =
  /** Can't trust the redirect URI: show an error page, never redirect. */
  | { kind: 'fatal'; message: string }
  /** Redirect back to the client with ?error=…&state=… */
  | { kind: 'redirect_error'; redirectUri: string; error: string; description: string; state: string | undefined }
  | { kind: 'ok'; request: AuthorizeRequest }

const MAX_STATE = 1024
const MAX_SCOPE = 512

type Params = Record<string, string | string[] | undefined>

function one(p: Params, k: string): string | undefined {
  const v = p[k]
  return Array.isArray(v) ? undefined : v
}

/**
 * Validate the query of /oauth/authorize against the (looked-up) client. Order matters: until the
 * client and redirect URI are known-good, errors are shown locally (no open redirect); afterwards they
 * go back to the client as `error=` parameters with the state echoed.
 */
export function validateAuthorizeRequest(params: Params, client: ClientView | null, appUrl: string): AuthorizeCheck {
  for (const k of ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'response_type', 'resource', 'scope']) {
    if (Array.isArray(params[k])) return { kind: 'fatal', message: `The ${k} parameter appears more than once.` }
  }
  const clientId = one(params, 'client_id')
  if (!clientId) return { kind: 'fatal', message: 'The request is missing client_id.' }
  if (!client || client.clientId !== clientId) return { kind: 'fatal', message: 'This app is not registered with Track2 (unknown client_id).' }

  let redirectUri = one(params, 'redirect_uri')
  if (!redirectUri) {
    // OAuth 2.1 §4.1.1: may be omitted only when exactly one URI is registered.
    if (client.redirectUris.length !== 1) return { kind: 'fatal', message: 'The request is missing redirect_uri.' }
    redirectUri = client.redirectUris[0]
  } else if (!redirectUriMatches(client.redirectUris, redirectUri)) {
    return { kind: 'fatal', message: 'The redirect_uri does not match any URI registered for this app.' }
  }

  const state = one(params, 'state')
  const fail = (error: string, description: string): AuthorizeCheck => ({ kind: 'redirect_error', redirectUri: redirectUri!, error, description, state })
  if (state !== undefined && state.length > MAX_STATE) return fail('invalid_request', 'state is too long')
  if (one(params, 'response_type') !== 'code') return fail('unsupported_response_type', 'response_type must be code')
  const challenge = one(params, 'code_challenge')
  if (!challenge) return fail('invalid_request', 'PKCE is required: send code_challenge with code_challenge_method=S256')
  if (one(params, 'code_challenge_method') !== 'S256') return fail('invalid_request', 'code_challenge_method must be S256')
  if (!isValidCodeChallenge(challenge)) return fail('invalid_request', 'code_challenge is malformed')
  const resource = normalizeResource(one(params, 'resource'), appUrl)
  if (!resource) return fail('invalid_target', 'resource must be the Track2 MCP server URL')
  const scope = one(params, 'scope')
  if (scope !== undefined && scope.length > MAX_SCOPE) return fail('invalid_scope', 'scope is too long')

  return { kind: 'ok', request: { clientId, redirectUri, state, codeChallenge: challenge, resource, scope: scope || undefined } }
}

/**
 * CSRF guard for the consent POST: the browser's Origin must be the app's own origin. Without an
 * Origin header (old browsers), fall back to Sec-Fetch-Site: same-origin. Anything else is refused.
 * (The session cookie is SameSite=Lax as well, so a cross-site POST also arrives signed out.)
 */
export function isSameOriginPost(origin: string | null, secFetchSite: string | null, appUrl: string): boolean {
  if (origin) return origin === appUrl
  return secFetchSite === 'same-origin'
}

/** Display host of a redirect URI for the consent screen ("you'll be sent back to claude.ai"). */
export function redirectHost(uri: string): string {
  try {
    return new URL(uri).host
  } catch {
    return uri
  }
}
