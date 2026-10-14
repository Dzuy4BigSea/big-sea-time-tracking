import 'server-only'
import { prisma } from '@/lib/prisma'
import { getModules } from '@/lib/modules'
import { getAccountClock } from '@/lib/accountClock'
import { todayYmdIn } from '@/lib/tz'
import { PROFILE_LABELS, type PermissionProfile } from '@/modules/shared/permissions'
import { obj, str, id, bool, num } from '@/modules/mcp/schema'
import { notFound, invalid } from '@/modules/mcp/errors'
import { filterFingerprint, offsetFromCursor, encodeCursor } from '@/modules/mcp/cursor'
import { matchesSearch, matchesPrefix } from '@/modules/mcp/search'
import { amountOf, centsFromAmount } from '@/modules/mcp/format'
import { canSeeRates } from '@/modules/mcp/scope'
import { has, requireCap, type Tool, type McpContext } from '../context'

const PAGE = 100
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'] // same list as the client form (app/clients/actions.ts)

/** Slice an in-memory, already-filtered list (small lookup tables) into a Harvest-style page. */
function pageList<T>(all: T[], cursor: string | undefined, fp: string, limit = PAGE) {
  const offset = offsetFromCursor(cursor, fp)
  const page = all.slice(offset, offset + limit)
  const truncated = offset + limit < all.length
  return { page, total_count: all.length, limit, truncated, next_cursor: truncated ? encodeCursor({ o: offset + limit }, fp) : null }
}

const cursorProp = str('Opaque pagination token. Omit on the first request; on later pages pass back the exact `next_cursor` from the prior response, with all other parameters identical.')

// ---------------------------------------------------------------------------
// get_account_settings
// ---------------------------------------------------------------------------

const getAccountSettings: Tool = {
  name: 'get_account_settings',
  description:
    'Return the account’s capabilities and tracking conventions so you can pre-validate before acting: `approval_required` (timesheet approval module on), `notes_required` (every time entry needs notes), `time_rounding`, `wants_timestamp_timers`, `week_start_day`, `time_format`, whether the `invoice` and `expense` features are on, plus Track2 extras: `timezone`, `today` (the account’s current date — use it for “today”/“this week”), and `base_currency`. Account-level read; every user sees the same values.',
  inputSchema: obj({}),
  write: false,
  async handler(_args, ctx) {
    const [account, modules, clock] = await Promise.all([
      prisma.account.findUniqueOrThrow({
        where: { id: ctx.user.accountId },
        select: { name: true, timeEntryNotes: true, timeRounding: true, timerMode: true, weekStartsOn: true, timeDisplay: true, baseCurrency: true },
      }),
      getModules(ctx.user.accountId),
      getAccountClock(ctx.user.accountId),
    ])
    const roundTo = account.timeRounding === 'none' ? null : Number(account.timeRounding.replace('nearest_', ''))
    return {
      approval_required: modules.timesheetApproval,
      notes_required: account.timeEntryNotes === 'required',
      time_rounding: { enabled: roundTo != null, style: roundTo != null ? 'nearest' : null, round_to_minutes: roundTo },
      wants_timestamp_timers: account.timerMode === 'start_stop',
      week_start_day: account.weekStartsOn === 'sunday' ? 'Sunday' : 'Monday',
      time_format: account.timeDisplay === 'decimal' ? 'decimal' : 'hours_minutes',
      invoice_feature: modules.invoices,
      expense_feature: modules.expenseTracking,
      account_name: account.name,
      timezone: clock.timezone,
      today: todayYmdIn(clock.timezone, ctx.now),
      base_currency: account.baseCurrency,
    }
  },
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

function clientRow(c: { id: string; name: string; isActive: boolean; currency: string; address: string | null; updatedAt: Date; _count?: { projects: number } }) {
  return {
    id: c.id,
    name: c.name,
    is_active: c.isActive,
    active_project_count: c._count?.projects ?? null,
    currency_code: c.currency,
    address: c.address,
    updated_at: c.updatedAt.toISOString(),
  }
}

const listClients: Tool = {
  name: 'list_clients',
  description:
    'List clients, ordered by name. Returns up to 100 per page; `total_count` is how many match the filter in full, so when `truncated` is true you can tell how many are missing — refine `search` or `is_active`, or pass `next_cursor` back as `cursor`.',
  inputSchema: obj({
    is_active: bool('Filter to active (true) or archived (false) clients. Omit for all.'),
    search: str('Case-insensitive substring match on client name; ignores punctuation and spacing.'),
    cursor: cursorProp,
  }),
  write: false,
  handler: async (args, ctx) => {
  const rows = await prisma.client.findMany({
    where: { accountId: ctx.user.accountId, ...(args.is_active !== undefined ? { isActive: args.is_active as boolean } : {}) },
    select: { id: true, name: true, isActive: true, currency: true, address: true, updatedAt: true, _count: { select: { projects: { where: { isActive: true } } } } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  })
  const filtered = rows.filter((c) => matchesSearch(args.search as string | undefined, c.name))
  const fp = filterFingerprint({ t: 'clients', is_active: args.is_active, search: args.search })
  const { page, ...meta } = pageList(filtered, args.cursor as string | undefined, fp)
  return { clients: page.map(clientRow), ...meta }
  },
}

function currencyArg(v: unknown): string | undefined {
  if (v === undefined) return undefined
  const c = String(v).trim().toUpperCase()
  if (!CURRENCIES.includes(c)) throw invalid(`currency_code: Track2 supports ${CURRENCIES.join(', ')}.`, { field: 'currency_code' })
  return c
}

const createClient: Tool = {
  name: 'create_client',
  description: 'Create a client. `name` is required. `currency_code` defaults to the account base currency. Requires client-management permission.',
  inputSchema: obj(
    {
      name: str('Client name (required).'),
      address: str('Optional postal address.'),
      currency_code: str('Optional ISO 4217 code (USD, EUR, GBP, CAD, AUD). Defaults to the account currency.'),
    },
    ['name'],
  ),
  write: true,
  async handler(args, ctx) {
    requireCap(ctx, 'manage_clients', 'You do not have permission to add clients.')
    const name = String(args.name).trim()
    if (!name) throw invalid('name: is required.', { field: 'name' })
    const account = await prisma.account.findUniqueOrThrow({ where: { id: ctx.user.accountId }, select: { baseCurrency: true } })
    const currency = currencyArg(args.currency_code) ?? (CURRENCIES.includes(account.baseCurrency) ? account.baseCurrency : 'USD')
    const c = await prisma.client.create({
      data: { accountId: ctx.user.accountId, name, currency, address: (args.address as string | undefined)?.trim() || null },
      select: { id: true, name: true, isActive: true, currency: true, address: true, updatedAt: true },
    })
    return clientRow({ ...c, _count: { projects: 0 } })
  },
}

const updateClient: Tool = {
  name: 'update_client',
  description:
    'Update a client’s name, address, currency, or active state. Only supplied fields change. `is_active: false` archives the client (its projects stop accepting new time), `true` reactivates it. Currency can’t change once the client has invoices. Requires client-management permission.',
  inputSchema: obj(
    {
      id: id('Id of the client to update (from list_clients).'),
      name: str('New client name.'),
      address: str('New postal address. Pass an empty string to clear it.'),
      currency_code: str('New ISO 4217 currency code.'),
      is_active: bool('Set false to archive the client, true to reactivate an archived one.'),
    },
    ['id'],
  ),
  write: true,
  idempotent: true,
  async handler(args, ctx) {
    requireCap(ctx, 'manage_clients', 'You do not have permission to edit clients.')
    const { accountId } = ctx.user
    const client = await prisma.client.findFirst({
      where: { id: String(args.id), accountId },
      select: { id: true, currency: true, _count: { select: { invoices: true } } },
    })
    if (!client) throw notFound('Client')
    const currency = currencyArg(args.currency_code)
    if (currency && currency !== client.currency && client._count.invoices > 0) {
      throw invalid('currency_code: currency can’t change after the client has invoices.', { field: 'currency_code' })
    }
    const name = args.name !== undefined ? String(args.name).trim() : undefined
    if (name === '') throw invalid('name: must not be empty.', { field: 'name' })
    const c = await prisma.client.update({
      where: { id: client.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(args.address !== undefined ? { address: String(args.address).trim() || null } : {}),
        ...(currency ? { currency } : {}),
        ...(args.is_active !== undefined ? { isActive: args.is_active as boolean, archivedAt: args.is_active ? null : ctx.now } : {}),
      },
      select: { id: true, name: true, isActive: true, currency: true, address: true, updatedAt: true, _count: { select: { projects: { where: { isActive: true } } } } },
    })
    return clientRow(c)
  },
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function taskRow(t: { id: string; name: string; isActive: boolean; autoAddToNewProjects: boolean; defaultBillable: boolean; defaultHourlyRateCents: number | null }, ctx: McpContext) {
  return {
    id: t.id,
    name: t.name,
    is_active: t.isActive,
    is_default: t.autoAddToNewProjects,
    billable_by_default: t.defaultBillable,
    default_hourly_rate: canSeeRates(ctx.actor) ? amountOf(t.defaultHourlyRateCents) : null,
  }
}

const TASK_SELECT = { id: true, name: true, isActive: true, autoAddToNewProjects: true, defaultBillable: true, defaultHourlyRateCents: true } as const

const listTasks: Tool = {
  name: 'list_tasks',
  description:
    'List tasks (kinds of work assigned to projects, e.g. "Design"), ordered by name. Returns up to 100 per page with `total_count` / `truncated`. `default_hourly_rate` is null unless you can see billable rates.',
  inputSchema: obj({
    is_active: bool('Filter to active (true) or archived (false) tasks. Omit for active tasks only — pass false explicitly to see archived ones.'),
    search: str('Case-insensitive substring match on task name; ignores punctuation and spacing.'),
    cursor: cursorProp,
  }),
  write: false,
  async handler(args, ctx) {
    const isActive = args.is_active === undefined ? true : (args.is_active as boolean)
    const rows = await prisma.task.findMany({ where: { accountId: ctx.user.accountId, isActive }, select: TASK_SELECT, orderBy: [{ name: 'asc' }, { id: 'asc' }] })
    const filtered = rows.filter((t) => matchesSearch(args.search as string | undefined, t.name))
    const fp = filterFingerprint({ t: 'tasks', is_active: isActive, search: args.search })
    const { page, ...meta } = pageList(filtered, args.cursor as string | undefined, fp)
    return { tasks: page.map((t) => taskRow(t, ctx)), ...meta }
  },
}

async function assertUniqueTaskName(accountId: string, name: string, exceptId?: string) {
  const clash = await prisma.task.findFirst({
    where: { accountId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, name: true },
  })
  if (clash) throw invalid(`name: a task named "${clash.name}" already exists (id ${clash.id}).`, { field: 'name', existing_id: clash.id })
}

/** Rates follow billable-rate visibility (Harvest: ignored without rate permission). */
function rateStatus(ctx: McpContext, provided: boolean): 'applied' | 'ignored_no_permission' | 'not_provided' {
  if (!provided) return 'not_provided'
  return canSeeRates(ctx.actor) ? 'applied' : 'ignored_no_permission'
}

const createTask: Tool = {
  name: 'create_task',
  description:
    'Create a task. `name` must be unique in the account. `is_default` adds it to every NEW project automatically ("common task"); `add_to_all_projects` also assigns it to every active project now. `default_hourly_rate` is applied only if you can see billable rates (see `rate_status`). Requires task-management permission.',
  inputSchema: obj(
    {
      name: str('Task name (must be unique in the account).'),
      billable_by_default: bool('Whether time on this task is billable by default. Defaults to true.'),
      default_hourly_rate: num('Default billable rate. Ignored unless you can see billable rates.', { minimum: 0 }),
      is_default: bool('Whether the task is added to new projects by default.'),
      add_to_all_projects: bool('Also assign this task to every active project.'),
    },
    ['name'],
  ),
  write: true,
  async handler(args, ctx) {
    requireCap(ctx, 'manage_tasks', 'You do not have permission to add tasks.')
    const { accountId } = ctx.user
    const name = String(args.name).trim()
    if (!name) throw invalid('name: is required.', { field: 'name' })
    await assertUniqueTaskName(accountId, name)
    const rs = rateStatus(ctx, args.default_hourly_rate !== undefined)
    const task = await prisma.task.create({
      data: {
        accountId,
        name,
        defaultBillable: args.billable_by_default === undefined ? true : (args.billable_by_default as boolean),
        autoAddToNewProjects: !!args.is_default,
        defaultHourlyRateCents: rs === 'applied' ? centsFromAmount(args.default_hourly_rate as number, 'default_hourly_rate', { allowZero: true }) || null : null,
      },
      select: TASK_SELECT,
    })
    let addedToProjects = 0
    if (args.add_to_all_projects) {
      const projects = await prisma.project.findMany({ where: { accountId, isActive: true, archivedAt: null }, select: { id: true } })
      const res = await prisma.projectTaskAssignment.createMany({
        data: projects.map((p) => ({ accountId, projectId: p.id, taskId: task.id, billable: task.defaultBillable })),
        skipDuplicates: true,
      })
      addedToProjects = res.count
    }
    return { ...taskRow(task, ctx), rate_status: rs, added_to_project_count: addedToProjects }
  },
}

const updateTask: Tool = {
  name: 'update_task',
  description:
    'Update a task: rename it, change billable-by-default, its default billable rate, whether it is a default (common) task, and/or archive/reactivate it via `is_active`. Only supplied fields change. A new name must be unique. `default_hourly_rate` is applied only if you can see billable rates (check `rate_status`); in Track2 it affects NEW time only — existing entries keep the rate stored when they were logged. Requires task-management permission.',
  inputSchema: obj(
    {
      id: id('Id of the task (from list_tasks).'),
      name: str('New task name (must be unique in the account).'),
      billable_by_default: bool('Whether time on this task is billable by default.'),
      default_hourly_rate: num('New default billable rate (0 clears it). Ignored unless you can see billable rates.', { minimum: 0 }),
      is_default: bool('Whether the task is added to new projects by default.'),
      is_active: bool('Set false to archive the task, true to reactivate it.'),
    },
    ['id'],
  ),
  write: true,
  idempotent: true,
  async handler(args, ctx) {
    requireCap(ctx, 'manage_tasks', 'You do not have permission to edit tasks.')
    const { accountId } = ctx.user
    const task = await prisma.task.findFirst({ where: { id: String(args.id), accountId }, select: { id: true } })
    if (!task) throw notFound('Task')
    const name = args.name !== undefined ? String(args.name).trim() : undefined
    if (name === '') throw invalid('name: must not be empty.', { field: 'name' })
    if (name) await assertUniqueTaskName(accountId, name, task.id)
    if (args.is_active === false) {
      const running = await prisma.timeEntry.findFirst({ where: { accountId, taskId: task.id, isRunning: true }, select: { id: true } })
      if (running) throw invalid('A timer is running on this task; stop it before archiving the task.')
    }
    const rs = rateStatus(ctx, args.default_hourly_rate !== undefined)
    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        ...(name ? { name } : {}),
        ...(args.billable_by_default !== undefined ? { defaultBillable: args.billable_by_default as boolean } : {}),
        ...(args.is_default !== undefined ? { autoAddToNewProjects: args.is_default as boolean } : {}),
        ...(rs === 'applied' ? { defaultHourlyRateCents: centsFromAmount(args.default_hourly_rate as number, 'default_hourly_rate', { allowZero: true }) || null } : {}),
        ...(args.is_active !== undefined ? { isActive: args.is_active as boolean, archivedAt: args.is_active ? null : ctx.now } : {}),
      },
      select: TASK_SELECT,
    })
    return { ...taskRow(updated, ctx), rate_status: rs }
  },
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const listUsers: Tool = {
  name: 'list_users',
  description:
    'List team members, ordered by id. Returns up to 100 per page; `total_count` is how many match the filter in full. Fetch the rest by calling again with `next_cursor` and the same filters until `truncated` is false. Field availability follows your role: email, capacity and timezone are shown for yourself, or for everyone if you can manage people.',
  inputSchema: obj({
    is_active: bool('Filter to active (true) or deactivated (false) users. Omit for all.'),
    search: str('Case-insensitive prefix match on user name or email.'),
    cursor: cursorProp,
  }),
  write: false,
  async handler(args, ctx) {
    const seeAll = has(ctx, 'manage_people')
    const rows = await prisma.user.findMany({
      where: { accountId: ctx.user.accountId, ...(args.is_active !== undefined ? { isActive: args.is_active as boolean } : {}) },
      select: {
        id: true, firstName: true, lastName: true, email: true, isActive: true, type: true, permissionProfile: true,
        roleTags: true, departments: true, capacityHoursPerWeek: true, timezone: true, createdAt: true, updatedAt: true,
      },
      orderBy: { id: 'asc' },
    })
    const filtered = rows.filter((u) => matchesPrefix(args.search as string | undefined, u.firstName, u.lastName, `${u.firstName} ${u.lastName}`, u.email))
    const fp = filterFingerprint({ t: 'users', is_active: args.is_active, search: args.search })
    const { page, ...meta } = pageList(filtered, args.cursor as string | undefined, fp)
    return {
      users: page.map((u) => {
        const visible = seeAll || u.id === ctx.user.userId
        return {
          id: u.id,
          first_name: u.firstName,
          last_name: u.lastName,
          full_name: `${u.firstName} ${u.lastName}`.trim(),
          email: visible ? u.email : null,
          is_active: u.isActive,
          is_admin: u.permissionProfile === 'administrator',
          is_contractor: u.type === 'contractor',
          access_role: PROFILE_LABELS[u.permissionProfile as PermissionProfile] ?? u.permissionProfile,
          roles: u.roleTags,
          departments: u.departments,
          weekly_capacity_hours: visible && u.capacityHoursPerWeek != null ? Number(u.capacityHoursPerWeek) : null,
          timezone: visible ? u.timezone : null,
          created_at: u.createdAt.toISOString().slice(0, 10),
          updated_at: u.updatedAt.toISOString(),
        }
      }),
      ...meta,
    }
  },
}

// ---------------------------------------------------------------------------
// Expense categories
// ---------------------------------------------------------------------------

const listExpenseCategories: Tool = {
  name: 'list_expense_categories',
  description:
    'List expense categories, ordered by name. Use this to find the `expense_category_id` for `create_expense`. Unit-based categories report `is_unit_based: true` with `unit_name` and `unit_price`. `truncated` is true when more exist.',
  inputSchema: obj({
    is_active: bool('Filter to active (true) or archived (false) categories. Omit for active categories only.'),
  }),
  write: false,
  async handler(args, ctx) {
    const isActive = args.is_active === undefined ? true : (args.is_active as boolean)
    const rows = await prisma.expenseCategory.findMany({ where: { accountId: ctx.user.accountId, isActive }, orderBy: [{ name: 'asc' }, { id: 'asc' }] })
    return {
      expense_categories: rows.slice(0, PAGE).map((c) => ({
        id: c.id,
        name: c.name,
        is_active: c.isActive,
        is_unit_based: c.unitPriceCents != null,
        unit_name: c.unitName,
        unit_price: amountOf(c.unitPriceCents),
      })),
      limit: PAGE,
      truncated: rows.length > PAGE,
    }
  },
}

export const directoryTools: Tool[] = [getAccountSettings, listClients, createClient, updateClient, listTasks, createTask, updateTask, listUsers, listExpenseCategories]
