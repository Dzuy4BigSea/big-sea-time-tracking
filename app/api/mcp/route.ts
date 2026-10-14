import { NextResponse } from 'next/server'
import { authenticateBearer, rawBearer } from '@/lib/apiAuth'
import { resolveAppUrl } from '@/lib/appUrl'
import { writeAudit } from '@/lib/audit'
import { makeContext } from '@/lib/mcp/context'
import { MCP_TOOLS } from '@/lib/mcp/registry'
import { handleRpc, parseErrorResponse, RPC } from '@/modules/mcp/jsonrpc'
import { createTokenLimiter, MCP_MAX_BATCH, MCP_MAX_BODY_BYTES, MCP_WINDOW_MS } from '@/modules/mcp/rateLimit'
import { auditActionFor, auditDetail, auditSummary, MCP_AUDIT_ENTITY, MCP_OAUTH_AUDIT_ENTITY } from '@/modules/mcp/audit'
import { corsHeaders, wwwAuthenticate } from '@/modules/oauth/metadata'

/**
 * Track2 remote MCP server (specs/22): Streamable HTTP transport, stateless JSON responses.
 *
 *   POST /api/mcp   Authorization: Bearer track2_pat_… | track2_oat_…   body: JSON-RPC request / notification / batch
 *
 * Two credentials: personal access tokens (scripts, Claude Code) and OAuth 2.1 access tokens (claude.ai
 * custom connectors, specs/22 §OAuth). A 401 carries `WWW-Authenticate: Bearer resource_metadata=…`
 * so MCP clients can discover the authorization server (RFC 9728).
 *
 * Every request re-authenticates the token and re-reads the user (active, profile, overrides), so tools
 * see exactly the permissions the person has in the web app. Not behind the NextAuth middleware: the
 * middleware matcher skips /api/*.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Reports over long ranges can take a few seconds on a cold database (specs/21).
export const maxDuration = 60

const limiter = createTokenLimiter()

// No cookies are used here (Bearer only), so any origin may call it from a browser-based MCP client.
const CORS = corsHeaders('GET, POST, DELETE')

function unauthorized(tokenPresented: boolean) {
  return NextResponse.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Unauthorized: sign in with OAuth (claude.ai connector) or send a Track2 personal access token (Authorization: Bearer track2_pat_...).' },
    },
    // Header values must be ASCII (ByteString): see modules/oauth/metadata.ts.
    { status: 401, headers: { 'WWW-Authenticate': wwwAuthenticate(resolveAppUrl(), { tokenPresented }), 'Cache-Control': 'no-store', ...CORS } },
  )
}

export async function POST(req: Request) {
  let auth: Awaited<ReturnType<typeof authenticateBearer>>
  try {
    auth = await authenticateBearer(req.headers.get('authorization'))
  } catch (e) {
    // Database unreachable / waking up (specs/21): tell the client to retry rather than a bare 500.
    console.error('[mcp] auth lookup failed', e)
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: RPC.INTERNAL_ERROR, message: 'Track2 is temporarily unavailable. Retry in a few seconds.' } },
      { status: 503, headers: { 'Retry-After': '5', 'Cache-Control': 'no-store', ...CORS } },
    )
  }
  if (!auth) return unauthorized(!!rawBearer(req.headers.get('authorization')))

  if (!limiter.take(`${auth.kind}:${auth.tokenId}`)) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32029, message: 'Rate limit exceeded for this token. Slow down and retry in a minute.' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(MCP_WINDOW_MS / 1000)), 'Cache-Control': 'no-store', ...CORS } },
    )
  }

  // Bound the request: one POST must not smuggle an unbounded batch past the per-token budget.
  const raw = await req.text()
  if (raw.length > MCP_MAX_BODY_BYTES) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: RPC.INVALID_REQUEST, message: 'Request too large.' } },
      { status: 413, headers: { 'Cache-Control': 'no-store', ...CORS } },
    )
  }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json(parseErrorResponse(), { status: 400, headers: CORS })
  }
  if (Array.isArray(body)) {
    if (body.length > MCP_MAX_BATCH) {
      return NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: RPC.INVALID_REQUEST, message: `Batches are limited to ${MCP_MAX_BATCH} messages.` } },
        { status: 400, headers: { 'Cache-Control': 'no-store', ...CORS } },
      )
    }
    // Every message in a batch counts against the token's budget (the first was charged above).
    for (let i = 1; i < body.length; i++) {
      if (!limiter.take(`${auth.kind}:${auth.tokenId}`)) {
        return NextResponse.json(
          { jsonrpc: '2.0', id: null, error: { code: -32029, message: 'Rate limit exceeded for this token. Slow down and retry in a minute.' } },
          { status: 429, headers: { 'Retry-After': String(Math.ceil(MCP_WINDOW_MS / 1000)), 'Cache-Control': 'no-store', ...CORS } },
        )
      }
    }
  }

  const ctx = makeContext(auth.user, auth.tokenId)
  const auditEntity = auth.kind === 'oauth' ? MCP_OAUTH_AUDIT_ENTITY : MCP_AUDIT_ENTITY
  const result = await handleRpc(body, ctx, MCP_TOOLS, {
    async onWrite(tool, args, outcome, c) {
      await writeAudit({
        accountId: c.user.accountId,
        actorUserId: c.user.userId,
        entityType: auditEntity,
        entityId: c.tokenId,
        action: auditActionFor(tool.name),
        summary: auditSummary(tool.name, outcome),
        detail: auditDetail(tool.name, args, outcome),
      })
    },
    onUnexpected(tool, err) {
      console.error(`[mcp] ${tool} failed`, err)
    },
  })

  // Only notifications / responses were sent: nothing to answer (Streamable HTTP → 202).
  if (result === null) return new Response(null, { status: 202, headers: CORS })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store', ...CORS } })
}

/** No server-initiated SSE stream: the spec lets a server answer GET with 405. */
export async function GET() {
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: RPC.METHOD_NOT_FOUND, message: 'Track2 MCP uses POST (Streamable HTTP, JSON responses); no SSE stream.' } },
    { status: 405, headers: { Allow: 'POST', ...CORS } },
  )
}

/** Stateless server: there are no sessions to terminate. */
export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: 'POST', ...CORS } })
}

/** CORS preflight for browser-based MCP clients (Bearer tokens only, never cookies). */
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}
