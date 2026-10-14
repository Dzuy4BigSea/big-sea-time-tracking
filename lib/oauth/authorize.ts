import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveAppUrl } from '@/lib/appUrl'
import { validateAuthorizeRequest, type AuthorizeCheck, type ClientView } from '@/modules/oauth/requests'

export const AUTHORIZE_PARAMS = ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'resource', 'scope'] as const

/** Look up the client named by the request and validate the whole authorization request. */
export async function checkAuthorizeRequest(params: Record<string, string | string[] | undefined>): Promise<{ check: AuthorizeCheck; client: ClientView | null }> {
  const clientId = params.client_id
  const client =
    typeof clientId === 'string' && clientId.length <= 200
      ? await prisma.oAuthClient.findUnique({ where: { clientId }, select: { id: true, clientId: true, clientName: true, redirectUris: true } })
      : null
  return { check: validateAuthorizeRequest(params, client, resolveAppUrl()), client }
}

/** The /oauth/authorize URL for these parameters (relative), to come back to after signing in. */
export function authorizePath(params: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams()
  for (const k of AUTHORIZE_PARAMS) {
    const v = params[k]
    if (typeof v === 'string') q.set(k, v)
  }
  return `/oauth/authorize?${q.toString()}`
}
