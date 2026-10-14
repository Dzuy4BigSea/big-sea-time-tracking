import { NextResponse } from 'next/server'
import { resolveAppUrl } from '@/lib/appUrl'
import { authorizationServerMetadata, corsHeaders } from '@/modules/oauth/metadata'

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414) for MCP clients (specs/22 §OAuth). The issuer is
 * the app origin, so the canonical URL is /.well-known/oauth-authorization-server; the path-suffixed
 * form (…/api/mcp) is answered too for clients that probe it. Public (middleware PUBLIC_PREFIXES).
 */
export const dynamic = 'force-dynamic'

const CORS = corsHeaders('GET')

export async function GET() {
  return NextResponse.json(authorizationServerMetadata(resolveAppUrl()), {
    headers: { 'Cache-Control': 'public, max-age=3600', ...CORS },
  })
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}
