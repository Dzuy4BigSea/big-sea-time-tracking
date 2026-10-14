/**
 * Audit rows for MCP write-tool calls (specs/22): one AuditLog row per write call, entityType
 * `api_token` / entityId = the token, actor = the token's user, so every API change is traceable to the
 * person and the token used. The domain services still write their own rows (e.g. time entries).
 */
import type { ToolError } from './errors'

export const MCP_AUDIT_ENTITY = 'api_token'

export function auditActionFor(tool: string): 'create' | 'update' | 'delete' {
  if (/^(delete|remove|unassign)_/.test(tool)) return 'delete'
  if (/^(create|log|start|add|assign)_/.test(tool)) return 'create'
  return 'update'
}

const MAX_ARGS_JSON = 2000

export function auditSummary(tool: string, outcome: { ok: true } | { ok: false; error: ToolError }): string {
  return outcome.ok ? `MCP ${tool}` : `MCP ${tool} refused (${outcome.error.code})`
}

/** Structured detail: tool, outcome, the id it produced/touched, and the (truncated) arguments. */
export function auditDetail(tool: string, args: unknown, outcome: { ok: true; result: Record<string, unknown> } | { ok: false; error: ToolError }): Record<string, unknown> {
  let argsJson = ''
  try {
    argsJson = JSON.stringify(args ?? {})
  } catch {
    argsJson = '"[unserializable]"'
  }
  if (argsJson.length > MAX_ARGS_JSON) argsJson = argsJson.slice(0, MAX_ARGS_JSON) + '…'
  return {
    via: 'mcp',
    tool,
    ok: outcome.ok,
    ...(outcome.ok ? { resultId: typeof outcome.result.id === 'string' ? outcome.result.id : null } : { error: outcome.error.code, message: outcome.error.message }),
    args: argsJson,
  }
}
