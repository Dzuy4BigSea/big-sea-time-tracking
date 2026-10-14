/**
 * Per-token request limiter for /api/mcp (specs/22). In-process sliding window: on Vercel each warm
 * instance counts separately, so the effective ceiling is per instance — "modest", a guard against a
 * runaway agent loop rather than a hard quota. Reuses the login limiter's bounded window.
 */
import { createMemoryLimiter } from '@/modules/shared/loginThrottle'

export const MCP_MAX_REQUESTS = 120
export const MCP_WINDOW_MS = 60_000
/** Max JSON-RPC messages in one batch POST, each charged against the token budget. */
export const MCP_MAX_BATCH = 10
/** Max request body size for /api/mcp. */
export const MCP_MAX_BODY_BYTES = 256 * 1024

export function createTokenLimiter(opts: { max?: number; windowMs?: number; now?: () => number } = {}) {
  const limiter = createMemoryLimiter({ max: opts.max ?? MCP_MAX_REQUESTS, windowMs: opts.windowMs ?? MCP_WINDOW_MS, now: opts.now })
  return {
    /** Count one request; false when the token is over its budget (the request is not counted). */
    take(tokenId: string): boolean {
      if (limiter.isBlocked(tokenId)) return false
      limiter.recordFailure(tokenId)
      return true
    },
  }
}
