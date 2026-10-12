import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { formatCents, formatDate } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import {
  PERIODS, defaultPeriodFor, resolveTimeframe, shiftAnchor, timeframeLabel, timeframeQuery, customSeed, ymd,
  type Period, type Timeframe, type WeekStart,
} from '@/modules/projects/timeframe'
import { ProjectTaskBreakdown, type TaskRow } from '@/components/ProjectTaskBreakdown'
import { ColumnChart } from '@/components/ColumnChart'
import {
  addTaskToProjectAction,
  removeTaskFromProjectAction,
  toggleProjectTaskBillableAction,
  setProjectTaskRateAction,
  setProjectArchivedAction,
} from '@/app/projects/actions'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = {
  time_and_materials: 'Time & Materials',
  fixed_fee: 'Fixed Fee',
  non_billable: 'Non-Billable',
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const hrs = (m: number) => (m / 60).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (v: unknown) => Number(v ?? 0)

/** `AND col >= start AND col < end` for the bounded side(s) of a timeframe (empty for All time). */
function rangeSql(tf: Timeframe, col: string): Prisma.Sql {
  const c = Prisma.raw(col)
  const parts: Prisma.Sql[] = []
  if (tf.start) parts.push(Prisma.sql`AND ${c} >= ${tf.start}`)
  if (tf.end) parts.push(Prisma.sql`AND ${c} < ${tf.end}`)
  return parts.length ? Prisma.join(parts, ' ') : Prisma.empty
}

type SearchParams = { tab?: string; period?: string; date?: string; from?: string; to?: string; month?: string; year?: string; cy?: string }

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: SearchParams
}) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  const canManage = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_projects')

  const [project, account] = await Promise.all([
    prisma.project.findFirst({
      where: { id: params.id, accountId },
      include: {
        client: true,
        userAssignments: { where: { isActive: true }, include: { user: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { user: { firstName: 'asc' } } },
        taskAssignments: { include: { task: { select: { id: true, name: true, defaultHourlyRateCents: true } } }, orderBy: { task: { name: 'asc' } } },
      },
    }),
    prisma.account.findUnique({ where: { id: accountId }, select: { weekStartsOn: true } }),
  ])
  if (!project) notFound()
  const pid = project.id

  const now = new Date()
  const tab = ['tasks', 'team', 'invoices'].includes(searchParams.tab ?? '') ? searchParams.tab! : 'tasks'
  const weekStartsOn = (account?.weekStartsOn ?? 'monday') as WeekStart
  // Timeframe for the whole page (hours card + every tab). Default: Month for monthly-reset budgets,
  // otherwise All time (modules/projects/timeframe.ts → defaultPeriodFor). Legacy ?month= links map to Month.
  const tf = resolveTimeframe(searchParams, { now, weekStartsOn, defaultPeriod: defaultPeriodFor(project) })
  const tfLabel = timeframeLabel(tf)
  // The hours chart is always a calendar year: the timeframe's year unless navigated (?cy=).
  const cyParam = /^\d{4}$/.test(searchParams.cy ?? '') ? Number(searchParams.cy) : null
  const chartYear = cyParam ?? (tf.start ? tf.start.getUTCFullYear() : now.getUTCFullYear())
  const yStart = new Date(Date.UTC(chartYear, 0, 1))
  const yEnd = new Date(Date.UTC(chartYear + 1, 0, 1))

  // Monthly budgets are measured against a calendar month: the selected one, else the current one.
  const budgetHoursMin = project.budgetMethod.startsWith('hours') && project.budgetValue ? project.budgetValue : null
  const monthlyBudget = project.budgetResetsMonthly && budgetHoursMin ? budgetHoursMin : null
  const bAnchor = tf.period === 'month' && tf.start ? tf.start : now
  const bStart = new Date(Date.UTC(bAnchor.getUTCFullYear(), bAnchor.getUTCMonth(), 1))
  const bEnd = new Date(Date.UTC(bAnchor.getUTCFullYear(), bAnchor.getUTCMonth() + 1, 1))

  const w = Prisma.sql`"accountId" = ${accountId} AND "projectId" = ${pid}`

  // Aggregates (DB-side — never load raw entries; a real project has thousands).
  const [chart, periodSplit, budgetRow, invoicedRow, uninvoicedRow, expenseRow, costRateCount] = await Promise.all([
    prisma.$queryRaw<{ m: number; mins: number }[]>`
      SELECT EXTRACT(MONTH FROM "spentDate")::int AS m, COALESCE(SUM(minutes),0)::int AS mins
      FROM "TimeEntry" WHERE ${w} AND "spentDate" >= ${yStart} AND "spentDate" < ${yEnd} GROUP BY 1`,
    prisma.$queryRaw<{ billable: boolean; mins: number }[]>`
      SELECT "isBillable" AS billable, COALESCE(SUM(minutes),0)::int AS mins
      FROM "TimeEntry" WHERE ${w} ${rangeSql(tf, '"spentDate"')} GROUP BY 1`,
    monthlyBudget
      ? prisma.$queryRaw<{ mins: number }[]>`
          SELECT COALESCE(SUM(minutes),0)::int AS mins
          FROM "TimeEntry" WHERE ${w} AND "spentDate" >= ${bStart} AND "spentDate" < ${bEnd}`
      : Promise.resolve([] as { mins: number }[]),
    prisma.$queryRaw<{ c: bigint }[]>`
      SELECT COALESCE(SUM(li."amountCents"),0)::bigint AS c
      FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
      WHERE li."accountId" = ${accountId} AND li."linkedProjectId" = ${pid} AND i.status <> 'draft'`,
    prisma.$queryRaw<{ c: number }[]>`
      SELECT COALESCE(SUM(CASE WHEN "isBillable" AND "invoiceLineItemId" IS NULL AND "lockState" <> 'invoiced'
        THEN minutes/60.0 * COALESCE("billableRateCents",0) ELSE 0 END),0)::float8 AS c
      FROM "TimeEntry" WHERE ${w}`,
    prisma.expense.aggregate({ where: { accountId, projectId: pid }, _sum: { totalCents: true } }),
    prisma.personCostRate.count({ where: { accountId } }),
  ])

  const showCosts = costRateCount > 0 // cost rates aren't migrated from Harvest → hide the empty column
  const billableMin = periodSplit.find((r) => r.billable)?.mins ?? 0
  const nonBillableMin = periodSplit.find((r) => !r.billable)?.mins ?? 0
  const periodMin = billableMin + nonBillableMin
  const invoicedCents = num(invoicedRow[0]?.c)
  const uninvoicedCents = Math.round(num(uninvoicedRow[0]?.c))
  const expenseCents = expenseRow._sum.totalCents ?? 0

  // Budget: monthly (resets) vs all-time; hours or fee.
  const budgetMonthMin = num(budgetRow[0]?.mins)
  const budgetRemainMin = monthlyBudget ? monthlyBudget - budgetMonthMin : null
  const budgetPct = monthlyBudget ? Math.min(100, Math.round((budgetMonthMin / monthlyBudget) * 100)) : null
  const budgetMonthLabel = `${MONTHS[bStart.getUTCMonth()]} ${bStart.getUTCFullYear()}`

  const chartMap = new Map(chart.map((r) => [r.m, r.mins]))
  const months = MONTHS.map((_, i) => chartMap.get(i + 1) ?? 0)
  // Highlight the chart months that overlap the selected timeframe (the current month for All time).
  const inTimeframe = (i: number) => {
    if (!tf.start && !tf.end) return chartYear === now.getUTCFullYear() && i === now.getUTCMonth()
    const ms = new Date(Date.UTC(chartYear, i, 1))
    const me = new Date(Date.UTC(chartYear, i + 1, 1))
    return (!tf.end || ms < tf.end) && (!tf.start || me > tf.start)
  }

  const tfQuery = timeframeQuery(tf)
  const qp = (over: Record<string, string | undefined>) => {
    const base: Record<string, string | undefined> = { tab, ...tfQuery, cy: cyParam ? String(cyParam) : undefined, ...over }
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(base)) if (v !== undefined) p.set(k, v)
    return `/projects/${pid}?${p.toString()}`
  }
  // Switching period keeps the current anchor (e.g. Oct 2026 → Q4 2026); Custom seeds from/to.
  const periodHref = (key: Period) => {
    const reset = { period: key, date: undefined, from: undefined, to: undefined, cy: undefined }
    if (key === 'all') return qp(reset)
    if (key === 'custom') return qp({ ...reset, ...customSeed(tf, now) })
    return qp({ ...reset, date: tf.start ? ymd(tf.start) : ymd(now) })
  }
  const prevAnchor = shiftAnchor(tf, -1, weekStartsOn)
  const nextAnchor = shiftAnchor(tf, 1, weekStartsOn)
  const exportHref = `/projects/${pid}/tasks/export?${new URLSearchParams(tfQuery).toString()}`
  const seed = customSeed(tf, now)

  return (
    <div>
      <Link href="/projects" className="text-sm text-gray-500 hover:text-brand-teal">← Back to Projects</Link>

      <div className="mb-1 mt-2 text-xs text-gray-400">{project.client.name}</div>
      <div className="mb-5 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{project.code ? `[${project.code}] ` : ''}{project.name}</h1>
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">{TYPE_LABEL[project.projectType] ?? project.projectType}</span>
        {!project.isActive && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Archived</span>}
        {canManage && (
          <div className="ml-auto flex items-center gap-2">
            <Link href={`/projects/${pid}/edit`} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50">Edit project</Link>
            <form action={setProjectArchivedAction}>
              <input type="hidden" name="projectId" value={pid} />
              <input type="hidden" name="archived" value={project.isActive ? 'on' : 'off'} />
              <button className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50">{project.isActive ? 'Archive' : 'Restore'}</button>
            </form>
          </div>
        )}
      </div>

      {/* Timeframe selector: applies to the hours card and every tab below */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded border border-gray-300 text-sm">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={periodHref(p.key)}
              className={`border-l border-gray-300 px-3 py-1 first:border-l-0 ${tf.period === p.key ? 'bg-brand-teal font-medium text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {p.label}
            </Link>
          ))}
        </div>
        {prevAnchor && nextAnchor && (
          <div className="flex items-center gap-1">
            <Link href={qp({ date: prevAnchor, cy: undefined })} aria-label="Previous period" className="rounded border border-gray-300 px-2 py-0.5 text-sm text-gray-600 hover:bg-gray-50">←</Link>
            <Link href={qp({ date: nextAnchor, cy: undefined })} aria-label="Next period" className="rounded border border-gray-300 px-2 py-0.5 text-sm text-gray-600 hover:bg-gray-50">→</Link>
          </div>
        )}
        {tf.period === 'custom' ? (
          <form method="get" action={`/projects/${pid}`} className="flex flex-wrap items-center gap-2 text-sm">
            <input type="hidden" name="tab" value={tab} />
            <input type="hidden" name="period" value="custom" />
            <input type="date" name="from" defaultValue={seed.from} aria-label="From" className="rounded border border-gray-300 px-2 py-1 text-sm" />
            <span className="text-gray-400">to</span>
            <input type="date" name="to" defaultValue={seed.to} aria-label="To" className="rounded border border-gray-300 px-2 py-1 text-sm" />
            <button className="rounded bg-brand-green px-3 py-1 text-sm font-medium text-white hover:opacity-90">Apply</button>
          </form>
        ) : (
          <h2 className="text-base font-semibold text-gray-800">{tfLabel}</h2>
        )}
      </div>

      {/* Monthly hours chart */}
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

      {/* Stat cards */}
      <div className="mb-6 grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Card period={tfLabel}>
          <Big>{hrs(periodMin)}</Big>
          <Line label="Billable" value={`${hrs(billableMin)}`} />
          <Line label="Non-billable" value={`${hrs(nonBillableMin)}`} />
        </Card>
        <Card period={monthlyBudget ? budgetMonthLabel : 'All time'}>
          {monthlyBudget ? (
            <>
              <div className="text-xs text-gray-500">Budget remaining ({Math.max(0, 100 - (budgetPct ?? 0))}%)</div>
              <Big>{hrs(Math.max(0, budgetRemainMin ?? 0))}</Big>
              <Line label="Monthly budget" value={hrs(monthlyBudget)} />
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-brand-teal" style={{ width: `${budgetPct}%` }} />
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-gray-500">Budget</div>
              <Big>{budgetHoursMin ? `${hrs(budgetHoursMin)}h` : project.projectFeesCents ? formatCents(project.projectFeesCents) : '—'}</Big>
              <div className="mt-1 text-xs text-gray-400">{project.budgetResetsMonthly ? 'Monthly' : 'Total'}{budgetHoursMin ? ' hours' : ''}</div>
            </>
          )}
        </Card>
        <Card period="All time">
          <div className="text-xs text-gray-500">Internal costs</div>
          <Big>{formatCents((showCosts ? 0 : 0) + expenseCents)}</Big>
          <Line label="Time" value={showCosts ? formatCents(0) : '—'} />
          <Line label="Expenses" value={formatCents(expenseCents)} />
        </Card>
        <Card period="All time">
          <div className="text-xs text-gray-500">Invoiced amount</div>
          <Big>{formatCents(invoicedCents)}</Big>
        </Card>
        <Card period="All time">
          <div className="text-xs text-gray-500">Uninvoiced amount</div>
          {uninvoicedCents > 0 ? (
            <Big className="text-brand-green">{formatCents(uninvoicedCents)}</Big>
          ) : (
            <>
              <Big>{formatCents(0)}</Big>
              <Link href={`/projects/${pid}/edit`} className="text-xs text-brand-teal hover:underline">Set billable rates</Link>
            </>
          )}
        </Card>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex gap-6 border-b border-gray-200 text-sm">
        {[{ k: 'tasks', l: 'Tasks' }, { k: 'team', l: 'Team' }, { k: 'invoices', l: 'Invoices' }].map((t) => (
          <Link key={t.k} href={qp({ tab: t.k })} className={`-mb-px border-b-2 pb-2 ${tab === t.k ? 'border-brand-teal font-medium text-brand-teal' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {t.l}
          </Link>
        ))}
      </div>

      {tab === 'tasks' && <TasksTab pid={pid} accountId={accountId} tf={tf} tfLabel={tfLabel} showCosts={showCosts} exportHref={exportHref} canManage={canManage} project={project} />}
      {tab === 'team' && <TeamTab project={project} canManage={canManage} accountId={accountId} tf={tf} tfLabel={tfLabel} />}
      {tab === 'invoices' && <InvoicesTab pid={pid} accountId={accountId} tf={tf} tfLabel={tfLabel} />}
    </div>
  )
}

/* ---------- Tasks tab: billable-tasks breakdown for the selected timeframe ---------- */
async function TasksTab({
  pid, accountId, tf, tfLabel, showCosts, exportHref, canManage, project,
}: any) {
  const w = Prisma.sql`te."accountId" = ${accountId} AND te."projectId" = ${pid} ${rangeSql(tf, 'te."spentDate"')}`
  const [taskRows, personRows] = await Promise.all([
    prisma.$queryRaw<{ id: string; name: string; mins: number; bc: number }[]>`
      SELECT te."taskId" AS id, t.name AS name, COALESCE(SUM(te.minutes),0)::int AS mins,
        COALESCE(SUM(CASE WHEN te."isBillable" THEN te.minutes/60.0*COALESCE(te."billableRateCents",0) ELSE 0 END),0)::float8 AS bc
      FROM "TimeEntry" te JOIN "Task" t ON t.id = te."taskId" WHERE ${w} GROUP BY te."taskId", t.name ORDER BY mins DESC`,
    prisma.$queryRaw<{ task_id: string; fn: string; ln: string; mins: number; bc: number }[]>`
      SELECT te."taskId" AS task_id, u."firstName" AS fn, u."lastName" AS ln, COALESCE(SUM(te.minutes),0)::int AS mins,
        COALESCE(SUM(CASE WHEN te."isBillable" THEN te.minutes/60.0*COALESCE(te."billableRateCents",0) ELSE 0 END),0)::float8 AS bc
      FROM "TimeEntry" te JOIN "User" u ON u.id = te."userId" WHERE ${w} GROUP BY te."taskId", u."firstName", u."lastName" ORDER BY mins DESC`,
  ])
  const personsByTask = new Map<string, TaskRow['persons']>()
  for (const p of personRows) {
    const arr = personsByTask.get(p.task_id) ?? []
    arr.push({ name: `${p.fn} ${p.ln}`.trim(), minutes: num(p.mins), billableCents: Math.round(num(p.bc)), costCents: 0 })
    personsByTask.set(p.task_id, arr)
  }
  const tasks: TaskRow[] = taskRows.map((t) => ({
    taskId: t.id, name: t.name, minutes: num(t.mins), billableCents: Math.round(num(t.bc)), costCents: 0,
    persons: personsByTask.get(t.id) ?? [],
  }))

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-base font-semibold">{tfLabel}</h2>
        <a href={exportHref} className="ml-auto text-sm text-brand-teal hover:underline">Export CSV</a>
      </div>
      <ProjectTaskBreakdown tasks={tasks} showCosts={showCosts} />
      {canManage && <TaskManagement project={project} accountId={accountId} />}
    </div>
  )
}

/* ---------- Team tab: read-only time tracked per person (editing lives on the Edit page) ---------- */
async function TeamTab({ project, canManage, accountId, tf, tfLabel }: any) {
  const rows = await prisma.$queryRaw<{ uid: string; fn: string; ln: string; mins: number; bmins: number; bc: number }[]>`
    SELECT te."userId" AS uid, u."firstName" AS fn, u."lastName" AS ln,
      COALESCE(SUM(te.minutes),0)::int AS mins,
      COALESCE(SUM(CASE WHEN te."isBillable" THEN te.minutes ELSE 0 END),0)::int AS bmins,
      COALESCE(SUM(CASE WHEN te."isBillable" THEN te.minutes/60.0*COALESCE(te."billableRateCents",0) ELSE 0 END),0)::float8 AS bc
    FROM "TimeEntry" te JOIN "User" u ON u.id = te."userId"
    WHERE te."accountId" = ${accountId} AND te."projectId" = ${project.id} ${rangeSql(tf, 'te."spentDate"')}
    GROUP BY te."userId", u."firstName", u."lastName"`

  // Everyone currently assigned (even with no time yet) plus anyone who tracked time in the timeframe.
  type Person = { id: string; name: string; isPm: boolean; assigned: boolean; minutes: number; billableMin: number; billableCents: number }
  const people = new Map<string, Person>()
  for (const a of project.userAssignments) {
    people.set(a.user.id, { id: a.user.id, name: `${a.user.firstName} ${a.user.lastName}`.trim(), isPm: a.isProjectManager, assigned: true, minutes: 0, billableMin: 0, billableCents: 0 })
  }
  for (const r of rows) {
    const p = people.get(r.uid) ?? { id: r.uid, name: `${r.fn} ${r.ln}`.trim(), isPm: false, assigned: false, minutes: 0, billableMin: 0, billableCents: 0 }
    p.minutes = num(r.mins)
    p.billableMin = num(r.bmins)
    p.billableCents = Math.round(num(r.bc))
    people.set(r.uid, p)
  }
  const list = Array.from(people.values()).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
  const total = list.reduce(
    (t, p) => ({ minutes: t.minutes + p.minutes, billableMin: t.billableMin + p.billableMin, billableCents: t.billableCents + p.billableCents }),
    { minutes: 0, billableMin: 0, billableCents: 0 },
  )

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-base font-semibold">{tfLabel}</h2>
        {canManage && <Link href={`/projects/${project.id}/edit#team`} className="ml-auto text-sm text-brand-teal hover:underline">Manage team</Link>}
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Person</th>
              <th className="px-4 py-3 text-right font-medium">Hours</th>
              <th className="px-4 py-3 text-right font-medium">Billable hours</th>
              <th className="px-4 py-3 text-right font-medium">Non-billable hours</th>
              <th className="px-4 py-3 text-right font-medium">Billable amount</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 text-gray-800">
                  {p.name}
                  {p.isPm && <span className="ml-2 rounded-full bg-brand-teal-50 px-2 py-0.5 text-xs font-medium text-brand-teal">PM</span>}
                  {!p.assigned && <span className="ml-2 text-xs text-gray-400">(no longer assigned)</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{hrs(p.minutes)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">{hrs(p.billableMin)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">{hrs(p.minutes - p.billableMin)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">{formatCents(p.billableCents)}</td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-3 text-gray-400">No one assigned and no time tracked in this timeframe.</td></tr>
            )}
          </tbody>
          {list.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-medium">
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{hrs(total.minutes)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{hrs(total.billableMin)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{hrs(total.minutes - total.billableMin)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCents(total.billableCents)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

/* ---------- Task management (under Tasks tab, admins) ---------- */
async function TaskManagement({ project, accountId }: any) {
  const dollars = (c: number | null) => (c ? (c / 100).toFixed(2) : '')
  const perTaskRates = project.billableRateMethod === 'task'
  const assignedTaskIds = new Set(project.taskAssignments.map((t: any) => t.taskId))
  const addableTasks = (await prisma.task.findMany({ where: { accountId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } })).filter((t) => !assignedTaskIds.has(t.id))
  return (
    <div className="mt-6">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Manage tasks on this project</h3>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <ul className="divide-y divide-gray-100 text-sm">
          {project.taskAssignments.map((t: any) => (
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
async function InvoicesTab({ pid, accountId, tf, tfLabel }: { pid: string; accountId: string; tf: Timeframe; tfLabel: string }) {
  // Invoices are dated by issue date; drafts (no issue date yet) fall back to when they were created.
  const range = { ...(tf.start ? { gte: tf.start } : {}), ...(tf.end ? { lt: tf.end } : {}) }
  const bounded = Boolean(tf.start || tf.end)
  const invoices = await prisma.invoice.findMany({
    where: {
      accountId,
      lineItems: { some: { linkedProjectId: pid } },
      ...(bounded ? { OR: [{ issueDate: range }, { issueDate: null, createdAt: range }] } : {}),
    },
    select: { id: true, number: true, status: true, issueDate: true, totalCents: true, paidCents: true, currency: true },
    orderBy: [{ issueDate: { sort: 'desc', nulls: 'first' } }],
    take: 100,
  })
  if (invoices.length === 0) {
    return <p className="text-sm text-gray-400">{bounded ? `No invoices for this project in ${tfLabel}.` : 'No invoices include this project yet.'}</p>
  }
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
            <th className="px-4 py-3 font-medium">Number</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Issued</th>
            <th className="px-4 py-3 text-right font-medium">Total</th>
            <th className="px-4 py-3 text-right font-medium">Balance</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
              <td className="px-4 py-3"><Link href={`/invoices/${i.id}`} className="text-brand-teal hover:underline">{i.number ?? 'Draft'}</Link></td>
              <td className="px-4 py-3 capitalize text-gray-600">{i.status}</td>
              <td className="px-4 py-3 text-gray-600">{formatDate(i.issueDate)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatCents(i.totalCents, i.currency)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatCents(i.totalCents - i.paidCents, i.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- small presentational helpers ---------- */
function Card({ period, children }: { period: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-1 border-b border-gray-100 pb-1 text-center text-xs text-gray-400">{period}</div>
      {children}
    </div>
  )
}
function Big({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-2xl font-semibold ${className ?? 'text-gray-900'}`}>{children}</div>
}
function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-0.5 flex justify-between text-xs">
      <span className="text-gray-400">{label}</span>
      <span className="tabular-nums text-gray-600">{value}</span>
    </div>
  )
}
