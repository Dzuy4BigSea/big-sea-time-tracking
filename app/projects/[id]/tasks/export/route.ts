import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { toCsv, csvResponse } from '@/lib/csv'

export const dynamic = 'force-dynamic'

/** Per-task (and per-person) time breakdown for a project + month → CSV (project → Tasks → Export). */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { accountId } = await requireUser()
  const owns = await prisma.project.findFirst({ where: { id: params.id, accountId }, select: { name: true, code: true } })
  if (!owns) return new Response('Not found', { status: 404 })

  const now = new Date()
  const m = /^(\d{4})-(\d{2})$/.exec(req.nextUrl.searchParams.get('month') ?? '')
  const y = m ? Number(m[1]) : now.getUTCFullYear()
  const mo = m ? Number(m[2]) - 1 : now.getUTCMonth()
  const start = new Date(Date.UTC(y, mo, 1))
  const end = new Date(Date.UTC(y, mo + 1, 1))

  const rows = await prisma.$queryRaw<{ task: string; fn: string; ln: string; mins: number; bc: number }[]>`
    SELECT t.name AS task, u."firstName" AS fn, u."lastName" AS ln,
      COALESCE(SUM(te.minutes),0)::int AS mins,
      COALESCE(SUM(CASE WHEN te."isBillable" THEN te.minutes/60.0*COALESCE(te."billableRateCents",0) ELSE 0 END),0)::float8 AS bc
    FROM "TimeEntry" te JOIN "Task" t ON t.id = te."taskId" JOIN "User" u ON u.id = te."userId"
    WHERE te."accountId" = ${accountId} AND te."projectId" = ${params.id} AND te."spentDate" >= ${start} AND te."spentDate" < ${end}
    GROUP BY t.name, u."firstName", u."lastName" ORDER BY t.name ASC, mins DESC`

  const body = rows.map((r) => [r.task, `${r.fn} ${r.ln}`.trim(), (Number(r.mins) / 60).toFixed(2), (Number(r.bc) / 100).toFixed(2)])
  const csv = toCsv(['Task', 'Person', 'Hours', 'Billable amount'], body)
  const label = `${owns.code ? owns.code + '-' : ''}${owns.name}`.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40)
  return csvResponse(`project-${label}-${y}-${String(mo + 1).padStart(2, '0')}.csv`, csv)
}
