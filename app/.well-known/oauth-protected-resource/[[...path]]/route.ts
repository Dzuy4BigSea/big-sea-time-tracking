import { NextResponse } from 'next/server'
import { resolveAppUrl } from '@/lib/appUrl'
import { corsHeaders, protectedResourceMetadata } from '@/modules/oauth/metadata'

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP server (specs/22 §OAuth). Served at
 * /.well-known/oauth-protected-resource and the path-suffixed form
 * /.well-known/oauth-protected-resource/api/mcp. Public (see middleware PUBLIC_PREFIXES).
 */
export const dynamic = 'force-dynamic'

const CORS = corsHeaders('GET')

export async function GET() {
  return NextResponse.json(protectedResourceMetadata(resolveAppUrl()), {
    headers: { 'Cache-Control': 'public, max-age=3600', ...CORS },
  })
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}
