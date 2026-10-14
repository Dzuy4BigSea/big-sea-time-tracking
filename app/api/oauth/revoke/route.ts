import { authenticateClient, oauthError, OAUTH_POST_CORS, readForm } from '@/lib/oauth/http'
import { prismaOAuthStore } from '@/lib/oauth/store'
import { revokeToken } from '@/modules/oauth/service'

/**
 * Token revocation (RFC 7009, specs/22 §OAuth). Revoking an access or refresh token revokes the
 * whole grant (the connected app). Unknown tokens, or tokens of another client, still answer 200.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const form = await readForm(req)
  if (!form) return oauthError('invalid_request', 'Malformed request body')
  const client = await authenticateClient(req, form)
  if (client instanceof Response) return client
  if (!form.token) return oauthError('invalid_request', 'token is required')
  try {
    await revokeToken(prismaOAuthStore, { clientRowId: client.id, token: form.token })
  } catch (e) {
    console.error('[oauth] revoke failed', e instanceof Error ? e.name : 'error')
    return oauthError('temporarily_unavailable', 'Retry in a few seconds.', 503, { 'Retry-After': '5' })
  }
  return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store', ...OAUTH_POST_CORS } })
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_POST_CORS })
}
