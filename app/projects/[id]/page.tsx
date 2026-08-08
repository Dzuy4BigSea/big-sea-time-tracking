import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { formatCents, formatDate } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { ProjectTaskBreakdown, type TaskRow } from '@/components/ProjectTaskBreakdown'
import { ColumnChart } from '@/components/ColumnChart'
import {
  assignUserToProjectAction,
  toggleProjectManagerAction,
  unassignUserFromProjectAction,
  setProjectUserRateAction,
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

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { tab?: string; month?: string; year?: string }
}) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  const canManage = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_projects')

  const project = await prisma.project.findFirst({
    where: { id: params.id, accountId },
    include: {
      client: true,
      userAssignments: { where: { isActive: true }, include: { user: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { user: { firstName: 'asc' } } },
      taskAssignments: { include: { task: { select: { id: true, name: true, defaultHourlyRateCents: true } } }, orderBy: { task: { name: 'asc' } } },
    },
  })
  if (!project) notFound()
  const pid = project.id

  const now = new Date()
  const tab = ['tasks', 'team', 'invoices'].includes(searchParams.tab ?? '') ? searchParams.tab! : 'tasks'
  const chartYear = Number(searchParams.year) || now.getUTCFullYear()
  // Selected month for the breakdown (YYYY-MM); default current month.
  const mMatch = /^(\d{4})-(\d{2})$/.exec(searchParams.month ?? '')
  const selY = mMatch ? Number(mMatch[1]) : now.getUTCFullYear()
  const selM = mMatch ? Number(mMatch[2]) - 1 : now.getUTCMonth()
  const monthStart = new Date(Date.UTC(selY, selM, 1))
  const monthEnd = new Date(Date.UTC(selY, selM + 1, 1))
  const yStart = new Date(Date.UTC(chartYear, 0, 1))
  const yEnd = new Date(Date.UTC(chartYear + 1, 0, 1))

  const w = Prisma.sql`"accountId" = ${accountId} AND "projectId" = ${pid}`

  // Aggregates (DB-side — never load raw entries; a real project has thousands).
  const [chart, monthSplit, invoicedRow, uninvoicedRow, expenseRow, costRateCount] = await Promise.all([
    prisma.$queryRaw<{ m: number; mins: number }[]>`
      SELECT EXTRACT(MONTH FROM "spentDate")::int AS m, COALESCE(SUM(minutes),0)::int AS mins
      FROM "TimeEntry" WHERE ${w} AND "spentDate" >= ${yStart} AND "spentDate" < ${yEnd} GROUP BY 1`,
    prisma.$queryRaw<{ billable: boolean; mins: number }[]>`
      SELECT "isBillable" AS billable, COALESCE(SUM(minutes),0)::int AS mins
      FROM "TimeEntry" WHERE ${w} AND "spentDate" >= ${monthStart} AND "spentDate" < ${monthEnd} GROUP BY 1`,
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
  const billableMin = monthSplit.find((r) => r.billable)?.mins ?? 0
  const nonBillableMin = monthSplit.find((r) => !r.billable)?.mins ?? 0
  const monthMin = billableMin + nonBillableMin
  const invoicedCents = num(invoicedRow[0]?.c)
  const uninvoicedCents = Math.round(num(uninvoicedRow[0]?.c))
  const expenseCents = expenseRow._sum.totalCents ?? 0

  // Budget: monthly (resets) vs all-time; hours or fee.
  const budgetHoursMin = project.budgetMethod.startsWith('hours') && project.budgetValue ? project.budgetValue : null
  const monthlyBudget = project.budgetResetsMonthly && budgetHoursMin ? budgetHoursMin : null
  const budgetUsedMin = monthlyBudget ? monthMin : null
  const budgetRemainMin = monthlyBudget ? monthlyBudget - monthMin : null
  const budgetPct = monthlyBudget ? Math.min(100, Math.round((monthMin / monthlyBudget) * 100)) : null

  const chartMap = new Map(chart.map((r) => [r.m, r.mins]))
  const months = MONTHS.map((_, i) => chartMap.get(i + 1) ?? 0)

  const monthLabel = `${MONTHS[selM]} ${selY}`
  const qp = (over: Record<string, string>) => {
    const p = new URLSearchParams({ tab, month: `${selY}-${String(selM + 1).padStart(2, '0')}`, year: String(chartYear), ...over })
    return `/projects/${pid}?${p.toString()}`
  }
  const prevMonth = new Date(Date.UTC(selY, selM - 1, 1))
  const nextMonth = new Date(Date.UTC(selY, selM + 1, 1))
  const mParam = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

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

      {/* Monthly hours chart */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-3">
          <Link href={qp({ year: String(chartYear - 1) })} className="rounded border border-gray-300 px-2 text-sm text-gray-600 hover:bg-gray-50">←</Link>
          <Link href={qp({ year: String(chartYear + 1) })} className="rounded border border-gray-300 px-2 text-sm text-gray-600 hover:bg-gray-50">→</Link>
          <h2 className="text-sm font-semibold text-gray-700">Hours tracked — {chartYear}</h2>
        </div>
        <ColumnChart
          format={(v) => `${Math.round(v / 60)}h`}
          bars={months.map((mins, i) => {
            const isCurrent = chartYear === now.getUTCFullYear() && i === now.getUTCMonth()
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
        <Card period={monthLabel}>
          <Big>{hrs(monthMin)}</Big>
          <Line label="Billable" value={`${hrs(billableMin)}`} />
          <Line label="Non-billable" value={`${hrs(nonBillableMin)}`} />
        </Card>
        <Card period={monthLabel}>
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

      {tab === 'tasks' && <TasksTab pid={pid} accountId={accountId} monthStart={monthStart} monthEnd={monthEnd} monthLabel={monthLabel} showCosts={showCosts} prevHref={qp({ month: mParam(prevMonth) })} nextHref={qp({ month: mParam(nextMonth) })} exportHref={`/projects/${pid}/tasks/export?month=${selY}-${String(selM + 1).padStart(2, '0')}`} canManage={canManage} project={project} />}
      {tab === 'team' && <TeamTab project={project} canManage={canManage} accountId={accountId} />}
      {tab === 'invoices' && <InvoicesTab pid={pid} accountId={accountId} />}
    </div>
  )
}

/* ---------- Tasks tab: month-nav'd billable-tasks breakdown ---------- */
async function TasksTab({
  pid, accountId, monthStart, monthEnd, monthLabel, showCosts, prevHref, nextHref, exportHref, canManage, project,
}: any) {
  const w = Prisma.sql`te."accountId" = ${accountId} AND te."projectId" = ${pid} AND te."spentDate" >= ${monthStart} AND te."spentDate" < ${monthEnd}`
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
        <Link href={prevHref} className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50">←</Link>
        <Link href={nextHref} className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50">→</Link>
        <h2 className="text-base font-semibold">{monthLabel}</h2>
        <a href={exportHref} className="ml-auto text-sm text-brand-teal hover:underline">Export CSV</a>
      </div>
      <ProjectTaskBreakdown tasks={tasks} showCosts={showCosts} />
      {canManage && <TaskManagement project={project} accountId={accountId} />}
    </div>
  )
}

/* ---------- Team tab (assignment management) ---------- */
async function TeamTab({ project, canManage, accountId }: any) {
  const dollars = (c: number | null) => (c ? (c / 100).toFixed(2) : '')
  const perPersonRates = project.billableRateMethod === 'person'
  const assignedIds = new Set(project.userAssignments.map((a: any) => a.userId))
  const addableUsers = canManage
    ? (await prisma.user.findMany({ where: { accountId, isActive: true, archivedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ firstName: 'asc' }] })).filter((u) => !assignedIds.has(u.id))
    : []

  if (!canManage) {
    return (
      <div className="flex flex-wrap gap-2">
        {project.userAssignments.map((a: any) => (
          <span key={a.id} className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
            {a.user.firstName} {a.user.lastName}{a.isProjectManager && <span className="ml-1 text-xs text-brand-teal">PM</span>}
          </span>
        ))}
        {project.userAssignments.length === 0 && <span className="text-sm text-gray-400">No one assigned yet.</span>}
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <ul className="divide-y divide-gray-100 text-sm">
        {project.userAssignments.map((a: any) => (
          <li key={a.id} className="flex items-center gap-3 px-4 py-2">
            <span className="flex-1 font-medium text-gray-800">
              {a.user.firstName} {a.user.lastName}
              {a.isProjectManager && <span className="ml-2 rounded-full bg-brand-teal-50 px-2 py-0.5 text-xs font-medium text-brand-teal">PM</span>}
            </span>
            {perPersonRates && (
              <form action={setProjectUserRateAction} className="flex items-center gap-1">
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="userId" value={a.user.id} />
                <span className="text-xs text-gray-400">$</span>
                <input name="rate" defaultValue={dollars(a.hourlyRateCents)} placeholder="rate/h" className="w-20 rounded border border-gray-300 px-1.5 py-1 text-xs" />
                <button className="text-xs text-brand-teal hover:underline">save</button>
              </form>
            )}
            <form action={toggleProjectManagerAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="userId" value={a.user.id} />
              <button className="text-xs text-gray-500 hover:text-brand-teal">{a.isProjectManager ? 'Remove PM' : 'Make PM'}</button>
            </form>
            <form action={unassignUserFromProjectAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="userId" value={a.user.id} />
              <button className="text-xs text-gray-400 hover:text-red-600">Remove</button>
            </form>
          </li>
        ))}
        {project.userAssignments.length === 0 && <li className="px-4 py-3 text-gray-400">No one assigned yet.</li>}
      </ul>
      {addableUsers.length > 0 && (
        <form action={assignUserToProjectAction} className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3">
          <input type="hidden" name="projectId" value={project.id} />
          <select name="userId" className="rounded border border-gray-300 px-2 py-1.5 text-sm">
            {addableUsers.map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-gray-600"><input type="checkbox" name="isProjectManager" /> Project manager</label>
          <button className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Add to project</button>
        </form>
      )}
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
async function InvoicesTab({ pid, accountId }: { pid: string; accountId: string }) {
  const invoices = await prisma.invoice.findMany({
    where: { accountId, lineItems: { some: { linkedProjectId: pid } } },
    select: { id: true, number: true, status: true, issueDate: true, totalCents: true, paidCents: true, currency: true },
    orderBy: [{ issueDate: { sort: 'desc', nulls: 'first' } }],
    take: 100,
  })
  if (invoices.length === 0) return <p className="text-sm text-gray-400">No invoices include this project yet.</p>
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
