import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
// Prisma's query engine needs the Node runtime. The region is pinned project-wide in vercel.json
// (`regions`, next to the Supabase database) rather than per route, so every function shares it.
export const runtime = 'nodejs'

/** True only for the first request this server instance handles: shows cold boots in keep-warm logs. */
let firstRequest = true

const DEEP_TIMEOUT_MS = 5000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

/**
 * Cheap liveness + keep-warm endpoint (see .github/workflows/keep-warm.yml and
 * specs/21-performance-scaling.md). One `SELECT 1` keeps this function instance, the Prisma engine and
 * a pooler connection warm, and wakes an idle database. Returns 200 / 503. No auth, no data exposed:
 * only timings.
 *
 * `?deep=1` also reads one row through the busiest index (an index-only scan of
 * `TimeEntry(accountId, spentDate)`), checking the real tables answer, bounded by a 5s timeout.
 */
export async function GET(req: Request) {
  const cold = firstRequest
  firstRequest = false
  const deep = new URL(req.url).searchParams.get('deep') === '1'
  const headers = { 'Cache-Control': 'no-store' }
  const region = process.env.VERCEL_REGION ?? null

  const t0 = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    return Response.json({ ok: false, cold, region, dbMs: Date.now() - t0 }, { status: 503, headers })
  }
  const dbMs = Date.now() - t0
  if (!deep) return Response.json({ ok: true, cold, region, dbMs }, { headers })

  const t1 = Date.now()
  try {
    await withTimeout(
      prisma.$queryRaw`SELECT 1 FROM "TimeEntry" ORDER BY "accountId" DESC, "spentDate" DESC LIMIT 1`,
      DEEP_TIMEOUT_MS,
    )
    return Response.json({ ok: true, cold, region, dbMs, deepMs: Date.now() - t1 }, { headers })
  } catch {
    return Response.json({ ok: false, cold, region, dbMs, deepMs: Date.now() - t1 }, { status: 503, headers })
  }
}
