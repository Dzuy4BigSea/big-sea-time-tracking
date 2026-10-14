import { resolveAppUrl } from '@/lib/appUrl'
import { authenticateClient, clientIp, oauthError, oauthJson, OAUTH_POST_CORS, readForm } from '@/lib/oauth/http'
import { prismaOAuthStore } from '@/lib/oauth/store'
import { normalizeResource } from '@/modules/oauth/metadata'
import { exchangeAuthorizationCode, refreshTokens } from '@/modules/oauth/service'
import { createMemoryLimiter } from '@/modules/shared/loginThrottle'

/**
 * OAuth 2.1 token endpoint (specs/22 §OAuth): grant_type=authorization_code (PKCE S256 mandatory) and
 * grant_type=refresh_token (rotating). Public clients authenticate with client_id only; clients that
 * registered with a secret must send it. CORS: any origin, no credentials. Tokens are never logged.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A guard against code / refresh-token guessing loops (per instance; the secrets are 256-bit anyway).
const limiter = createMemoryLimiter({ max: 60, windowMs: 60_000 })

export async function POST(req: Request) {
  const ip = clientIp(req)
  if (limiter.isBlocked(ip)) return oauthError('slow_down', 'Too many token requests; retry in a minute', 429, { 'Retry-After': '60' })
  limiter.recordFailure(ip)

  const form = await readForm(req)
  if (!form) return oauthError('invalid_request', 'Malformed request body')
  const client = await authenticateClient(req, form)
  if (client instanceof Response) return client

  const appUrl = resolveAppUrl()
  let resource: string | null = null
  if (form.resource !== undefined) {
    resource = normalizeResource(form.resource, appUrl)
    if (!resource) return oauthError('invalid_target', 'resource must be the Track2 MCP server URL')
  }

  try {
    let result
    if (form.grant_type === 'authorization_code') {
      result = await exchangeAuthorizationCode(prismaOAuthStore, {
        clientRowId: client.id,
        code: form.code,
        codeVerifier: form.code_verifier,
        redirectUri: form.redirect_uri,
        resource,
      })
    } else if (form.grant_type === 'refresh_token') {
      result = await refreshTokens(prismaOAuthStore, { clientRowId: client.id, refreshToken: form.refresh_token, resource })
    } else {
      return oauthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token')
    }
    if (!result.ok) return oauthJson(result.error, 400)
    return oauthJson(result.value)
  } catch (e) {
    // Never log request bodies (codes, verifiers, tokens) — only that it failed.
    console.error('[oauth] token endpoint failed', e instanceof Error ? e.name : 'error')
    return oauthError('temporarily_unavailable', 'Track2 is temporarily unavailable. Retry in a few seconds.', 503, { 'Retry-After': '5' })
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_POST_CORS })
}
