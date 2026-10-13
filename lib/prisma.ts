import { PrismaClient } from '@prisma/client'

/**
 * One PrismaClient per server instance, in every environment.
 *
 * - Dev: survives hot reloads (otherwise each reload opens a new pool).
 * - Production (Vercel Fluid Compute): one instance serves many concurrent requests and lives across
 *   invocations, so caching on globalThis means the query engine is initialised and the pooler
 *   connection opened once per instance, not once per module evaluation.
 *
 * DATABASE_URL (Supabase transaction pooler, port 6543) — recommended query params:
 *
 *   ?pgbouncer=true&connection_limit=5&pool_timeout=20
 *
 *   - `pgbouncer=true`: required for the transaction pooler (no named prepared statements).
 *   - `connection_limit=5`: Prisma's per-instance pool size. With `1`, every `Promise.all` of queries in
 *     a request runs one at a time (each waits for the single connection), which adds one DB round trip
 *     per query to almost every page. 5 lets a page's parallel queries actually run in parallel. The
 *     transaction pooler multiplexes these onto a small number of real Postgres connections, so the pool
 *     ceiling to watch is Supabase's pooler client limit (instances × 5), not Postgres max_connections.
 *   - `pool_timeout=20`: seconds to wait for a free pooled connection before erroring (default 10). Gives
 *     headroom when a cold Supabase is waking up.
 *
 * Run `prisma migrate deploy` against the session pooler or direct connection (port 5432), not this URL.
 * See specs/21-performance-scaling.md.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Errors and warnings only: query logging costs a string format per query on every request.
    log: ['error', 'warn'],
  })

globalForPrisma.prisma = prisma
