/**
 * Minimal MCP server over JSON-RPC 2.0 (Streamable HTTP, stateless; specs/22).
 *
 * Implements `initialize`, `notifications/*`, `ping`, `tools/list`, `tools/call` per MCP 2025-03-26 /
 * 2025-06-18. No sessions, no server-initiated messages, no SSE: every POST is answered with one JSON
 * body, which the Streamable HTTP transport allows. Pure — the route handler supplies auth context and
 * the tool registry, so this is unit-testable without Next or a database.
 */
import { ToolError, toolErrorBody } from './errors'
import { toJsonSchema, validateArgs, type ObjectSchema } from './schema'

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]
export const SERVER_INFO = { name: 'track2', title: 'Track2 (Big Sea time tracking)', version: '1.0.0' }

export const SERVER_INSTRUCTIONS = [
  'Track2 is Big Sea’s time-tracking and invoicing app (a Harvest replacement). Tools mirror the Harvest MCP.',
  'Ids are strings. Dates are YYYY-MM-DD; "today" is the account timezone (see get_account_settings).',
  'Hours are decimal (1.5 = 1h30m) and are stored as whole minutes. Money amounts are decimals in the project/client currency.',
  'Results are scoped to the token owner’s permissions; when `scope_limited` is true, missing rows may be hidden by permissions — do not treat zero as authoritative.',
  'Paginate by passing `next_cursor` back as `cursor` with all other parameters unchanged.',
  'Invoices are created as drafts only; sending, payments and deletion are done in the Track2 web app.',
  'Before a write that changes other people’s data or money (rates, invoices, archiving), confirm with the user.',
].join('\n')

export interface ToolDef<Ctx> {
  name: string
  title?: string
  description: string
  inputSchema: ObjectSchema
  /** Mutates data → audited, and annotated readOnlyHint: false. */
  write: boolean
  destructive?: boolean
  idempotent?: boolean
  handler: (args: Record<string, unknown>, ctx: Ctx) => Promise<Record<string, unknown>>
}

export interface RpcOptions<Ctx> {
  /** Called after every write tool call (success or tool error) — the route writes the audit row. */
  onWrite?: (tool: ToolDef<Ctx>, args: unknown, outcome: { ok: true; result: Record<string, unknown> } | { ok: false; error: ToolError }, ctx: Ctx) => Promise<void>
  /** Called for unexpected (non-ToolError) failures, for server logs. */
  onUnexpected?: (tool: string, err: unknown) => void
}

type Id = string | number | null
interface RpcRequest {
  jsonrpc: '2.0'
  id?: Id
  method: string
  params?: Record<string, unknown>
}

export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const

const ok = (id: Id, result: unknown) => ({ jsonrpc: '2.0' as const, id, result })
const err = (id: Id, code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0' as const,
  id,
  error: { code, message, ...(data !== undefined ? { data } : {}) },
})

export type RpcResponse = ReturnType<typeof ok> | ReturnType<typeof err>

export function negotiateProtocol(requested: unknown): string {
  return typeof requested === 'string' && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION
}

export function listTools<Ctx>(tools: readonly ToolDef<Ctx>[]) {
  return tools.map((t) => ({
    name: t.name,
    ...(t.title ? { title: t.title } : {}),
    description: t.description,
    inputSchema: toJsonSchema(t.inputSchema),
    annotations: {
      ...(t.title ? { title: t.title } : {}),
      readOnlyHint: !t.write,
      destructiveHint: t.write ? !!t.destructive : false,
      idempotentHint: t.write ? !!t.idempotent : true,
      openWorldHint: false,
    },
  }))
}

function toolResult(body: Record<string, unknown>, isError: boolean) {
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent: body,
    ...(isError ? { isError: true } : {}),
  }
}

async function callTool<Ctx>(params: Record<string, unknown> | undefined, ctx: Ctx, tools: readonly ToolDef<Ctx>[], opts: RpcOptions<Ctx>, id: Id) {
  const name = params?.name
  if (typeof name !== 'string') return err(id, RPC.INVALID_PARAMS, 'tools/call requires params.name')
  const tool = tools.find((t) => t.name === name)
  if (!tool) return err(id, RPC.INVALID_PARAMS, `Unknown tool: ${name}`)
  const rawArgs = params?.arguments ?? {}
  try {
    const args = validateArgs(tool.inputSchema, rawArgs)
    const result = await tool.handler(args, ctx)
    if (tool.write) await opts.onWrite?.(tool, args, { ok: true, result }, ctx)
    return ok(id, toolResult(result, false))
  } catch (e) {
    if (e instanceof ToolError) {
      if (tool.write) await opts.onWrite?.(tool, rawArgs, { ok: false, error: e }, ctx)
      return ok(id, toolResult(toolErrorBody(e), true))
    }
    opts.onUnexpected?.(tool.name, e)
    return ok(id, toolResult(toolErrorBody(new ToolError('internal_error', 'Something went wrong running this tool. Try again, or check the Track2 web app.')), true))
  }
}

async function handleOne<Ctx>(msg: unknown, ctx: Ctx, tools: readonly ToolDef<Ctx>[], opts: RpcOptions<Ctx>): Promise<RpcResponse | null> {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return err(null, RPC.INVALID_REQUEST, 'Invalid Request')
  const m = msg as Partial<RpcRequest> & { result?: unknown; error?: unknown }
  const id: Id = m.id === undefined ? null : (m.id as Id)
  if (m.jsonrpc !== '2.0') return err(id, RPC.INVALID_REQUEST, 'Invalid Request: jsonrpc must be "2.0"')
  // A response from the client (we never send requests) — nothing to answer.
  if (m.method === undefined && ('result' in m || 'error' in m)) return null
  if (typeof m.method !== 'string') return err(id, RPC.INVALID_REQUEST, 'Invalid Request: missing method')
  const isNotification = m.id === undefined
  if (isNotification) return null // notifications/initialized, notifications/cancelled, …
  if (m.params !== undefined && (typeof m.params !== 'object' || m.params === null || Array.isArray(m.params))) {
    return err(id, RPC.INVALID_PARAMS, 'params must be an object')
  }

  switch (m.method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: negotiateProtocol(m.params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      })
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, { tools: listTools(tools) })
    case 'tools/call':
      return callTool(m.params, ctx, tools, opts, id)
    case 'resources/list':
      return ok(id, { resources: [] })
    case 'prompts/list':
      return ok(id, { prompts: [] })
    default:
      return err(id, RPC.METHOD_NOT_FOUND, `Method not found: ${m.method}`)
  }
}

/**
 * Handle one JSON-RPC message or a batch. Returns null when nothing needs answering (only
 * notifications/responses) — the HTTP layer then replies 202 Accepted with no body.
 */
export async function handleRpc<Ctx>(body: unknown, ctx: Ctx, tools: readonly ToolDef<Ctx>[], opts: RpcOptions<Ctx> = {}): Promise<RpcResponse | RpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return err(null, RPC.INVALID_REQUEST, 'Invalid Request: empty batch')
    const out: RpcResponse[] = []
    for (const msg of body) {
      const r = await handleOne(msg, ctx, tools, opts)
      if (r) out.push(r)
    }
    return out.length ? out : null
  }
  return handleOne(body, ctx, tools, opts)
}

export function parseErrorResponse(): RpcResponse {
  return err(null, RPC.PARSE_ERROR, 'Parse error')
}
