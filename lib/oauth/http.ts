import 'server-only'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { clientAuthenticates, clientCredentials } from '@/modules/oauth/clientAuth'
import { corsHeaders } from '@/modules/oauth/metadata'

/** Shared plumbing for /api/oauth/{token,revoke,register} (specs/22 §OAuth). */

export const OAUTH_POST_CORS = corsHeaders('POST')

export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache', ...OAUTH_POST_CORS, ...extra } })
}

export function oauthError(error: string, description: string, status = 400, extra: Record<string, string> = {}) {
  return oauthJson({ error, error_description: description }, status, extra)
}

/** The request's form parameters (application/x-www-form-urlencoded per RFC 6749; JSON tolerated). */
export async function readForm(req: Request): Promise<Record<string, string> | null> {
  const type = (req.headers.get('content-type') ?? '').toLowerCase()
  const text = await req.text()
  if (text.length > 16_384) return null
  const out: Record<string, string> = {}
  if (type.includes('application/json')) {
    try {
      const o = JSON.parse(text) as Record<string, unknown>
      if (!o || typeof o !== 'object' || Array.isArray(o)) return null
      for (const [k, v] of Object.entries(o)) if (typeof v === 'string') out[k] = v
      return out
    } catch {
      return null
    }
  }
  const params = new URLSearchParams(text)
  for (const k of new Set(params.keys())) {
    const all = params.getAll(k)
    // RFC 6749 §3.2: parameters must not be repeated.
    if (all.length > 1) return null
    out[k] = all[0]
  }
  return out
}

export interface AuthenticatedClient {
  id: string
  clientId: string
}

/** Identify + authenticate the client at the token / revocation endpoint, or an OAuth error response. */
export async function authenticateClient(req: Request, form: Record<string, string>): Promise<AuthenticatedClient | Response> {
  const creds = clientCredentials(req.headers.get('authorization'), form)
  if ('error' in creds) return oauthError('invalid_client', creds.error, 401)
  if (!creds.clientId) return oauthError('invalid_client', 'client_id is required', 401)
  const client = await prisma.oAuthClient.findUnique({ where: { clientId: creds.clientId }, select: { id: true, clientId: true, clientSecretHash: true } })
  if (!client || !clientAuthenticates(client, creds)) {
    return oauthError('invalid_client', 'Client authentication failed', 401, creds.via === 'basic' ? { 'WWW-Authenticate': 'Basic realm="Track2"' } : {})
  }
  return { id: client.id, clientId: client.clientId }
}

/** Best-effort client IP for rate limiting (Vercel sets x-forwarded-for; first hop is the client). */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}
