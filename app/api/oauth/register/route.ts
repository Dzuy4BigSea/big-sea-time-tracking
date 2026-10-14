import { prisma } from '@/lib/prisma'
import { clientIp, oauthError, oauthJson, OAUTH_POST_CORS } from '@/lib/oauth/http'
import { CLIENT_SECRET_PREFIX, mintClientId, mintSecret } from '@/modules/oauth/crypto'
import { validateRegistration } from '@/modules/oauth/requests'
import { createMemoryLimiter } from '@/modules/shared/loginThrottle'

/**
 * Dynamic Client Registration (RFC 7591, specs/22 §OAuth). Open (MCP clients such as claude.ai
 * register themselves), so a client grants nothing by itself: every token still needs a signed-in
 * Track2 user's consent. Redirect URIs: https, or http on loopback only. Rate-limited per IP.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REGISTRATIONS_PER_HOUR = 20
const limiter = createMemoryLimiter({ max: REGISTRATIONS_PER_HOUR, windowMs: 60 * 60 * 1000 })

export async function POST(req: Request) {
  const ip = clientIp(req)
  if (limiter.isBlocked(ip)) return oauthError('slow_down', 'Too many client registrations; retry later', 429, { 'Retry-After': '3600' })

  let body: unknown
  try {
    const text = await req.text()
    if (text.length > 16_384) return oauthError('invalid_client_metadata', 'Registration request is too large')
    body = JSON.parse(text)
  } catch {
    return oauthError('invalid_client_metadata', 'Body must be JSON')
  }
  const v = validateRegistration(body)
  if (!v.ok) return oauthError(v.error, v.description)
  limiter.recordFailure(ip)

  const clientId = mintClientId()
  const secret = v.value.tokenEndpointAuthMethod === 'none' ? null : mintSecret(CLIENT_SECRET_PREFIX)
  try {
    const row = await prisma.oAuthClient.create({
      data: {
        clientId,
        clientName: v.value.clientName,
        redirectUris: v.value.redirectUris,
        tokenEndpointAuthMethod: v.value.tokenEndpointAuthMethod,
        clientSecretHash: secret?.hash ?? null,
      },
      select: { createdAt: true },
    })
    return oauthJson(
      {
        client_id: clientId,
        client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
        ...(secret ? { client_secret: secret.value, client_secret_expires_at: 0 } : {}),
        client_name: v.value.clientName,
        redirect_uris: v.value.redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: v.value.tokenEndpointAuthMethod,
      },
      201,
    )
  } catch (e) {
    console.error('[oauth] register failed', e instanceof Error ? e.name : 'error')
    return oauthError('temporarily_unavailable', 'Retry in a few seconds.', 503, { 'Retry-After': '5' })
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_POST_CORS })
}
