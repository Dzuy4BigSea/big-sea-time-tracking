import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { accountWeekStartsOn } from '@/lib/accountPrefs'
import { EXPORT_BATCH } from '@/lib/csvStream'
import type { CurrentUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { defaultPeriodFor, resolveTimeframe, type TimeframeParams, type WeekStart } from '@/modules/shared/timeframe'
import { isUninvoiced } from '@/modules/invoicing/uninvoiced'
import { parseDetailed, detailedTimeframe } from '@/modules/reports/detailed'
import { detailedTimeBatch, type DetailedExportCursor } from '@/modules/reports/detailedTimeExport'
import type { DetailedTimeRow } from '@/modules/reports/detailedSql'
import { parseTimeTab } from '@/modules/reports/timeReport'
import { buildSheetName, type ExportKind } from '@/modules/integrations/googleDrive'

/**
 * The report CSV exports, as data: each builder checks permissions (exactly as the CSV routes always
 * did), scopes every query to the user's account, and returns the header row plus an async batch
 * source. The CSV routes stream it (lib/csvStream → csvStreamResponse); "Export → Google Drive"
 * collects it (collectCsv) and uploads it as a Sheet. One generator, two outputs.
 */
export interface ExportSpec {
  /** Download filename for the CSV route. */
  filename: string
  /** Google Sheet name for the Drive export. */
  sheetName: string
  headers: string[]
  batches: () => AsyncIterable<unknown[][]>
}
export type ExportBuild = { ok: true; spec: ExportSpec } | { ok: false; status: 403 | 404; message: string }

const ymd = (d: Date) => new Date(d).toISOString().slice(0, 10)
const forbidden: ExportBuild = { ok: false, status: 403, message: 'Forbidden' }
const notFound: ExportBuild = { ok: false, status: 404, message: 'Not found' }

const mayRunAccountReports = (me: CurrentUser) =>
  can({ permissionProfile: me.permissionProfile as PermissionProfile, permissionOverrides: me.permissionOverrides }, 'run_account_reports')

const TIME_TAB_LABEL = { clients: 'Clients', projects: 'Projects', tasks: 'Tasks', users: 'Teammates' } as const

/**
 * Time report (Reports → Export). Account-scoped; reports permission required. Keyset pagination on
 * (spentDate, id) in batches of EXPORT_BATCH, so "All time" (388k rows) never loads the whole table.
 */
export async function timeReportExport(me: CurrentUser, sp: URLSearchParams): Promise<ExportBuild> {
  const { accountId } = me
  if (!mayRunAccountReports(me)) return forbidden
  // Same timeframe params as the report screen (the Export link carries them); none = all time.
  const tf = resolveTimeframe(Object.fromEntries(['period', 'anchor', 'from', 'to'].map((k) => [k, sp.get(k) ?? undefined])) as TimeframeParams, {
    weekStartsOn: await accountWeekStartsOn(accountId),
  })
  const spentDate = tf.from || tf.till ? { ...(tf.from ? { gte: tf.from } : {}), ...(tf.till ? { lte: tf.till } : {}) } : undefined

  const baseWhere = { accountId, isRunning: false, ...(spentDate ? { spentDate } : {}) }
  const select = {
    id: true,
    spentDate: true,
    minutes: true,
    notes: true,
    isBillable: true,
    billableRateCents: true,
    invoiceLineItemId: true,
    lockState: true,
    user: { select: { firstName: true, lastName: true } },
    task: { select: { name: true } },
    project: { select: { name: true, code: true, client: { select: { name: true, currency: true } } } },
  } as const

  const hrs = (m: number) => (m / 60).toFixed(2)
  const toRow = (e: Awaited<ReturnType<typeof fetchBatch>>[number]) => {
    const amountCents = e.isBillable && e.billableRateCents ? Math.round((e.minutes / 60) * e.billableRateCents) : 0
    const status = !e.isBillable
      ? 'non-billable'
      : isUninvoiced({ isBillable: e.isBillable, invoiceLineItemId: e.invoiceLineItemId, lockState: e.lockState })
        ? 'uninvoiced'
        : e.lockState
    return [
      ymd(e.spentDate),
      e.project.client.name,
      e.project.code ? `[${e.project.code}] ${e.project.name}` : e.project.name,
      e.task.name,
      `${e.user.firstName} ${e.user.lastName}`.trim(),
      e.notes ?? '',
      hrs(e.minutes),
      e.isBillable ? 'yes' : 'no',
      e.billableRateCents != null ? (e.billableRateCents / 100).toFixed(2) : '',
      amountCents ? (amountCents / 100).toFixed(2) : '',
      e.project.client.currency,
      status,
    ]
  }

  async function fetchBatch(after: { spentDate: Date; id: string } | null) {
    return prisma.timeEntry.findMany({
      where: after
        ? { AND: [baseWhere, { OR: [{ spentDate: { gt: after.spentDate } }, { spentDate: after.spentDate, id: { gt: after.id } }] }] }
        : baseWhere,
      select,
      orderBy: [{ spentDate: 'asc' }, { id: 'asc' }],
      take: EXPORT_BATCH,
    })
  }

  async function* batches() {
    let after: { spentDate: Date; id: string } | null = null
    for (;;) {
      const page = await fetchBatch(after)
      if (!page.length) return
      yield page.map(toRow)
      if (page.length < EXPORT_BATCH) return
      const last = page[page.length - 1]
      after = { spentDate: last.spentDate, id: last.id }
    }
  }

  const tab = parseTimeTab({ tab: sp.get('tab') ?? undefined })
  return {
    ok: true,
    spec: {
      filename: 'time-report.csv',
      sheetName: buildSheetName(['Time report', TIME_TAB_LABEL[tab]], tf),
      headers: ['Date', 'Client', 'Project', 'Task', 'Person', 'Notes', 'Hours', 'Billable', 'Rate', 'Amount', 'Currency', 'Status'],
      batches,
    },
  }
}

/**
 * Detailed time report → CSV, same filters and order as the screen, every matching entry (no row cap).
 * People without account-wide reports only get their own entries (as on the screen).
 */
export async function detailedTimeExport(me: CurrentUser, sp: URLSearchParams): Promise<ExportBuild> {
  const canRunAll = mayRunAccountReports(me)
  const f = parseDetailed('time', Object.fromEntries(sp))
  const tf = detailedTimeframe(f, { weekStartsOn: await accountWeekStartsOn(me.accountId) })
  const scope = { accountId: me.accountId, onlyUserId: canRunAll ? null : me.userId }

  const toRow = (r: DetailedTimeRow) => {
    const amount = r.isBillable && r.billableRateCents ? Math.round((r.minutes / 60) * r.billableRateCents) : 0
    return [
      ymd(r.spentDate),
      r.clientName,
      r.projectCode ? `[${r.projectCode}] ${r.projectName}` : r.projectName,
      r.taskName,
      r.notes ?? '',
      (r.minutes / 60).toFixed(2),
      r.isBillable ? 'Yes' : 'No',
      r.invoiced ? 'Yes' : 'No',
      r.billableRateCents != null ? (r.billableRateCents / 100).toFixed(2) : '',
      amount ? (amount / 100).toFixed(2) : '',
      r.userName,
      (r.roles ?? []).join(', '),
    ]
  }

  async function* batches() {
    let after: DetailedExportCursor | null = null
    for (;;) {
      const page = await detailedTimeBatch(f, tf, scope, after, EXPORT_BATCH)
      if (page.rows.length) yield page.rows.map(toRow)
      if (!page.next) return
      after = page.next
    }
  }

  return {
    ok: true,
    spec: {
      filename: `detailed-time-${tf.from ? ymd(tf.from) : 'all'}${tf.till ? `-to-${ymd(tf.till)}` : ''}.csv`,
      sheetName: buildSheetName(['Detailed time report'], tf),
      headers: ['Date', 'Client', 'Project', 'Task', 'Notes', 'Hours', 'Billable?', 'Invoiced?', 'Billable rate', 'Billable amount', 'Person', 'Roles'],
      batches,
    },
  }
}

/**
 * Profitability (Reports → Profitability → Export): revenue per client/project for the timeframe,
 * aggregated in the DB exactly like the screen. Cost is 0 until person cost rates are backfilled
 * (specs/19), so Margin = Revenue for now, as on the screen.
 */
export async function profitabilityExport(me: CurrentUser, sp: URLSearchParams): Promise<ExportBuild> {
  const { accountId } = me
  if (!mayRunAccountReports(me)) return forbidden
  const tf = resolveTimeframe(Object.fromEntries(['period', 'anchor', 'from', 'to'].map((k) => [k, sp.get(k) ?? undefined])) as TimeframeParams, {
    defaultPeriod: 'week',
    weekStartsOn: await accountWeekStartsOn(accountId),
  })
  const dateFilter = Prisma.sql`${tf.from ? Prisma.sql`AND te."spentDate" >= ${tf.from}` : Prisma.empty} ${tf.till ? Prisma.sql`AND te."spentDate" <= ${tf.till}` : Prisma.empty}`

  async function* batches() {
    const raw = await prisma.$queryRaw<{ client: string; project: string; code: string | null; currency: string; revenue: number }[]>`
      SELECT c.name AS client, p.name AS project, p.code AS code, c.currency::text AS currency,
        SUM(CASE WHEN te."isBillable" THEN te.minutes/60.0*COALESCE(te."billableRateCents",0) ELSE 0 END)::float8 AS revenue
      FROM "TimeEntry" te JOIN "Project" p ON p.id = te."projectId" JOIN "Client" c ON c.id = p."clientId"
      WHERE te."accountId" = ${accountId} ${dateFilter}
      GROUP BY c.name, p.name, p.code, c.currency HAVING SUM(te.minutes) > 0 ORDER BY revenue DESC, c.name ASC, p.name ASC`
    yield raw.map((r) => {
      const revenue = Math.round(Number(r.revenue))
      const cost = 0
      const margin = revenue - cost
      return [
        r.client,
        r.code ? `[${r.code}] ${r.project}` : r.project,
        (revenue / 100).toFixed(2),
        (cost / 100).toFixed(2),
        (margin / 100).toFixed(2),
        revenue > 0 ? String(Math.round((margin / revenue) * 100)) : '',
        r.currency,
      ]
    })
  }

  return {
    ok: true,
    spec: {
      filename: `profitability-${tf.from ? ymd(tf.from) : 'all'}${tf.till ? `-to-${ymd(tf.till)}` : ''}.csv`,
      sheetName: buildSheetName(['Profitability report'], tf),
      headers: ['Client', 'Project', 'Revenue', 'Cost', 'Margin', 'Margin %', 'Currency'],
      batches,
    },
  }
}

/**
 * Per-task (and per-person) time breakdown for a project + timeframe (project → Tasks → Export).
 * Takes the project page's timeframe params (period/anchor/from/to; ?date= and legacy ?month=/?year= still work).
 */
export async function projectTasksExport(me: CurrentUser, projectId: string, sp: URLSearchParams): Promise<ExportBuild> {
  const { accountId } = me
  // Dollar amounts follow the same rule as Reports: only for people who may see billable rates.
  const showAmounts = can({ permissionProfile: me.permissionProfile as PermissionProfile, permissionOverrides: me.permissionOverrides }, 'view_billable_rates')
  const [owns, account] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId, accountId },
      select: { name: true, code: true, projectType: true, budgetMethod: true, budgetResetsMonthly: true },
    }),
    prisma.account.findUnique({ where: { id: accountId }, select: { weekStartsOn: true } }),
  ])
  if (!owns) return notFound

  const get = (k: string) => sp.get(k) ?? undefined
  const tf = resolveTimeframe(
    { period: get('period'), anchor: get('anchor'), date: get('date'), from: get('from'), to: get('to'), month: get('month'), year: get('year') },
    { weekStartsOn: (account?.weekStartsOn ?? 'monday') as WeekStart, defaultPeriod: defaultPeriodFor(owns) },
  )
  const range: Prisma.Sql[] = []
  if (tf.from) range.push(Prisma.sql`AND te."spentDate" >= ${tf.from}`)
  if (tf.till) range.push(Prisma.sql`AND te."spentDate" <= ${tf.till}`)

  async function* batches() {
    const rows = await prisma.$queryRaw<{ task: string; fn: string; ln: string; mins: number; bc: number }[]>`
      SELECT t.name AS task, u."firstName" AS fn, u."lastName" AS ln,
        COALESCE(SUM(te.minutes),0)::int AS mins,
        COALESCE(SUM(CASE WHEN te."isBillable" THEN te.minutes/60.0*COALESCE(te."billableRateCents",0) ELSE 0 END),0)::float8 AS bc
      FROM "TimeEntry" te JOIN "Task" t ON t.id = te."taskId" JOIN "User" u ON u.id = te."userId"
      WHERE te."accountId" = ${accountId} AND te."projectId" = ${projectId} ${range.length ? Prisma.join(range, ' ') : Prisma.empty}
      GROUP BY t.name, u."firstName", u."lastName" ORDER BY t.name ASC, mins DESC`
    yield rows.map((r) => {
      const base = [r.task, `${r.fn} ${r.ln}`.trim(), (Number(r.mins) / 60).toFixed(2)]
      return showAmounts ? [...base, (Number(r.bc) / 100).toFixed(2)] : base
    })
  }

  const label = `${owns.code ? owns.code + '-' : ''}${owns.name}`.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40)
  const period = tf.label.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return {
    ok: true,
    spec: {
      filename: `project-${label}-${period}.csv`,
      sheetName: buildSheetName([owns.code ? `[${owns.code}] ${owns.name}` : owns.name, 'Tasks'], tf),
      headers: showAmounts ? ['Task', 'Person', 'Hours', 'Billable amount'] : ['Task', 'Person', 'Hours'],
      batches,
    },
  }
}

/** Dispatch for the Drive export (the CSV routes call their builder directly). */
export function buildExport(me: CurrentUser, target: { kind: ExportKind; projectId?: string; params: URLSearchParams }): Promise<ExportBuild> {
  switch (target.kind) {
    case 'time':
      return timeReportExport(me, target.params)
    case 'detailed':
      return detailedTimeExport(me, target.params)
    case 'profitability':
      return profitabilityExport(me, target.params)
    case 'project_tasks':
      return target.projectId ? projectTasksExport(me, target.projectId, target.params) : Promise.resolve(notFound)
  }
}
