/**
 * Login brute-force mitigation (pure, DB-free helpers).
 *
 * Three layers, used by the Credentials `authorize()` in auth.ts:
 *  1. A durable per-user lockout: failed sign-ins for a known user are recorded in AuditLog
 *     (entityType LOGIN_FAILURE_ENTITY) and, once LOGIN_MAX_FAILURES land inside LOGIN_WINDOW_MS,
 *     further attempts are refused without checking the password until the window rolls on.
 *     This survives serverless cold starts because the count lives in Postgres.
 *  2. A best-effort in-memory limiter per email (per warm lambda instance) that also covers
 *     unknown emails without touching the DB.
 *  3. A small randomized delay on every failure to slow scripted guessing.
 * The real perimeter control is a platform rate-limit rule on POST /api/auth/callback/credentials.
 */

export const LOGIN_MAX_FAILURES = 10
export const LOGIN_WINDOW_MS = 15 * 60 * 1000
export const LOGIN_FAILURE_ENTITY = 'auth.login_failed'

/** Locked once the recent-failure count reaches the threshold. */
export function isLockedOut(recentFailures: number, max = LOGIN_MAX_FAILURES): boolean {
  return recentFailures >= max
}

/** Delay to apply after a failed attempt: 400–800ms, given a random in [0,1). */
export function failureDelayMs(random: number = Math.random()): number {
  const r = Math.min(Math.max(random, 0), 0.999)
  return 400 + Math.floor(r * 400)
}

export interface MemoryLimiter {
  isBlocked(key: string): boolean
  recordFailure(key: string): void
  reset(key: string): void
}

/** Sliding-window failure counter kept in process memory (bounded size). */
export function createMemoryLimiter(opts: {
  max?: number
  windowMs?: number
  now?: () => number
  maxKeys?: number
} = {}): MemoryLimiter {
  const max = opts.max ?? LOGIN_MAX_FAILURES
  const windowMs = opts.windowMs ?? LOGIN_WINDOW_MS
  const now = opts.now ?? Date.now
  const maxKeys = opts.maxKeys ?? 5000
  const hits = new Map<string, number[]>()

  const recent = (key: string): number[] => {
    const cutoff = now() - windowMs
    const list = (hits.get(key) ?? []).filter((t) => t > cutoff)
    if (list.length) hits.set(key, list)
    else hits.delete(key)
    return list
  }

  return {
    isBlocked: (key) => recent(key).length >= max,
    recordFailure(key) {
      const list = recent(key)
      list.push(now())
      hits.set(key, list)
      if (hits.size > maxKeys) {
        // Drop the oldest-inserted key to stay bounded.
        const first = hits.keys().next().value
        if (first !== undefined) hits.delete(first)
      }
    },
    reset: (key) => {
      hits.delete(key)
    },
  }
}
