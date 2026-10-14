import 'server-only'
import { Prisma, type BillableRateMethod, type ProjectType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAccountClock } from '@/lib/accountClock'
import { todayIn } from '@/lib/tz'
import { projectManagementScoped } from '@/modules/shared/permissions'
import { effectiveRate } from '@/modules/projects/resolveRate'
import { fixedFeeStatus } from '@/modules/invoicing/fixedFee'
import { createProject, managesProject, assignUser, unassignUser, addTask, removeTask } from '@/modules/projects/projectSetup'
import { obj, str, id, ids, bool, num, int } from '@/modules/mcp/schema'
import { notFound, forbidden, invalid } from '@/modules/mcp/errors'
import { filterFingerprint, offsetFromCursor, encodeCursor } from '@/modules/mcp/cursor'
import { normalizeForSearch } from '@/modules/mcp/search'
import { amountOf, centsFromAmount, hoursOf, ymdOf } from '@/modules/mcp/format'
import { canSeeRates } from '@/modules/mcp/scope'
import { requireCap, limitOf, MAX_LIMIT, type Tool, type McpContext } from '../context'

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

const BILL_BY_OUT: Record<string, 'Project' | 'People' | 'Tasks' | 'none'> = { project: 'Project', person: 'People', task: 'Tasks', none: 'none' }
const BILL_BY_IN: Record<string, BillableRateMethod> = { Project: 'project', People: 'person', Tasks: 'task', none: 'none' }
const BUDGET_BY: Record<string, string> = {
  none: 'none',
  hours_total: 'project',
  hours_per_task: 'task',
  hours_per_person: 'person',
  fee_total: 'project_cost',
  cost_total: 'cost',
}
const PROJECT_TYPE_OUT: Record<string, string> = { time_and_materials: 'hourly', fixed_fee: 'fixed_fee', non_billable: 'non_billable' }

const PROJECT_SELECT = {
  id: true, name: true, code: true, clientId: true, isActive: true, isBillable: true, projectType: true, billableRateMethod: true,
  projectHourlyRateCents: true, projectFeesCents: true, billingCurrency: true, startsOn: true, endsOn: true, updatedAt: true,
  client: { select: { name: true, currency: true } },
} as const
type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SELECT }>

function projectRow(p: ProjectRow, ctx: McpContext) {
  const rates = canSeeRates(ctx.actor)
  return {
    id: p.id,
    name: p.name,
    client_id: p.clientId,
    client_name: p.client.name,
    code: p.code,
    is_active: p.isActive,
    is_billable: p.isBillable,
    is_fixed_fee: p.projectType === 'fixed_fee',
    project_type: PROJECT_TYPE_OUT[p.projectType],
    bill_by: p.projectType === 'time_and_materials' ? BILL_BY_OUT[p.billableRateMethod ?? 'none'] : 'none',
    billable_rate: rates ? amountOf(p.projectHourlyRateCents) : null,
    fee: rates && p.projectType === 'fixed_fee' ? amountOf(p.projectFeesCents) : null,
    billing_currency_code: p.billingCurrency ?? p.client.currency,
    starts_on: ymdOf(p.startsOn),
    ends_on: ymdOf(p.endsOn),
    updated_at: p.updatedAt.toISOString(),
  }
}

/** The project, if the caller may change its setup (manage_projects; a PM only on projects they manage). */
async function requireProjectManage(ctx: McpContext, projectId: string) {
  requireCap(ctx, 'manage_projects', 'You do not have permission to edit projects.')
  const project = await prisma.project.findFirst({ where: { id: projectId, accountId: ctx.user.accountId }, select: PROJECT_SELECT })
  if (!project) throw notFound('Project')
  if (projectManagementScoped(ctx.actor) && !(await managesProject(prisma, ctx.user.accountId, ctx.user.userId, projectId))) {
    throw forbidden('You can only edit projects you manage.')
  }
  return project
}

async function visibleProject(ctx: McpContext, projectId: string) {
  // Every signed-in user can see the project list and project pages in Track2 (app/projects).
  const p = await prisma.project.findFirst({ where: { id: projectId, accountId: ctx.user.accountId }, select: PROJECT_SELECT })
  if (!p) throw notFound('Project')
  return p
}

const cursorProp = str('Opaque pagination token. Omit on the first request; on later pages pass back the exact `next_cursor` from the prior response, with all other parameters identical.')
const limitProp = int('Page size, whole number 1–500. Omit to use the default of 100.', { minimum: 1, maximum: MAX_LIMIT })

// ---------------------------------------------------------------------------
// list_projects
// ---------------------------------------------------------------------------

async function searchProjectIds(accountId: string, search: string): Promise<string[] | null> {
  const n = normalizeForSearch(search)
  if (!n) return null
  const like = `%${n}%`
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM "Project" p JOIN "Client" c ON c.id = p."clientId"
    WHERE p."accountId" = ${accountId} AND (
      regexp_replace(lower(p.name), '[^a-z0-9]', '', 'g') LIKE ${like}
      OR regexp_replace(lower(coalesce(p.code, '')), '[^a-z0-9]', '', 'g') LIKE ${like}
      OR regexp_replace(lower(c.name), '[^a-z0-9]', '', 'g') LIKE ${like})`
  return rows.map((r) => r.id)
}

const listProjects: Tool = {
  name: 'list_projects',
  description:
    'List projects, ordered by client name then project name. Returns up to 100 per page (`limit` up to 500); `total_count` is how many match in full, so when `truncated` is true you can tell how many are missing — refine `search`, `client_ids`, or `is_active`, or pass `next_cursor` back as `cursor`. `billable_rate` / `fee` are null unless you can see billable rates.',
  inputSchema: obj({
    client_ids: ids('Filter to projects belonging to any of these client ids.'),
    is_active: bool('Filter to active (true) or archived (false) projects. Omit for all.'),
    search: str('Case-insensitive substring match on project name, code, or client name; ignores punctuation and spacing.'),
    limit: limitProp,
    cursor: cursorProp,
  }),
  write: false,
  async handler(args, ctx) {
    const { accountId } = ctx.user
    const limit = limitOf(args.limit)
    const searchIds = args.search ? await searchProjectIds(accountId, String(args.search)) : null
    const where: Prisma.ProjectWhereInput = {
      accountId,
      ...(args.is_active !== undefined ? { isActive: args.is_active as boolean } : {}),
      ...(args.client_ids ? { clientId: { in: args.client_ids as string[] } } : {}),
      ...(searchIds ? { id: { in: searchIds } } : {}),
    }
    const fp = filterFingerprint({ t: 'projects', client_ids: args.client_ids, is_active: args.is_active, search: args.search, limit })
    const offset = offsetFromCursor(args.cursor as string | undefined, fp)
    const [rows, total] = await Promise.all([
      prisma.project.findMany({ where, select: PROJECT_SELECT, orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }], skip: offset, take: limit }),
      prisma.project.count({ where }),
    ])
    const truncated = offset + rows.length < total
    return {
      projects: rows.map((p) => projectRow(p, ctx)),
      total_count: total,
      limit,
      truncated,
      next_cursor: truncated ? encodeCursor({ o: offset + limit }, fp) : null,
    }
  },
}

// ---------------------------------------------------------------------------
// get_project_budget
// ---------------------------------------------------------------------------

const getProjectBudget: Tool = {
  name: 'get_project_budget',
  description:
    'Return budget configuration and current usage for a project. `scope` states whether `hours_spent`/`money_spent` cover the `current_month` (monthly-reset budgets) or `lifetime` — read it before comparing usage to a budget (`period` carries the same value). `budget_by`: none | project (total hours) | task (hours per task) | person (hours per person) | project_cost (total fee budget) | cost (internal cost budget; usage not computed). For hours budgets `budget` is hours; for fee budgets it is money in `billing_currency_code` and follows billable-rate visibility. `money_spent_status` says why `money_spent` is null (`not_applicable`, `hidden`, `visible`). Fixed-fee projects also report `fee`, `fee_invoiced` and `fee_remaining` (rate-gated).',
  inputSchema: obj({ project_id: id('Project id.') }, ['project_id']),
  write: false,
  async handler(args, ctx) {
    const p = await visibleProject(ctx, String(args.project_id))
    const full = await prisma.project.findUniqueOrThrow({
      where: { id: p.id },
      select: { budgetMethod: true, budgetValue: true, budgetResetsMonthly: true, budgetAlertPercent: true },
    })
    const rates = canSeeRates(ctx.actor)
    const monthly = full.budgetResetsMonthly
    let from: Date | null = null
    if (monthly) {
      const today = todayIn((await getAccountClock(ctx.user.accountId)).timezone, ctx.now)
      from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    }
    const [agg] = await prisma.$queryRaw<{ minutes: number | null; bmin: number | null; bcents: number | null }[]>`
      SELECT SUM(te.minutes)::int AS minutes,
        SUM(CASE WHEN te."isBillable" THEN te.minutes ELSE 0 END)::int AS bmin,
        SUM(CASE WHEN te."isBillable" THEN te.minutes/60.0*COALESCE(te."billableRateCents",0) ELSE 0 END)::float8 AS bcents
      FROM "TimeEntry" te
      WHERE te."accountId" = ${ctx.user.accountId} AND te."projectId" = ${p.id}
        ${from ? Prisma.sql`AND te."spentDate" >= ${from}` : Prisma.empty}`
    const minutes = Number(agg?.minutes ?? 0)
    const isHours = ['hours_total', 'hours_per_task', 'hours_per_person'].includes(full.budgetMethod)
    const isMoney = full.budgetMethod === 'fee_total' || full.budgetMethod === 'cost_total'
    const moneyStatus = full.budgetMethod !== 'fee_total' ? 'not_applicable' : rates ? 'visible' : 'hidden'
    let budget: number | null = null
    if (full.budgetValue != null) {
      if (isHours) budget = hoursOf(full.budgetValue)
      else if (isMoney && rates) budget = amountOf(full.budgetValue)
    }
    const out: Record<string, unknown> = {
      project_id: p.id,
      name: p.name,
      budget_by: BUDGET_BY[full.budgetMethod] ?? 'none',
      budget_is_monthly: monthly,
      notify_when_over_budget: full.budgetAlertPercent != null,
      over_budget_notification_percentage: full.budgetAlertPercent,
      scope: monthly ? 'current_month' : 'lifetime',
      period: monthly ? 'current_month' : 'lifetime',
      hours_spent: hoursOf(minutes),
      billable_hours_spent: hoursOf(Number(agg?.bmin ?? 0)),
      money_spent: moneyStatus === 'visible' ? Math.round(Number(agg?.bcents ?? 0)) / 100 : null,
      money_spent_status: moneyStatus,
      billing_currency_code: p.billingCurrency ?? p.client.currency,
      bill_by: p.projectType === 'time_and_materials' ? BILL_BY_OUT[p.billableRateMethod ?? 'none'] : 'none',
      billable_rate: rates ? amountOf(p.projectHourlyRateCents) : null,
      budget,
      cost_budget: full.budgetMethod === 'cost_total' && rates && full.budgetValue != null ? amountOf(full.budgetValue) : null,
      budget_remaining: budget == null ? null : isHours ? Math.round((budget - hoursOf(minutes)) * 100) / 100 : moneyStatus === 'visible' ? Math.round((full.budgetValue! - Number(agg?.bcents ?? 0))) / 100 : null,
    }
    if (p.projectType === 'fixed_fee') {
      const [ff] = await fixedFeeStatus(prisma, ctx.user.accountId, { projectIds: [p.id] })
      out.fee = rates ? amountOf(ff?.feeCents ?? null) : null
      out.fee_invoiced = rates ? amountOf(ff?.invoicedCents ?? 0) : null
      out.fee_remaining = rates ? amountOf(ff?.remainingCents ?? 0) : null
    }
    return out
  },
}

// ---------------------------------------------------------------------------
// list_project_assignments
// ---------------------------------------------------------------------------

const listProjectAssignments: Tool = {
  name: 'list_project_assignments',
  description:
    'List who and what is assigned to a project. `assignment_type` selects one roster per call: `users` (assigned team members with `is_project_manager`, `uses_default_rate`, the person’s `billable_rate` on this project and its `billable_rate_source`) or `tasks` (assigned tasks with `is_billable` and the task `billable_rate`). This lists ASSIGNED members/tasks, distinct from who has logged time. `billable_rate` is null unless you can see billable rates; which rate applies to time depends on the project’s `bill_by` (People → user rates, Tasks → task rates, Project → the project rate). Per-person budgets are not stored in Track2 (`budget` is always null). Returns `limit` rows per page (default 100, max 500) with `next_cursor`.',
  inputSchema: obj(
    {
      project_id: id('Id of the project (from list_projects).'),
      assignment_type: str('Which roster to return: `users` (default) or `tasks`.', { enum: ['users', 'tasks'] }),
      limit: limitProp,
      cursor: cursorProp,
    },
    ['project_id'],
  ),
  write: false,
  async handler(args, ctx) {
    const p = await visibleProject(ctx, String(args.project_id))
    const type = (args.assignment_type as string | undefined) ?? 'users'
    const limit = limitOf(args.limit)
    const fp = filterFingerprint({ t: 'assignments', project_id: p.id, type, limit })
    const offset = offsetFromCursor(args.cursor as string | undefined, fp)
    const rates = canSeeRates(ctx.actor)
    const base = { project_id: p.id, assignment_type: type, billing_currency_code: p.billingCurrency ?? p.client.currency }
    if (type === 'tasks') {
      const [rows, total] = await Promise.all([
        prisma.projectTaskAssignment.findMany({
          where: { projectId: p.id, accountId: ctx.user.accountId },
          select: { taskId: true, billable: true, hourlyRateCents: true, isActive: true, task: { select: { name: true, defaultHourlyRateCents: true, isActive: true } } },
          orderBy: [{ task: { name: 'asc' } }, { id: 'asc' }],
          skip: offset,
          take: limit,
        }),
        prisma.projectTaskAssignment.count({ where: { projectId: p.id, accountId: ctx.user.accountId } }),
      ])
      const truncated = offset + rows.length < total
      return {
        ...base,
        assignments: rows.map((a) => ({
          task_id: a.taskId,
          task_name: a.task.name,
          is_active: a.isActive && a.task.isActive,
          is_billable: a.billable,
          uses_default_rate: a.hourlyRateCents == null,
          billable_rate: rates ? amountOf(a.hourlyRateCents ?? a.task.defaultHourlyRateCents) : null,
          budget: null,
        })),
        limit,
        truncated,
        next_cursor: truncated ? encodeCursor({ o: offset + limit }, fp) : null,
      }
    }
    const [rows, total] = await Promise.all([
      prisma.projectUserAssignment.findMany({
        where: { projectId: p.id, accountId: ctx.user.accountId },
        select: { userId: true, isActive: true, isProjectManager: true, hourlyRateCents: true, user: { select: { firstName: true, lastName: true, isActive: true } } },
        orderBy: [{ user: { firstName: 'asc' } }, { user: { lastName: 'asc' } }, { id: 'asc' }],
        skip: offset,
        take: limit,
      }),
      prisma.projectUserAssignment.count({ where: { projectId: p.id, accountId: ctx.user.accountId } }),
    ])
    const personRates = rates
      ? await prisma.personBillableRate.findMany({
          where: { accountId: ctx.user.accountId, userId: { in: rows.map((r) => r.userId) } },
          select: { userId: true, hourlyRateCents: true, startDate: true, endDate: true },
        })
      : []
    const today = todayIn((await getAccountClock(ctx.user.accountId)).timezone, ctx.now)
    const truncated = offset + rows.length < total
    return {
      ...base,
      assignments: rows.map((a) => {
        const personDefault = effectiveRate(personRates.filter((r) => r.userId === a.userId), today)
        const rate = a.hourlyRateCents ?? personDefault
        return {
          user_id: a.userId,
          user_name: `${a.user.firstName} ${a.user.lastName}`.trim(),
          is_active: a.isActive && a.user.isActive,
          is_project_manager: a.isProjectManager,
          uses_default_rate: a.hourlyRateCents == null,
          billable_rate: rates ? amountOf(rate) : null,
          billable_rate_source: !rates ? null : a.hourlyRateCents != null ? 'project_override' : personDefault != null ? 'person_default' : null,
          budget: null,
        }
      }),
      limit,
      truncated,
      next_cursor: truncated ? encodeCursor({ o: offset + limit }, fp) : null,
    }
  },
}

// ---------------------------------------------------------------------------
// create_project / update_project
// ---------------------------------------------------------------------------

type RateStatus = 'applied' | 'ignored_no_permission' | 'ignored_bill_by' | 'not_provided'

const createProjectTool: Tool = {
  name: 'create_project',
  description:
    'Create a project for an existing client. `name` and `client_id` are required. Type: `is_fixed_fee: true` → fixed fee (set `fee`), `is_billable: false` → non-billable, otherwise hourly (time & materials). Set `hourly_rate` only when the project bills hourly at the project level; it requires billable-rate permission and implies `bill_by` "Project" unless you pass a different `bill_by`. Pass `bill_by` Tasks or People to bill by task or person rates (set those separately). The response echoes `billable_rate` and `rate_status` (`applied`, `ignored_no_permission`, `ignored_bill_by`, `not_provided`). The creator becomes the project manager; default ("common") tasks are added automatically. Requires project-management permission.',
  inputSchema: obj(
    {
      name: str('Project name (required).'),
      client_id: id('Id of the client this project belongs to (from list_clients).'),
      code: str('Optional project code.'),
      is_billable: bool('Whether the project is billable. Defaults to true.'),
      is_fixed_fee: bool('Whether the project bills a fixed fee.'),
      bill_by: str('How an hourly project bills: Tasks, People, Project, none. Defaults to "Project" when hourly_rate is set, otherwise "none".', { enum: ['Tasks', 'People', 'Project', 'none'] }),
      hourly_rate: num('Project hourly rate, billed when bill_by is "Project". Requires billable-rate permission.', { minimum: 0 }),
      fee: num('Track2: total project fee for a fixed-fee project. Requires billable-rate permission.', { minimum: 0 }),
    },
    ['name', 'client_id'],
  ),
  write: true,
  async handler(args, ctx) {
    requireCap(ctx, 'manage_projects', 'You do not have permission to add projects.')
    const { accountId, userId } = ctx.user
    const name = String(args.name).trim()
    if (!name) throw invalid('name: is required.', { field: 'name' })
    const client = await prisma.client.findFirst({ where: { id: String(args.client_id), accountId }, select: { id: true, entityId: true, isActive: true } })
    if (!client) throw notFound('Client')
    if (!client.isActive) throw invalid('client_id: that client is archived; reactivate it with update_client first.', { field: 'client_id' })
    if (args.is_fixed_fee && args.is_billable === false) throw invalid('A project can’t be both fixed-fee and non-billable.', { field: 'is_fixed_fee' })
    const projectType: ProjectType = args.is_fixed_fee ? 'fixed_fee' : args.is_billable === false ? 'non_billable' : 'time_and_materials'
    const isTM = projectType === 'time_and_materials'
    const rates = canSeeRates(ctx.actor)
    const billBy = isTM ? BILL_BY_IN[(args.bill_by as string | undefined) ?? (args.hourly_rate !== undefined ? 'Project' : 'none')] : null
    let rateStatus: RateStatus = 'not_provided'
    let projectHourlyRateCents: number | null = null
    if (args.hourly_rate !== undefined) {
      if (!rates) rateStatus = 'ignored_no_permission'
      else if (billBy !== 'project') rateStatus = 'ignored_bill_by'
      else {
        projectHourlyRateCents = centsFromAmount(args.hourly_rate as number, 'hourly_rate')
        rateStatus = 'applied'
      }
    }
    let projectFeesCents: number | null = null
    if (args.fee !== undefined && projectType === 'fixed_fee' && rates) projectFeesCents = centsFromAmount(args.fee as number, 'fee')
    const created = await createProject(prisma, {
      accountId,
      creatorUserId: userId,
      clientId: client.id,
      entityId: client.entityId, // inherit the client's business entity (specs/16)
      name,
      code: (args.code as string | undefined)?.trim() || null,
      projectType,
      billableRateMethod: billBy,
      projectHourlyRateCents,
      projectFeesCents,
    })
    const row = await prisma.project.findUniqueOrThrow({ where: { id: created.id }, select: PROJECT_SELECT })
    return { ...projectRow(row, ctx), rate_status: rateStatus, fee_status: args.fee === undefined ? 'not_provided' : projectFeesCents != null ? 'applied' : rates ? 'ignored_not_fixed_fee' : 'ignored_no_permission' }
  },
}

const updateProjectTool: Tool = {
  name: 'update_project',
  description:
    'Update a project’s name, code, billing setup, or active state. Only supplied fields change. `project_type`: hourly | fixed_fee | non_billable. `is_active: false` archives the project (fails while a timer is running on it), `true` reactivates it. Changing `hourly_rate` / `fee` requires billable-rate permission; the response echoes `billable_rate` and `rate_status` (`ignored_bill_by` when the project doesn’t bill at the project level). A blank `code` is ignored. Project Managers can only edit projects they manage.',
  inputSchema: obj(
    {
      id: id('Id of the project to update (from list_projects).'),
      name: str('New project name.'),
      code: str('New project code (blank is ignored).'),
      project_type: str('Project type.', { enum: ['hourly', 'fixed_fee', 'non_billable'] }),
      bill_by: str('How an hourly project bills (Tasks, People, Project, none).', { enum: ['Tasks', 'People', 'Project', 'none'] }),
      hourly_rate: num('Project hourly rate when bill_by is Project. Requires billable-rate permission.', { minimum: 0 }),
      fee: num('Track2: total fee for a fixed-fee project. Requires billable-rate permission.', { minimum: 0 }),
      is_active: bool('Set false to archive the project, true to reactivate an archived one.'),
    },
    ['id'],
  ),
  write: true,
  idempotent: true,
  async handler(args, ctx) {
    const p = await requireProjectManage(ctx, String(args.id))
    const rates = canSeeRates(ctx.actor)
    const typeIn = args.project_type as string | undefined
    const projectType: ProjectType = typeIn === 'hourly' ? 'time_and_materials' : typeIn ? (typeIn as ProjectType) : p.projectType
    const isTM = projectType === 'time_and_materials'
    const billBy: BillableRateMethod | null = isTM ? (args.bill_by ? BILL_BY_IN[args.bill_by as string] : (p.billableRateMethod ?? 'none')) : null
    let rateStatus: RateStatus = 'not_provided'
    const data: Prisma.ProjectUpdateInput = {}
    if (args.name !== undefined) {
      const name = String(args.name).trim()
      if (!name) throw invalid('name: must not be empty.', { field: 'name' })
      data.name = name
    }
    if (typeof args.code === 'string' && args.code.trim()) data.code = args.code.trim()
    if (typeIn || args.bill_by) {
      data.projectType = projectType
      data.isBillable = projectType !== 'non_billable'
      data.billableRateMethod = billBy
      if (billBy !== 'project') data.projectHourlyRateCents = null
    }
    if (args.hourly_rate !== undefined) {
      if (!rates) rateStatus = 'ignored_no_permission'
      else if (billBy !== 'project') rateStatus = 'ignored_bill_by'
      else {
        data.projectHourlyRateCents = centsFromAmount(args.hourly_rate as number, 'hourly_rate')
        rateStatus = 'applied'
      }
    }
    if (args.fee !== undefined) {
      if (!rates) throw forbidden('Changing the project fee requires billable-rate permission.')
      if (projectType !== 'fixed_fee') throw invalid('fee: only fixed-fee projects have a fee.', { field: 'fee' })
      data.projectFeesCents = centsFromAmount(args.fee as number, 'fee')
    }
    if (args.is_active !== undefined) {
      if (args.is_active === false) {
        const running = await prisma.timeEntry.findFirst({ where: { accountId: ctx.user.accountId, projectId: p.id, isRunning: true }, select: { id: true } })
        if (running) throw invalid('A timer is running on this project; stop it before archiving the project.')
      }
      data.isActive = args.is_active as boolean
      data.archivedAt = args.is_active ? null : ctx.now
    }
    const row = await prisma.project.update({ where: { id: p.id }, data, select: PROJECT_SELECT })
    return { ...projectRow(row, ctx), rate_status: rateStatus }
  },
}

// ---------------------------------------------------------------------------
// Task + user assignment
// ---------------------------------------------------------------------------

const projectAndTask = obj({ project_id: id('Project id.'), task_id: id('Task id.') }, ['project_id', 'task_id'])
const projectAndUser = obj({ project_id: id('Project id.'), user_id: id('User id.') }, ['project_id', 'user_id'])

const addTaskToProject: Tool = {
  name: 'add_task_to_project',
  description:
    'Add a task to a project so time can be logged against it. Reactivates the task on the project if it was previously removed. Both the project and the task must be active — reactivate an archived project with update_project (is_active: true) first. Requires permission to edit the project.',
  inputSchema: projectAndTask,
  write: true,
  idempotent: true,
  async handler(args, ctx) {
    const p = await requireProjectManage(ctx, String(args.project_id))
    if (!p.isActive) throw invalid('project_id: the project is archived; reactivate it with update_project first.', { field: 'project_id' })
    const task = await prisma.task.findFirst({ where: { id: String(args.task_id), accountId: ctx.user.accountId }, select: { id: true, name: true, isActive: true, defaultBillable: true } })
    if (!task) throw notFound('Task')
    if (!task.isActive) throw invalid('task_id: the task is archived; reactivate it with update_task first.', { field: 'task_id' })
    const a = await addTask(prisma, { accountId: ctx.user.accountId, projectId: p.id, taskId: task.id, defaultBillable: task.defaultBillable })
    return { project_id: p.id, task_id: task.id, task_name: task.name, is_active: a.isActive, is_billable: a.billable, added: true }
  },
}

const removeTaskFromProject: Tool = {
  name: 'remove_task_from_project',
  description: 'Remove a task from a project. Historical time entries are preserved. Returns `removed: false` if the task was not assigned to the project. Requires permission to edit the project.',
  inputSchema: projectAndTask,
  write: true,
  destructive: true,
  idempotent: true,
  async handler(args, ctx) {
    const p = await requireProjectManage(ctx, String(args.project_id))
    const removed = await removeTask(prisma, { accountId: ctx.user.accountId, projectId: p.id, taskId: String(args.task_id) })
    return { project_id: p.id, task_id: String(args.task_id), removed }
  },
}

const assignUserToProject: Tool = {
  name: 'assign_user_to_project',
  description: 'Assign a user to a project so they can log time against it. Reactivates the assignment if it was previously removed. Requires permission to edit the project.',
  inputSchema: projectAndUser,
  write: true,
  idempotent: true,
  async handler(args, ctx) {
    const p = await requireProjectManage(ctx, String(args.project_id))
    const user = await prisma.user.findFirst({ where: { id: String(args.user_id), accountId: ctx.user.accountId }, select: { id: true, firstName: true, lastName: true, isActive: true } })
    if (!user) throw notFound('User')
    if (!user.isActive) throw invalid('user_id: that person is deactivated.', { field: 'user_id' })
    const a = await assignUser(prisma, { accountId: ctx.user.accountId, projectId: p.id, userId: user.id })
    return { project_id: p.id, user_id: user.id, user_name: `${user.firstName} ${user.lastName}`.trim(), is_active: a.isActive, is_project_manager: a.isProjectManager, assigned: true }
  },
}

const unassignUserFromProject: Tool = {
  name: 'unassign_user_from_project',
  description: 'Remove a user’s assignment from a project. Historical time entries are preserved. Returns `removed: false` if the user was not assigned. Requires permission to edit the project.',
  inputSchema: projectAndUser,
  write: true,
  destructive: true,
  idempotent: true,
  async handler(args, ctx) {
    const p = await requireProjectManage(ctx, String(args.project_id))
    const removed = await unassignUser(prisma, { accountId: ctx.user.accountId, projectId: p.id, userId: String(args.user_id) })
    return { project_id: p.id, user_id: String(args.user_id), removed }
  },
}

export const projectTools: Tool[] = [
  listProjects,
  getProjectBudget,
  listProjectAssignments,
  createProjectTool,
  updateProjectTool,
  addTaskToProject,
  removeTaskFromProject,
  assignUserToProject,
  unassignUserFromProject,
]
