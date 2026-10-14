import 'server-only'
import type { CurrentUser } from '@/lib/session'
import { getAccountClock } from '@/lib/accountClock'
import { todayIn } from '@/lib/tz'
import { addDays, parseYmd } from '@/lib/week'
import { can, type Actor, type Capability, type PermissionProfile } from '@/modules/shared/permissions'
import { forbidden, invalid } from '@/modules/mcp/errors'
import type { ToolDef } from '@/modules/mcp/jsonrpc'

/** Per-request context for every tool: the token's user, resolved exactly like a UI session. */
export interface McpContext {
  user: CurrentUser
  actor: Actor
  tokenId: string
  now: Date
}

export type Tool = ToolDef<McpContext>

export function makeContext(user: CurrentUser, tokenId: string, now: Date = new Date()): McpContext {
  return {
    user,
    tokenId,
    now,
    actor: { permissionProfile: user.permissionProfile as PermissionProfile, permissionOverrides: user.permissionOverrides },
  }
}

export function has(ctx: McpContext, cap: Capability): boolean {
  return can(ctx.actor, cap)
}

export function requireCap(ctx: McpContext, cap: Capability, message: string): void {
  if (!can(ctx.actor, cap)) throw forbidden(message)
}

/** Today in the account timezone (date-only, UTC midnight) — never the server's UTC day. */
export async function accountToday(ctx: McpContext): Promise<Date> {
  const { timezone } = await getAccountClock(ctx.user.accountId)
  return todayIn(timezone, ctx.now)
}

/** Parse an already-validated YYYY-MM-DD argument (or undefined). */
export function dateArg(v: unknown, field: string): Date | undefined {
  if (v === undefined) return undefined
  const d = parseYmd(String(v))
  if (!d) throw invalid(`${field}: must be a date YYYY-MM-DD`, { field })
  return d
}

/** from/to with Harvest's defaults: omitted → the last 30 days ending today (account timezone). */
export async function rangeArgs(ctx: McpContext, args: { from?: unknown; to?: unknown }, defaultDays = 30): Promise<{ from: Date; to: Date }> {
  const to = dateArg(args.to, 'to') ?? (await accountToday(ctx))
  const from = dateArg(args.from, 'from') ?? addDays(to, -(defaultDays - 1))
  if (from.getTime() > to.getTime()) throw invalid('from must be on or before to.', { field: 'from' })
  return { from, to }
}

export const DEFAULT_LIMIT = 100
export const MAX_LIMIT = 500
export const limitOf = (v: unknown): number => (typeof v === 'number' ? v : DEFAULT_LIMIT)
