import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { toCsv, csvResponse } from '@/lib/csv'
import { defaultPeriodFor, resolveTimeframe, timeframeLabel, type WeekStart } from '@/modules/projects/timeframe'

export const dynamic = 'force-dynamic'

/** Per-task (and per-person) time breakdown for a project + timeframe → CSV (project → Tasks → Export).
 *  Takes the project page's timeframe params (period/date/from/to); legacy ?month=YYYY-MM still works. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { accountId } = await requireUser()
  const [owns, account] = await Promise.all([
    prisma.project.findFirst({
      where: { id: params.id, accountId },
      select: { name: true, code: true, projectType: true, budgetMethod: true, budgetResetsMonthly: true },
    }),
    prisma.account.findUnique({ where: { id: accountId }, select: { weekStartsOn: true } }),
  ])
  if (!owns) return new Response('Not found', { status: 404 })

  const sp = req.nextUrl.searchParams
  const get = (k: string) => sp.get(k) ?? undefined
  const tf = resolveTimeframe(
    { period: get('period'), date: get('date'), from: get('from'), to: get('to'), month: get('month'), year: get('year') },
    { weekStartsOn: (account?.weekStartsOn ?? 'monday') as WeekStart, defaultPeriod: defaultPeriodFor(owns) },
  )
  const range: Prisma.Sql[] = []
  if (tf.start) range.push(Prisma.sql`AND te."spentDate" >= ${tf.start}`)
  if (tf.end) range.push(Prisma.sql`AND te."spentDate" < ${tf.end}`)

  const rows = await prisma.$queryRaw<{ task: string; fn: string; ln: string; mins: number; bc: number }[]>`
    SELECT t.name AS task, u."firstName" AS fn, u."lastName" AS ln,
      COALESCE(SUM(te.minutes),0)::int AS mins,
      COALESCE(SUM(CASE WHEN te."isBillable" THEN te.minutes/60.0*COALESCE(te."billableRateCents",0) ELSE 0 END),0)::float8 AS bc
    FROM "TimeEntry" te JOIN "Task" t ON t.id = te."taskId" JOIN "User" u ON u.id = te."userId"
    WHERE te."accountId" = ${accountId} AND te."projectId" = ${params.id} ${range.length ? Prisma.join(range, ' ') : Prisma.empty}
    GROUP BY t.name, u."firstName", u."lastName" ORDER BY t.name ASC, mins DESC`

  const body = rows.map((r) => [r.task, `${r.fn} ${r.ln}`.trim(), (Number(r.mins) / 60).toFixed(2), (Number(r.bc) / 100).toFixed(2)])
  const csv = toCsv(['Task', 'Person', 'Hours', 'Billable amount'], body)
  const label = `${owns.code ? owns.code + '-' : ''}${owns.name}`.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40)
  const period = timeframeLabel(tf).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return csvResponse(`project-${label}-${period}.csv`, csv)
}
