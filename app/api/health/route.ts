import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Cheap liveness + keep-warm endpoint. Point an external uptime monitor (UptimeRobot, Better Uptime,
 * etc.) at this every ~5 min: it keeps a Vercel function + a Supabase pooler connection warm, so real
 * users (esp. the login request) rarely hit the cold-start path that makes sign-in feel slow. Does one
 * trivial `SELECT 1`; returns 200 ok / 503 on DB error. No auth, no data exposed.
 */
export async function GET() {
  const t0 = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    return Response.json({ ok: true, dbMs: Date.now() - t0 })
  } catch {
    return Response.json({ ok: false }, { status: 503 })
  }
}
