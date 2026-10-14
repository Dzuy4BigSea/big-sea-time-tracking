import { NextResponse } from 'next/server'
import { authenticateBearer } from '@/lib/apiAuth'
import { writeAudit } from '@/lib/audit'
import { makeContext } from '@/lib/mcp/context'
import { MCP_TOOLS } from '@/lib/mcp/registry'
import { handleRpc, parseErrorResponse, RPC } from '@/modules/mcp/jsonrpc'
import { createTokenLimiter, MCP_WINDOW_MS } from '@/modules/mcp/rateLimit'
import { auditActionFor, auditDetail, auditSummary, MCP_AUDIT_ENTITY } from '@/modules/mcp/audit'

/**
 * Track2 remote MCP server (specs/22): Streamable HTTP transport, stateless JSON responses.
 *
 *   POST /api/mcp   Authorization: Bearer track2_pat_…   body: JSON-RPC request / notification / batch
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

const WWW_AUTHENTICATE =
  'Bearer realm="Track2", error="invalid_token", error_description="Use a personal access token from Track2 › Settings › Personal access tokens (Authorization: Bearer track2_pat_…)"'

function unauthorized() {
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized: missing, invalid or revoked Track2 personal access token.' } },
    { status: 401, headers: { 'WWW-Authenticate': WWW_AUTHENTICATE, 'Cache-Control': 'no-store' } },
  )
}

export async function POST(req: Request) {
  const auth = await authenticateBearer(req.headers.get('authorization'))
  if (!auth) return unauthorized()

  if (!limiter.take(auth.tokenId)) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32029, message: 'Rate limit exceeded for this token. Slow down and retry in a minute.' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(MCP_WINDOW_MS / 1000)), 'Cache-Control': 'no-store' } },
    )
  }

  let body: unknown
  try {
    body = JSON.parse(await req.text())
  } catch {
    return NextResponse.json(parseErrorResponse(), { status: 400 })
  }

  const ctx = makeContext(auth.user, auth.tokenId)
  const result = await handleRpc(body, ctx, MCP_TOOLS, {
    async onWrite(tool, args, outcome, c) {
      await writeAudit({
        accountId: c.user.accountId,
        actorUserId: c.user.userId,
        entityType: MCP_AUDIT_ENTITY,
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
  if (result === null) return new Response(null, { status: 202 })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}

/** No server-initiated SSE stream: the spec lets a server answer GET with 405. */
export async function GET() {
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: RPC.METHOD_NOT_FOUND, message: 'Track2 MCP uses POST (Streamable HTTP, JSON responses); no SSE stream.' } },
    { status: 405, headers: { Allow: 'POST' } },
  )
}

/** Stateless server: there are no sessions to terminate. */
export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } })
}
