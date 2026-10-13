import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { formatCents, formatDate } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { getModules } from '@/lib/modules'
import { BADGE_STYLES, BADGE_LABEL } from '@/lib/labels'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { defaultPeriodFor, resolveTimeframe, timeframeQuery, endExclusive, buildHref, type Timeframe, type WeekStart } from '@/modules/shared/timeframe'
import { parseSort, sortRows, type SortState } from '@/modules/reports/sort'
import { displayBadge, type StoredStatus } from '@/modules/invoicing/invoiceState'
import { fixedFeeStatus } from '@/modules/invoicing/fixedFee'
import {
  PROJECT_TYPE_LABEL, projectDateRange, budgetSummary, billableRatesMissing, initials, rollup, isBillableTask, preTaxCents,
  type TaskPersonCell,
} from '@/modules/projects/projectAnalysis'
import { ProjectTimeframeToolbar } from '@/components/ProjectTimeframeToolbar'
import { ProjectNotes } from '@/components/ProjectNotes'
import { DropdownMenu } from '@/components/DropdownMenu'
import {
  ProjectTaskBreakdown, type BreakdownRow, type BreakdownChild, type BreakdownSortKey,
} from '@/components/ProjectTaskBreakdown'
import { ColumnChart } from '@/components/ColumnChart'
import {
  addTaskToProjectAction,
  removeTaskFromProjectAction,
  toggleProjectTaskBillableAction,
  setProjectTaskRateAction,
  setProjectArchivedAction,
} from '@/app/projects/actions'
import { createBlankInvoiceAction } from '@/app/invoices/[id]/edit/actions'
import { ExportMenu } from '@/components/ExportMenu'

export const dynamic = 'force-dynamic'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const hrs = (m: number) => (m / 60).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (v: unknown) => Number(v ?? 0)

/** `AND col >= from AND col <= till` for the bounded side(s) of a timeframe (empty for All time). `col` is a DATE column. */
function rangeSql(tf: Timeframe, col: string): Prisma.Sql {
  const c = Prisma.raw(col)
  const parts: Prisma.Sql[] = []
  if (tf.from) parts.push(Prisma.sql`AND ${c} >= ${tf.from}`)
  if (tf.till) parts.push(Prisma.sql`AND ${c} <= ${tf.till}`)
  return parts.length ? Prisma.join(parts, ' ') : Prisma.empty
}

// (Defined here, not in the client component: a server component can't read a 'use client' module's values.)
// The Tasks and Team tables share one set of sortable columns.
const SORT_KEYS: readonly BreakdownSortKey[] = ['name', 'hours', 'billable', 'costs']
// Default order on both tables: most hours first (Harvest: "Hours ^").
const DEFAULT_SORT = { key: 'hours', dir: 'desc' } as const
const BY_COL = {
  name: (r: { name: string }) => r.name,
  hours: (r: { minutes: number }) => r.minutes,
  billable: (r: { billableCents: number }) => r.billableCents,
  costs: (r: { costCents: number }) => r.costCents,
}

const PROJECT_INCLUDE = Prisma.validator<Prisma.ProjectInclude>()({
  client: true,
  userAssignments: { where: { isActive: true }, include: { user: { select: { id: true, firstName: true, lastName: true, isActive: true } } }, orderBy: { user: { firstName: 'asc' } } },
  taskAssignments: { include: { task: { select: { id: true, name: true, defaultHourlyRateCents: true } } }, orderBy: { task: { name: 'asc' } } },
})
type ProjectWithAssignments = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>

type SearchParams = {
  tab?: string; period?: string; anchor?: string; date?: string; from?: string; to?: string; month?: string; year?: string; cy?: string
  sort?: string; dir?: string
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: SearchParams
}) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  const perm = { permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }
  const canManage = can(perm, 'manage_projects')

  const [project, account] = await Promise.all([
    prisma.project.findFirst({ where: { id: params.id, accountId }, include: PROJECT_INCLUDE }),
    prisma.account.findUnique({ where: { id: accountId }, select: { weekStartsOn: true } }),
  ])
  if (!project) notFound()
  const pid = project.id

  const now = new Date()
  const tab = ['tasks', 'team', 'invoices'].includes(searchParams.tab ?? '') ? searchParams.tab! : 'tasks'
  const weekStartsOn = (account?.weekStartsOn ?? 'monday') as WeekStart
  // Timeframe for the tab tables. Default: Month for monthly-reset budgets, otherwise All time
  // (modules/shared/timeframe.ts → defaultPeriodFor). ?date= and legacy ?month=/?year= links still resolve.
  // The summary cards are always all-time (Harvest) and ignore it.
  const tf = resolveTimeframe(searchParams, { now, weekStartsOn, defaultPeriod: defaultPeriodFor(project) })
  // The hours chart is always a calendar year: the timeframe's year unless navigated (?cy=).
  const cyParam = /^\d{4}$/.test(searchParams.cy ?? '') ? Number(searchParams.cy) : null
  const chartYear = cyParam ?? (tf.from ? tf.from.getUTCFullYear() : now.getUTCFullYear())
  const yStart = new Date(Date.UTC(chartYear, 0, 1))
  const yEnd = new Date(Date.UTC(chartYear + 1, 0, 1))

  // A budget that resets monthly is measured against the current calendar month.
  const monthly = Boolean(project.budgetResetsMonthly && project.budgetMethod !== 'none' && project.budgetValue)
  const mStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const mEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))

  const w = Prisma.sql`"accountId" = ${accountId} AND "projectId" = ${pid}`
  const billableCentsSql = Prisma.sql`COALESCE(SUM(CASE WHEN "isBillable" THEN minutes/60.0*COALESCE("billableRateCents",0) ELSE 0 END),0)::float8`

  // Aggregates (DB-side — never load raw entries; a real project has thousands).
  type Totals = { mins: number; bmins: number; bc: number; uc: number; um: number; norate: number }
  const [chart, totalsRow, monthRow, invoicedRow, expenseRow, costRateCount] = await Promise.all([
    prisma.$queryRaw<{ m: number; mins: number }[]>`
      SELECT EXTRACT(MONTH FROM "spentDate")::int AS m, COALESCE(SUM(minutes),0)::int AS mins
      FROM "TimeEntry" WHERE ${w} AND "spentDate" >= ${yStart} AND "spentDate" < ${yEnd} GROUP BY 1`,
    // All-time totals for the summary cards, in one pass.
    prisma.$queryRaw<Totals[]>`
      SELECT COALESCE(SUM(minutes),0)::int AS mins,
        COALESCE(SUM(CASE WHEN "isBillable" THEN minutes ELSE 0 END),0)::int AS bmins,
        ${billableCentsSql} AS bc,
        COALESCE(SUM(CASE WHEN "isBillable" AND "invoiceLineItemId" IS NULL AND "lockState" <> 'invoiced'
          THEN minutes/60.0*COALESCE("billableRateCents",0) ELSE 0 END),0)::float8 AS uc,
        COALESCE(SUM(CASE WHEN "isBillable" AND "invoiceLineItemId" IS NULL AND "lockState" <> 'invoiced'
          THEN minutes ELSE 0 END),0)::int AS um,
        COALESCE(SUM(CASE WHEN "isBillable" AND "billableRateCents" IS NULL THEN minutes ELSE 0 END),0)::int AS norate
      FROM "TimeEntry" WHERE ${w}`,
    monthly
      ? prisma.$queryRaw<{ mins: number; bc: number }[]>`
          SELECT COALESCE(SUM(minutes),0)::int AS mins, ${billableCentsSql} AS bc
          FROM "TimeEntry" WHERE ${w} AND "spentDate" >= ${mStart} AND "spentDate" < ${mEnd}`
      : Promise.resolve([] as { mins: number; bc: number }[]),
    prisma.$queryRaw<{ c: bigint }[]>`
      SELECT COALESCE(SUM(li."amountCents"),0)::bigint AS c
      FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
      WHERE li."accountId" = ${accountId} AND li."linkedProjectId" = ${pid} AND i.status <> 'draft'`,
    prisma.expense.aggregate({ where: { accountId, projectId: pid }, _sum: { totalCents: true } }),
    prisma.personCostRate.count({ where: { accountId } }),
  ])

  const showCosts = costRateCount > 0 // cost rates aren't migrated from Harvest → hide the empty column
  const totals = totalsRow[0]
  const totalMin = num(totals?.mins)
  const billableMin = num(totals?.bmins)
  const invoicedCents = num(invoicedRow[0]?.c)
  // Fixed Fee (Harvest): uninvoiced amount = project fee − amount invoiced (any existing invoice,
  // drafts included); its hours stay "uninvoiced hours" and are not billed by rate.
  const isFixedFee = project.projectType === 'fixed_fee'
  const ffStatus = isFixedFee ? (await fixedFeeStatus(prisma, accountId, { projectIds: [pid] }))[0] : undefined
  const uninvoicedCents = isFixedFee ? ffStatus?.remainingCents ?? 0 : Math.round(num(totals?.uc))
  const uninvoicedMin = num(totals?.um)
  const expenseCents = expenseRow._sum.totalCents ?? 0
  const ratesMissing = billableRatesMissing(project, num(totals?.norate))

  const budget = budgetSummary(
    project,
    monthly
      ? { minutes: num(monthRow[0]?.mins), billableCents: Math.round(num(monthRow[0]?.bc)) }
      : { minutes: totalMin, billableCents: Math.round(num(totals?.bc)) },
  )
  const fmtBudget = (v: number) => (budget?.unit === 'money' ? formatCents(v) : hrs(v))

  const chartMap = new Map(chart.map((r) => [r.m, r.mins]))
  const months = MONTHS.map((_, i) => chartMap.get(i + 1) ?? 0)
  // Highlight the chart months that overlap the selected timeframe (the current month for All time).
  const inTimeframe = (i: number) => {
    if (!tf.from && !tf.till) return chartYear === now.getUTCFullYear() && i === now.getUTCMonth()
    const ms = new Date(Date.UTC(chartYear, i, 1))
    const me = new Date(Date.UTC(chartYear, i + 1, 0)) // last day of the month
    return (!tf.till || ms <= tf.till) && (!tf.from || me >= tf.from)
  }

  // Sortable Tasks / Team tables (?sort=&dir=). Only a non-default sort goes in the URL; tab switches drop it.
  const sort = parseSort<BreakdownSortKey>(searchParams, SORT_KEYS, DEFAULT_SORT)
  const sortq = tab !== 'invoices' && !(sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir) ? { sort: sort.key, dir: sort.dir } : {}

  const tfQuery = timeframeQuery(tf)
  const basePath = `/projects/${pid}`
  const editHref = `/projects/${pid}/edit`
  const pageQuery: Record<string, string | undefined> = { tab, ...tfQuery, ...sortq, cy: cyParam ? String(cyParam) : undefined }
  const qp = (over: Record<string, string | undefined>) => buildHref(basePath, { ...pageQuery, ...over })
  const sortBase = { ...pageQuery, sort: undefined, dir: undefined }
  const exportHref = buildHref(`/projects/${pid}/tasks/export`, tfQuery)
  const dateRange = projectDateRange(project.startsOn, project.endsOn, now)

  return (
    <div>
      <Link href="/projects" className="text-sm text-gray-500 hover:text-brand-teal">← Back to Projects</Link>

      {/* Header: client, [CODE] name, type pill, dates, notes; Edit project + Actions on the right */}
      <div className="mb-5 mt-3 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-700">{project.client.name}</div>
          <h1 className="text-2xl font-semibold text-gray-900">{project.code ? `[${project.code}] ` : ''}{project.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-gray-500">
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">{PROJECT_TYPE_LABEL[project.projectType] ?? project.projectType}</span>
            {!project.isActive && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Archived</span>}
            {dateRange && <span><span aria-hidden>📅 </span>{dateRange}</span>}
          </div>
          {project.notes && <ProjectNotes notes={project.notes} />}
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Link href={editHref} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">✎ Edit project</Link>
            <DropdownMenu
              label="Actions ▾"
              summaryClassName="cursor-pointer list-none rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <form action={setProjectArchivedAction}>
                <input type="hidden" name="projectId" value={pid} />
                <input type="hidden" name="archived" value={project.isActive ? 'on' : 'off'} />
                <button className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50">{project.isActive ? 'Archive' : 'Restore'}</button>
              </form>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Monthly hours chart (follows the selected timeframe's year; ?cy= navigates years) */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-3">
          <Link href={qp({ cy: String(chartYear - 1) })} className="rounded border border-gray-300 px-2 text-sm text-gray-600 hover:bg-gray-50">←</Link>
          <Link href={qp({ cy: String(chartYear + 1) })} className="rounded border border-gray-300 px-2 text-sm text-gray-600 hover:bg-gray-50">→</Link>
          <h2 className="text-sm font-semibold text-gray-700">Hours tracked — {chartYear}</h2>
        </div>
        <ColumnChart
          format={(v) => `${Math.round(v / 60)}h`}
          bars={months.map((mins, i) => {
            const isCurrent = inTimeframe(i)
            return {
              label: MONTHS[i],
              title: `${MONTHS[i]} ${chartYear}: ${hrs(mins)}h`,
              highlight: isCurrent,
              segments: [{ value: mins, color: isCurrent ? '#9ca3af' : '#c7ccd1' }],
            }
          })}
        />
      </div>

      {/* Summary cards: always all-time (Harvest) — they do not follow the timeframe below */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Card title="Total hours">
          <Big>{hrs(totalMin)}</Big>
          <Line label="Billable" value={hrs(billableMin)} />
          <Line label="Non-billable" value={hrs(totalMin - billableMin)} />
        </Card>
        {budget ? (
          <Card title={`Budget remaining (${budget.pctRemaining}%)`} note={monthly ? `${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()} · resets monthly` : undefined}>
            <Big className={budget.over ? 'text-red-600' : undefined}>{fmtBudget(budget.remaining)}</Big>
            <Line label={monthly ? 'Monthly budget' : 'Total budget'} value={fmtBudget(budget.budget)} />
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100" title={`${budget.pctSpent}% spent`}>
              <div className={`h-full rounded-full ${budget.over ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${budget.pctSpent}%` }} />
            </div>
          </Card>
        ) : (
          <Card title="Budget">
            <Big className="text-gray-400">—</Big>
            <div className="mt-1 text-xs text-gray-400">
              {project.projectType === 'fixed_fee' && project.projectFeesCents ? `Project fee ${formatCents(project.projectFeesCents)}` : 'No budget set'}
            </div>
          </Card>
        )}
        <Card title="Internal costs">
          {/* Time cost needs person cost rates, which aren't imported from Harvest yet. */}
          <Big>{formatCents(expenseCents)}</Big>
          <Line label="Time" value={showCosts ? formatCents(0) : '—'} />
          <Line label="Expenses" value={formatCents(expenseCents)} />
        </Card>
        <Card title="Invoiced amount">
          <Big>{formatCents(invoicedCents)}</Big>
        </Card>
        <Card title="Uninvoiced amount">
          {ratesMissing ? (
            <div className="text-sm text-gray-600">
              This project&apos;s billable rates were never set.{' '}
              {canManage && <Link href={editHref} className="text-brand-teal hover:underline">Set billable rates</Link>}
            </div>
          ) : (
            <>
              <Big className={uninvoicedCents > 0 ? 'text-brand-green' : undefined}>{formatCents(uninvoicedCents)}</Big>
              {isFixedFee && (
                <>
                  <Line label="Project fee" value={ffStatus?.feeCents != null ? formatCents(ffStatus.feeCents) : '—'} />
                  <Line label="Invoiced" value={formatCents(ffStatus?.invoicedCents ?? 0)} />
                  <Line label="Uninvoiced hours" value={(uninvoicedMin / 60).toFixed(2)} />
                </>
              )}
            </>
          )}
        </Card>
      </div>

      {/* Tabs (each link keeps the timeframe) */}
      <div className="mb-5 flex gap-6 border-b border-gray-200 text-sm">
        {[{ k: 'tasks', l: 'Tasks' }, { k: 'team', l: 'Team' }, { k: 'invoices', l: 'Invoices' }].map((t) => (
          <Link key={t.k} href={qp({ tab: t.k, sort: undefined, dir: undefined })} className={`-mb-px border-b-2 pb-2 ${tab === t.k ? 'border-brand-teal font-semibold text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {t.l}
          </Link>
        ))}
      </div>

      {tab === 'tasks' && (
        <TasksTab
          project={project} accountId={accountId} tf={tf} showCosts={showCosts} canManage={canManage} ratesMissing={ratesMissing}
          sort={sort} basePath={basePath} sortBase={sortBase} now={now} editHref={editHref}
          toolbarActions={<ExportMenu csvHref={exportHref} />}
          keep={{ tab, ...sortq }}
        />
      )}
      {tab === 'team' && (
        <TeamTab
          project={project} accountId={accountId} tf={tf} showCosts={showCosts} sort={sort} basePath={basePath} sortBase={sortBase} now={now}
          toolbarActions={canManage ? <Link href={`${editHref}#team`} className="text-sm text-brand-teal hover:underline">Manage team</Link> : null}
          keep={{ tab, ...sortq }}
        />
      )}
      {tab === 'invoices' && (
        <InvoicesTab
          pid={pid} clientId={project.clientId} accountId={accountId} tf={tf} basePath={basePath} now={now}
          canInvoice={can(perm, 'manage_invoices')} keep={{ tab }}
        />
      )}
    </div>
  )
}

/**
 * The Tasks and Team tables both come from ONE grouped query (task × person) for the timeframe;
 * each table rolls it up along its own axis, with the other axis as expandable children.
 */
async function taskPersonCells(accountId: string, projectId: string, tf: Timeframe): Promise<(TaskPersonCell & { userActive: boolean })[]> {
  const rows = await prisma.$queryRaw<{ tid: string; tname: string; uid: string; fn: string; ln: string; active: boolean; mins: number; bmins: number; bc: number }[]>`
    SELECT te."taskId" AS tid, t.name AS tname, te."userId" AS uid, u."firstName" AS fn, u."lastName" AS ln, u."isActive" AS active,
      COALESCE(SUM(te.minutes),0)::int AS mins,
      COALESCE(SUM(CASE WHEN te."isBillable" THEN te.minutes ELSE 0 END),0)::int AS bmins,
      COALESCE(SUM(CASE WHEN te."isBillable" THEN te.minutes/60.0*COALESCE(te."billableRateCents",0) ELSE 0 END),0)::float8 AS bc
    FROM "TimeEntry" te JOIN "Task" t ON t.id = te."taskId" JOIN "User" u ON u.id = te."userId"
    WHERE te."accountId" = ${accountId} AND te."projectId" = ${projectId} ${rangeSql(tf, 'te."spentDate"')}
    GROUP BY te."taskId", t.name, te."userId", u."firstName", u."lastName", u."isActive"
    ORDER BY mins DESC`
  return rows.map((r) => ({
    taskId: r.tid, taskName: r.tname, userId: r.uid, userName: `${r.fn} ${r.ln}`.trim(), userActive: r.active,
    minutes: num(r.mins), billableMinutes: num(r.bmins), billableCents: Math.round(num(r.bc)),
  }))
}

type TabCommon = {
  project: ProjectWithAssignments
  accountId: string
  tf: Timeframe
  showCosts: boolean
  sort: SortState<BreakdownSortKey>
  basePath: string
  sortBase: Record<string, string | undefined>
  now: Date
  toolbarActions: React.ReactNode
  keep: Record<string, string | undefined>
}

/* ---------- Tasks tab: Billable / Non-billable tasks for the selected timeframe ---------- */
async function TasksTab({
  project, accountId, tf, showCosts, canManage, ratesMissing, sort, basePath, sortBase, now, toolbarActions, keep, editHref,
}: TabCommon & { canManage: boolean; ratesMissing: boolean; editHref: string }) {
  const cells = await taskPersonCells(accountId, project.id, tf)
  const managers = new Set(project.userAssignments.filter((a) => a.isProjectManager).map((a) => a.userId))
  const assignment = new Map(project.taskAssignments.map((t) => [t.taskId, t]))

  const tracked = rollup(cells, 'task')
  const trackedIds = new Set(tracked.map((t) => t.id))
  // Tasks assigned to the project but with no time in the timeframe still show (0.00), like Harvest.
  const idle = project.taskAssignments
    .filter((t) => t.isActive && !trackedIds.has(t.taskId))
    .map((t) => ({ id: t.taskId, name: t.task.name, minutes: 0, billableMinutes: 0, billableCents: 0, children: [] }))

  const billable: BreakdownRow[] = []
  const nonBillable: BreakdownRow[] = []
  for (const t of [...tracked, ...idle]) {
    const isBillable = isBillableTask(project.projectType, assignment.get(t.id)?.billable, t.billableMinutes)
    const row: BreakdownRow = {
      id: t.id, name: t.name, minutes: t.minutes, billableCents: t.billableCents, costCents: 0,
      rateWarning: ratesMissing && isBillable && t.billableMinutes > 0 && t.billableCents === 0,
      children: sortRows<BreakdownChild, BreakdownSortKey>(
        t.children.map((c) => ({ id: c.id, name: c.name, minutes: c.minutes, billableCents: c.billableCents, costCents: 0, pills: managers.has(c.id) ? ['Manager'] : [] })),
        sort, BY_COL,
      ),
    }
    ;(isBillable ? billable : nonBillable).push(row)
  }
  // Pre-sort by name so ties in the selected column read alphabetically.
  const order = (rows: BreakdownRow[]) => sortRows<BreakdownRow, BreakdownSortKey>([...rows].sort((a, b) => a.name.localeCompare(b.name)), sort, BY_COL)

  return (
    <div>
      <ProjectTimeframeToolbar basePath={basePath} tf={tf} keep={keep} actions={toolbarActions} now={now} />
      <ProjectTaskBreakdown
        sections={[{ title: 'Billable tasks', rows: order(billable) }, { title: 'Non-billable tasks', rows: order(nonBillable) }]}
        showCosts={showCosts} sort={sort} basePath={basePath} query={sortBase}
        emptyText="No tasks on this project yet."
        fixRatesHref={canManage ? editHref : undefined}
      />
      {canManage && <TaskManagement project={project} accountId={accountId} />}
    </div>
  )
}

/* ---------- Team tab: time per person (editing lives on the Edit page) ---------- */
async function TeamTab({ project, accountId, tf, showCosts, sort, basePath, sortBase, now, toolbarActions, keep }: TabCommon) {
  const cells = await taskPersonCells(accountId, project.id, tf)
  const activeByUser = new Map(cells.map((c) => [c.userId, c.userActive]))
  const tracked = rollup(cells, 'person')
  const byId = new Map(tracked.map((p) => [p.id, p]))

  // Everyone currently assigned (even with no time yet) plus anyone who tracked time in the timeframe.
  const rows: BreakdownRow[] = []
  const seen = new Set<string>()
  const toRow = (id: string, name: string, isPm: boolean, active: boolean): BreakdownRow => {
    const t = byId.get(id)
    return {
      id, name, avatar: initials(name),
      minutes: t?.minutes ?? 0, billableCents: t?.billableCents ?? 0, costCents: 0,
      pills: [...(isPm ? ['Manager'] : []), ...(active ? [] : ['Archived'])],
      children: sortRows<BreakdownChild, BreakdownSortKey>(
        (t?.children ?? []).map((c) => ({ id: c.id, name: c.name, minutes: c.minutes, billableCents: c.billableCents, costCents: 0 })),
        sort, BY_COL,
      ),
    }
  }
  for (const a of project.userAssignments) {
    seen.add(a.user.id)
    rows.push(toRow(a.user.id, `${a.user.firstName} ${a.user.lastName}`.trim(), a.isProjectManager, a.user.isActive))
  }
  for (const p of tracked) if (!seen.has(p.id)) rows.push(toRow(p.id, p.name, false, activeByUser.get(p.id) ?? true))

  const list = sortRows<BreakdownRow, BreakdownSortKey>(rows.sort((a, b) => a.name.localeCompare(b.name)), sort, BY_COL)

  return (
    <div>
      <ProjectTimeframeToolbar basePath={basePath} tf={tf} keep={keep} actions={toolbarActions} now={now} />
      <ProjectTaskBreakdown
        sections={[{ title: 'Team', rows: list }]}
        showCosts={showCosts} sort={sort} basePath={basePath} query={sortBase}
        emptyText="No one assigned and no time tracked in this timeframe."
      />
    </div>
  )
}

/* ---------- Task management (under Tasks tab, admins) ---------- */
async function TaskManagement({ project, accountId }: { project: ProjectWithAssignments; accountId: string }) {
  const dollars = (c: number | null) => (c ? (c / 100).toFixed(2) : '')
  const perTaskRates = project.billableRateMethod === 'task'
  const assignedTaskIds = new Set(project.taskAssignments.map((t) => t.taskId))
  const addableTasks = (await prisma.task.findMany({ where: { accountId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } })).filter((t) => !assignedTaskIds.has(t.id))
  return (
    <div className="mt-6">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Manage tasks on this project</h3>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <ul className="divide-y divide-gray-100 text-sm">
          {project.taskAssignments.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2">
              <span className="flex-1 text-gray-800">{t.task.name}</span>
              <form action={toggleProjectTaskBillableAction}>
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="taskId" value={t.taskId} />
                <button className={`rounded px-2 py-0.5 text-xs font-medium ${t.billable ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{t.billable ? 'Billable' : 'Non-billable'}</button>
              </form>
              {perTaskRates && (
                <form action={setProjectTaskRateAction} className="flex items-center gap-1">
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="taskId" value={t.taskId} />
                  <span className="text-xs text-gray-400">$</span>
                  <input name="rate" defaultValue={dollars(t.hourlyRateCents)} placeholder="rate/h" className="w-20 rounded border border-gray-300 px-1.5 py-1 text-xs" />
                  <button className="text-xs text-brand-teal hover:underline">save</button>
                </form>
              )}
              <form action={removeTaskFromProjectAction}>
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="taskId" value={t.taskId} />
                <button className="text-xs text-gray-400 hover:text-red-600">Remove</button>
              </form>
            </li>
          ))}
          {project.taskAssignments.length === 0 && <li className="px-4 py-3 text-gray-400">No tasks on this project yet.</li>}
        </ul>
        {addableTasks.length > 0 && (
          <form action={addTaskToProjectAction} className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3">
            <input type="hidden" name="projectId" value={project.id} />
            <select name="taskId" className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              {addableTasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Add task</button>
          </form>
        )}
      </div>
    </div>
  )
}

/* ---------- Invoices tab ---------- */
async function InvoicesTab({
  pid, clientId, accountId, tf, basePath, now, canInvoice, keep,
}: {
  pid: string; clientId: string; accountId: string; tf: Timeframe; basePath: string; now: Date; canInvoice: boolean; keep: Record<string, string | undefined>
}) {
  // Invoices are dated by issue date; drafts (no issue date yet) fall back to when they were created.
  const end = endExclusive(tf) // createdAt is a timestamp, so compare against the day after `till`
  const range = { ...(tf.from ? { gte: tf.from } : {}), ...(end ? { lt: end } : {}) }
  const bounded = Boolean(tf.from || tf.till)
  const [invoices, modules] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        accountId,
        lineItems: { some: { linkedProjectId: pid } },
        ...(bounded ? { OR: [{ issueDate: range }, { issueDate: null, createdAt: range }] } : {}),
      },
      select: {
        id: true, number: true, status: true, issueDate: true, dueDate: true, sentAt: true, subject: true,
        subtotalCents: true, discountCents: true, totalCents: true, paidCents: true, currency: true,
      },
      orderBy: [{ issueDate: { sort: 'desc', nulls: 'first' } }],
      take: 100,
    }),
    getModules(accountId),
  ])
  // "Paid on" = the latest payment date of a paid invoice (one grouped query for the listed invoices).
  const paidIds = invoices.filter((i) => i.status === 'paid').map((i) => i.id)
  const paidOn = paidIds.length
    ? new Map(
        (await prisma.payment.groupBy({ by: ['invoiceId'], where: { accountId, invoiceId: { in: paidIds } }, _max: { paidOn: true } }))
          .map((r) => [r.invoiceId, r._max.paidOn]),
      )
    : new Map<string, Date | null>()

  const newInvoice = canInvoice && modules.invoices && (
    <form action={createBlankInvoiceAction}>
      <input type="hidden" name="clientId" value={clientId} />
      <button className="rounded bg-brand-green px-3 py-1 text-sm font-medium text-white hover:opacity-90">+ New invoice</button>
    </form>
  )

  return (
    <div>
      <ProjectTimeframeToolbar basePath={basePath} tf={tf} keep={keep} actions={newInvoice || null} now={now} />
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Issue date</th>
              <th className="px-4 py-3 font-medium">Paid on</th>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Subject</th>
              <th className="px-4 py-3 text-right font-medium">Pre-tax amount</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => {
              const badge = displayBadge({ status: i.status as StoredStatus, sentAt: i.sentAt, dueDate: i.dueDate, totalCents: i.totalCents, paidCents: i.paidCents }, now)
              return (
                <tr key={i.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3"><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_STYLES[badge]}`}>{BADGE_LABEL[badge]}</span></td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(i.issueDate)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(paidOn.get(i.id) ?? null)}</td>
                  <td className="px-4 py-3"><Link href={`/invoices/${i.id}`} className="text-brand-teal hover:underline">{i.number ?? 'Draft'}</Link></td>
                  <td className="px-4 py-3 text-gray-700">{i.subject || <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatCents(preTaxCents(i), i.currency)}</td>
                </tr>
              )
            })}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  {bounded ? `No invoices for this project in ${tf.label}.` : 'No invoices include this project yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ---------- small presentational helpers ---------- */
function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium text-gray-500">{title}</div>
      {children}
      {note && <div className="mt-1.5 text-[11px] text-gray-400">{note}</div>}
    </div>
  )
}
function Big({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`mt-0.5 text-2xl font-semibold tabular-nums ${className ?? 'text-gray-900'}`}>{children}</div>
}
function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-0.5 flex justify-between text-xs">
      <span className="text-gray-400">{label}</span>
      <span className="tabular-nums text-gray-600">{value}</span>
    </div>
  )
}
