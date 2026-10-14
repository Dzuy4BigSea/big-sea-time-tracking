import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAccountClock } from '@/lib/accountClock'
import { managedProjectIdsFor, mayActForOnProject, resolveSubjectUserId, listActablePeople } from '@/lib/timesheetSubject'
import { logTime, checkLoggable } from '@/modules/time/logTime'
import { startTimer, stopTimer } from '@/modules/time/timer'
import { computeTimerMinutes } from '@/modules/time/timeEntry'
import { updateTimeEntry, deleteTimeEntry, EDIT_REFUSAL_MESSAGE } from '@/modules/time/editEntry'
import { obj, str, id, ids, date, num, int, bool } from '@/modules/mcp/schema'
import { ToolError, notFound, forbidden, invalid } from '@/modules/mcp/errors'
import { filterFingerprint, decodeCursor, pageOf } from '@/modules/mcp/cursor'
import { hoursOf, roundedHoursOf, durationMinutes, ymdOf } from '@/modules/mcp/format'
import { timeReadScope, resolveUserFilter, canSeeRates, type ReadScope } from '@/modules/mcp/scope'
import { accountToday, dateArg, rangeArgs, limitOf, MAX_LIMIT, type Tool, type McpContext } from '../context'

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const ENTRY_SELECT = {
  id: true, spentDate: true, minutes: true, notes: true, userId: true, projectId: true, taskId: true, isBillable: true,
  isRunning: true, timerStartedAt: true, lockState: true, invoiceLineItemId: true, updatedAt: true,
  user: { select: { firstName: true, lastName: true } },
  project: { select: { name: true, code: true, clientId: true, client: { select: { name: true } } } },
  task: { select: { name: true } },
  invoiceLineItem: { select: { invoiceId: true } },
} as const
type EntryRow = Prisma.TimeEntryGetPayload<{ select: typeof ENTRY_SELECT }>

async function roundingOf(accountId: string): Promise<string> {
  const a = await prisma.account.findUnique({ where: { id: accountId }, select: { timeRounding: true } })
  return a?.timeRounding ?? 'none'
}

export function entryRow(e: EntryRow, now: Date, rounding: string) {
  const minutes = e.isRunning && e.timerStartedAt ? e.minutes + computeTimerMinutes(e.timerStartedAt, now) : e.minutes
  const rounded = roundedHoursOf(minutes, rounding)
  return {
    id: e.id,
    spent_at: ymdOf(e.spentDate),
    hours: hoursOf(minutes),
    ...(rounded !== undefined ? { rounded_hours: rounded } : {}),
    notes: e.notes,
    user_id: e.userId,
    user_name: `${e.user.firstName} ${e.user.lastName}`.trim(),
    client_id: e.project.clientId,
    client_name: e.project.client.name,
    project_id: e.projectId,
    project_name: e.project.name,
    project_code: e.project.code,
    task_id: e.taskId,
    task_name: e.task.name,
    billable: e.isBillable,
    started_time: null,
    ended_time: null,
    is_running: e.isRunning,
    timer_started_at: e.timerStartedAt ? e.timerStartedAt.toISOString() : null,
    is_closed: e.lockState === 'approved',
    approval_status: e.lockState === 'approved' ? 'approved' : 'unsubmitted',
    is_invoiced: e.invoiceLineItemId != null || e.lockState === 'invoiced',
    invoice_id: e.invoiceLineItem?.invoiceId ?? null,
    is_locked: e.lockState !== 'open' || e.invoiceLineItemId != null,
    updated_at: e.updatedAt.toISOString(),
  }
}

async function loadEntry(ctx: McpContext, entryId: string) {
  const e = await prisma.timeEntry.findFirst({ where: { id: entryId, accountId: ctx.user.accountId }, select: ENTRY_SELECT })
  if (!e) throw notFound('Time entry')
  return entryRow(e, ctx.now, await roundingOf(ctx.user.accountId))
}

/** Prisma where for "rows the caller may read" (time or expenses share the shape: userId + projectId). */
async function scopeWhere(ctx: McpContext, scope: ReadScope, requested?: string[]) {
  const f = resolveUserFilter(scope, ctx.user.userId, requested)
  const and: Prisma.TimeEntryWhereInput[] = []
  if (f.userIds) and.push({ userId: { in: f.userIds } })
  if (f.managedOnly) {
    const managed = (await managedProjectIdsFor(ctx.user)) ?? new Set<string>()
    and.push({ OR: [{ userId: ctx.user.userId }, { projectId: { in: [...managed] } }] })
  }
  return { and, scopeLimited: f.scopeLimited }
}

const notesRequired = async (accountId: string) =>
  (await prisma.account.findUnique({ where: { id: accountId }, select: { timeEntryNotes: true } }))?.timeEntryNotes === 'required'

/** checkLoggable's message → a structured error. */
function loggableError(msg: string): ToolError {
  return msg === 'Project not found.' ? notFound('Project') : invalid(msg)
}

const idsArg = (single: unknown, many: unknown): string[] | undefined => {
  const out = [...((many as string[] | undefined) ?? []), ...(single !== undefined ? [String(single)] : [])]
  return out.length ? [...new Set(out)] : undefined
}

const cursorProp = str('Opaque pagination token. Omit on the first request; on later pages pass back the exact `next_cursor` string from the prior response. Never construct or send an empty cursor.')

// ---------------------------------------------------------------------------
// list_time_entries
// ---------------------------------------------------------------------------

const listTimeEntries: Tool = {
  name: 'list_time_entries',
  description:
    'List time entries, most recent first. Defaults to the last 30 days (account timezone) when `from`/`to` are omitted. `hours` is the tracked duration (running timers include elapsed time); when the account rounds time, `rounded_hours` is the same duration under the rounding rule. Each entry carries two independent status fields: `billable` (whether the work CAN be billed) and `is_invoiced` (whether it HAS been put on an invoice — draft or sent; `invoice_id` says which). Neither is `is_closed`, which is approval status. To answer invoiced vs. uninvoiced hours, read `is_invoiced` or pass the `is_invoiced` filter. Returns `limit` entries per page (default 100, max 500); when `truncated` is true, pass `next_cursor` back via `cursor` with all other parameters identical. Authorization is enforced server-side: a Member gets `forbidden` for `user_ids` other than their own; a Project Manager gets only entries on projects they manage (plus their own) and `scope_limited: true` — an empty or partial page then does not mean nobody logged time.',
  inputSchema: obj({
    from: date('Inclusive start date (YYYY-MM-DD).'),
    to: date('Inclusive end date (YYYY-MM-DD).'),
    user_ids: ids('User ids to filter to. Omit to include everyone you’re allowed to see.'),
    user_id: id('Deprecated single-id alias of `user_ids`.'),
    project_ids: ids('Project ids to filter to. Omit to include all projects.'),
    project_id: id('Deprecated single-id alias of `project_ids`.'),
    is_invoiced: bool('true → only entries on an invoice; false → only uninvoiced entries. Omit for both.'),
    limit: int('Page size, whole number 1–500. Omit to use the default of 100.', { minimum: 1, maximum: MAX_LIMIT }),
    cursor: cursorProp,
  }),
  write: false,
  async handler(args, ctx) {
    const { from, to } = await rangeArgs(ctx, args)
    const userIds = idsArg(args.user_id, args.user_ids)
    const projectIds = idsArg(args.project_id, args.project_ids)
    const limit = limitOf(args.limit)
    const scope = timeReadScope(ctx.actor)
    const { and, scopeLimited } = await scopeWhere(ctx, scope, userIds)
    if (projectIds) and.push({ projectId: { in: projectIds } })
    if (args.is_invoiced === true) and.push({ OR: [{ invoiceLineItemId: { not: null } }, { lockState: 'invoiced' }] })
    if (args.is_invoiced === false) and.push({ invoiceLineItemId: null, lockState: { not: 'invoiced' } })
    const fp = filterFingerprint({ t: 'time', from: ymdOf(from), to: ymdOf(to), userIds, projectIds, inv: args.is_invoiced, limit })
    if (args.cursor !== undefined) {
      const pos = decodeCursor<{ d?: string; id?: string }>(String(args.cursor), fp)
      const d = pos.d ? dateArg(pos.d, 'cursor') : undefined
      if (!d || typeof pos.id !== 'string') throw invalid('cursor: not a valid cursor.')
      // Keyset: (spentDate, id) strictly after the last row of the previous page, in DESC order.
      and.push({ OR: [{ spentDate: { lt: d } }, { spentDate: d, id: { lt: pos.id } }] })
    }
    const rows = await prisma.timeEntry.findMany({
      where: { accountId: ctx.user.accountId, spentDate: { gte: from, lte: to }, AND: and },
      select: ENTRY_SELECT,
      orderBy: [{ spentDate: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })
    const rounding = await roundingOf(ctx.user.accountId)
    const { page, truncated, next_cursor } = pageOf(rows, limit, (last) => ({ d: ymdOf(last.spentDate), id: last.id }), fp)
    return {
      time_entries: page.map((e) => entryRow(e, ctx.now, rounding)),
      from: ymdOf(from),
      to: ymdOf(to),
      limit,
      truncated,
      next_cursor,
      scope_limited: scopeLimited,
    }
  },
}

// ---------------------------------------------------------------------------
// get_running_timer
// ---------------------------------------------------------------------------

const getRunningTimer: Tool = {
  name: 'get_running_timer',
  description:
    'Return the time entry whose timer is currently running for you, or — for managers/admins — another team member via `user_id`. `running_timer` is null if no timer is active. A Member gets `forbidden` for anyone else. A Project Manager sees another person’s timer only when it is on a project they manage; otherwise `running_timer` is null with `scope_limited: true` — that means "you cannot see it", not "they are idle".',
  inputSchema: obj({ user_id: id('User whose running timer to check. Defaults to you.') }),
  write: false,
  async handler(args, ctx) {
    const target = args.user_id !== undefined ? String(args.user_id) : ctx.user.userId
    const scope = timeReadScope(ctx.actor)
    const { and, scopeLimited } = await scopeWhere(ctx, scope, [target])
    const e = await prisma.timeEntry.findFirst({
      where: { accountId: ctx.user.accountId, userId: target, isRunning: true, AND: and },
      select: ENTRY_SELECT,
    })
    return { running_timer: e ? entryRow(e, ctx.now, await roundingOf(ctx.user.accountId)) : null, scope_limited: !e && scopeLimited }
  },
}

// ---------------------------------------------------------------------------
// log_time / start_timer / stop_timer
// ---------------------------------------------------------------------------

/** Whose time this call acts on, re-authorized exactly like the timesheet (never trusts the id). */
async function subjectFor(ctx: McpContext, requested: unknown, projectId: string, verb: string): Promise<string> {
  const want = requested !== undefined ? String(requested) : undefined
  const userId = await resolveSubjectUserId(ctx.user, want)
  if (!userId) throw forbidden(`You can’t ${verb} for that person.`)
  if (!(await mayActForOnProject(ctx.user, userId, projectId))) throw forbidden(`You can’t ${verb} for that person on this project (you don’t manage it).`)
  return userId
}

const logTimeTool: Tool = {
  name: 'log_time',
  description:
    'Log a completed time entry for yourself, or — for managers/admins — another team member via `user_id`. Use this for past time you already know the duration of; to track time as it elapses use `start_timer`. Provide EITHER `hours` (decimal, e.g. 1.5; stored as whole minutes) OR `started_time` + `ended_time` (e.g. "9:00am" to "11:00am"), from which the duration is derived (Track2 stores durations, not clock times). `spent_at` defaults to today in the account timezone. The project must be active and the person assigned to it and the task (see list_project_assignments). The billable flag and rate are derived by Track2, never set directly.',
  inputSchema: obj(
    {
      project_id: id('Project id.'),
      task_id: id('Task id (must be assigned to the project).'),
      spent_at: date('Date the work was performed (YYYY-MM-DD). Defaults to today in the account timezone.'),
      hours: num('Hours worked as a decimal (e.g. 1.5). Provide this OR started_time + ended_time.'),
      started_time: str('Clock-in time, e.g. "9:00am" or "14:30". Provide together with ended_time instead of hours.'),
      ended_time: str('Clock-out time, e.g. "11:00am". Required alongside started_time.'),
      notes: str('Notes describing the work. Required when get_account_settings reports `notes_required`.'),
      user_id: id('Log on behalf of another user. Requires permission to edit their time on this project; defaults to you.'),
    },
    ['project_id', 'task_id'],
  ),
  write: true,
  async handler(args, ctx) {
    const projectId = String(args.project_id)
    const taskId = String(args.task_id)
    const minutes = durationMinutes(args as { hours?: number; started_time?: string; ended_time?: string }, true)!
    const userId = await subjectFor(ctx, args.user_id, projectId, 'log time')
    const notes = (args.notes as string | undefined)?.trim() || undefined
    if (!notes && (await notesRequired(ctx.user.accountId))) throw invalid('notes: this account requires notes on every time entry.', { field: 'notes' })
    const notLoggable = await checkLoggable(prisma, { accountId: ctx.user.accountId, userId, projectId, taskId })
    if (notLoggable) throw loggableError(notLoggable)
    const spentDate = dateArg(args.spent_at, 'spent_at') ?? (await accountToday(ctx))
    const entry = await logTime(prisma, { userId, projectId, taskId, spentDate, minutes, notes, actorUserId: ctx.user.userId })
    return loadEntry(ctx, entry.id)
  },
}

const startTimerTool: Tool = {
  name: 'start_timer',
  description:
    'Start a running timer on a project + task, for yourself or — for managers/admins — another team member via `user_id`. The entry is dated today in the account timezone. If that person already has a running timer it is stopped first (Track2 allows one running timer per person); starting the same project + task again within seconds is a no-op. Returns the running time entry.',
  inputSchema: obj(
    {
      project_id: id('Project id.'),
      task_id: id('Task id (must be assigned to the project).'),
      notes: str('Notes describing the work. Required when get_account_settings reports `notes_required`.'),
      user_id: id('Start the timer on behalf of another user. Requires permission to edit their time; defaults to you.'),
    },
    ['project_id', 'task_id'],
  ),
  write: true,
  async handler(args, ctx) {
    const { accountId } = ctx.user
    const projectId = String(args.project_id)
    const taskId = String(args.task_id)
    const userId = await subjectFor(ctx, args.user_id, projectId, 'start a timer')
    const notes = (args.notes as string | undefined)?.trim() || null
    if (!notes && (await notesRequired(accountId))) throw invalid('notes: this account requires notes on every time entry.', { field: 'notes' })
    const notLoggable = await checkLoggable(prisma, { accountId, userId, projectId, taskId })
    if (notLoggable) throw loggableError(notLoggable)
    if (userId !== ctx.user.userId) {
      const running = await prisma.timeEntry.findFirst({ where: { accountId, userId, isRunning: true }, select: { projectId: true } })
      if (running && !(await mayActForOnProject(ctx.user, userId, running.projectId))) {
        throw forbidden('Their running timer is on a project you don’t manage, so it can’t be replaced.')
      }
    }
    const { timezone } = await getAccountClock(accountId)
    const { entry, alreadyRunning } = await startTimer(prisma, { userId, projectId, taskId, now: ctx.now, timezone, notes, actorUserId: ctx.user.userId })
    return { ...(await loadEntry(ctx, entry.id)), already_running: alreadyRunning }
  },
}

const stopTimerTool: Tool = {
  name: 'stop_timer',
  description:
    'Stop your currently running timer. If `time_entry_id` is provided it must be your running entry; otherwise whichever timer you have running is stopped. A single run is capped at 12 hours. Returns the stopped time entry, or a `validation_failed` error if no timer is running.',
  inputSchema: obj({ time_entry_id: id('Specific time entry to stop. Optional.') }),
  write: true,
  idempotent: true,
  async handler(args, ctx) {
    const { accountId, userId } = ctx.user
    const running = await prisma.timeEntry.findFirst({ where: { accountId, userId, isRunning: true }, select: { id: true } })
    if (args.time_entry_id !== undefined && running?.id !== String(args.time_entry_id)) {
      const exists = await prisma.timeEntry.findFirst({ where: { id: String(args.time_entry_id), accountId, userId }, select: { id: true } })
      if (!exists) throw notFound('Time entry')
      throw invalid('That time entry is not running.')
    }
    if (!running) throw invalid('No timer is running.')
    const stopped = await stopTimer(prisma, { userId, now: ctx.now, actorUserId: userId })
    if (!stopped) throw invalid('No timer is running.')
    return loadEntry(ctx, stopped.id)
  },
}

// ---------------------------------------------------------------------------
// update_time_entry / delete_time_entry
// ---------------------------------------------------------------------------

/** The entry, if the caller may edit it (own, or a person + project in their scope); else not_found (Harvest). */
async function editableEntry(ctx: McpContext, entryId: string) {
  const e = await prisma.timeEntry.findFirst({
    where: { id: entryId, accountId: ctx.user.accountId },
    select: { id: true, userId: true, projectId: true, taskId: true },
  })
  if (!e || !(await mayActForOnProject(ctx.user, e.userId, e.projectId))) throw notFound('Time entry')
  return e
}

const updateTimeEntryTool: Tool = {
  name: 'update_time_entry',
  description:
    'Update a time entry’s hours, notes, project, task, or date — your own, or a teammate’s whose time you can edit (an admin, or a Project Manager on a project they manage). You get `not_found` for an entry you’re not allowed to edit. Set the duration with EITHER `hours` OR `started_time` + `ended_time`. Approved or invoiced entries (including entries on a draft invoice) and running timers can’t be edited: `validation_failed`. Moving to another project/task re-derives the billable flag and rate; the person must be assigned there. To remove an entry use `delete_time_entry`.',
  inputSchema: obj(
    {
      id: id('Id of the time entry to update (from list_time_entries).'),
      hours: num('New hours value (decimal, > 0). Provide this OR started_time + ended_time.'),
      started_time: str('New clock-in time, e.g. "9:00am". Provide together with ended_time instead of hours.'),
      ended_time: str('New clock-out time, e.g. "11:00am".'),
      notes: str('Replacement notes.'),
      project_id: id('Move to a different project.'),
      task_id: id('Move to a different task.'),
      spent_at: date('Move to a different date (YYYY-MM-DD).'),
    },
    ['id'],
  ),
  write: true,
  idempotent: true,
  async handler(args, ctx) {
    const e = await editableEntry(ctx, String(args.id))
    const minutes = durationMinutes(args as { hours?: number; started_time?: string; ended_time?: string }, false)
    const projectId = args.project_id !== undefined ? String(args.project_id) : undefined
    const taskId = args.task_id !== undefined ? String(args.task_id) : undefined
    if (projectId && projectId !== e.projectId && !(await mayActForOnProject(ctx.user, e.userId, projectId))) {
      throw forbidden('You can’t move this entry to a project you don’t manage.')
    }
    if ((projectId && projectId !== e.projectId) || (taskId && taskId !== e.taskId)) {
      const notLoggable = await checkLoggable(prisma, { accountId: ctx.user.accountId, userId: e.userId, projectId: projectId ?? e.projectId, taskId: taskId ?? e.taskId })
      if (notLoggable) throw loggableError(notLoggable)
    }
    let notes: string | null | undefined
    if (args.notes !== undefined) {
      notes = String(args.notes).trim() || null
      if (!notes && (await notesRequired(ctx.user.accountId))) throw invalid('notes: this account requires notes on every time entry.', { field: 'notes' })
    }
    const spentDate = dateArg(args.spent_at, 'spent_at')
    if (minutes === undefined && notes === undefined && !projectId && !taskId && !spentDate) throw invalid('Nothing to update — pass hours, notes, project_id, task_id or spent_at.')
    const r = await updateTimeEntry(prisma, {
      accountId: ctx.user.accountId,
      actorUserId: ctx.user.userId,
      entryId: e.id,
      patch: { minutes, notes, projectId, taskId, spentDate },
    })
    if (!r.ok) throw r.reason === 'not_found' ? notFound('Time entry') : invalid(EDIT_REFUSAL_MESSAGE[r.reason])
    return loadEntry(ctx, e.id)
  },
}

const deleteTimeEntryTool: Tool = {
  name: 'delete_time_entry',
  description:
    'Permanently delete a time entry — your own, or a teammate’s whose time you can edit. You get `not_found` for an entry you’re not allowed to delete. Approved or invoiced entries (including entries on a draft invoice) can’t be deleted: `validation_failed` — Track2 has no admin override (invoiced/approved time is immutable). Someone else’s running timer must be stopped first. To zero out hours, delete the entry rather than updating it to 0.',
  inputSchema: obj({ id: id('Id of the time entry to delete (from list_time_entries).') }, ['id']),
  write: true,
  destructive: true,
  async handler(args, ctx) {
    const e = await editableEntry(ctx, String(args.id))
    const r = await deleteTimeEntry(prisma, { accountId: ctx.user.accountId, actorUserId: ctx.user.userId, entryId: e.id })
    if (!r.ok) throw r.reason === 'not_found' ? notFound('Time entry') : invalid(r.reason === 'running' ? 'Stop their timer before deleting this entry.' : EDIT_REFUSAL_MESSAGE[r.reason])
    return { id: e.id, deleted: true }
  },
}

// ---------------------------------------------------------------------------
// get_time_report
// ---------------------------------------------------------------------------

type ReportRaw = { key: string; name: string | null; code?: string | null; cid?: string | null; cname?: string | null; minutes: number; bmin: number; imin: number; bcents: number }

const getTimeReport: Tool = {
  name: 'get_time_report',
  description:
    'Aggregate time over a date range, grouped by project, client, user (or task — Track2 extra). Each row carries `total_hours`, `billable_hours`, `non_billable_hours`, `invoiced_hours` and `uninvoiced_hours`, plus the group’s id and display name (`project_name` / `client_name` / `user_name` / `task_name`). The billable split and the invoiced split are independent: `invoiced_hours` is time put on an invoice (draft or sent), `uninvoiced_hours` is the rest. `billable_amount` (hours × stored rate) is included only if you can see billable rates. A `totals` object sums every field. Results are scoped server-side to what you may see (Members: own time; Project Managers: own + managed projects) and `scope_limited` says so — only an explicit `forbidden` error is a denial. Same aggregation as Track2’s Reports › Time.',
  inputSchema: obj(
    {
      from: date('Inclusive start date (YYYY-MM-DD).'),
      to: date('Inclusive end date (YYYY-MM-DD).'),
      group_by: str('Grouping dimension. Defaults to project.', { enum: ['project', 'client', 'user', 'task'] }),
      include_zero_hour_users: bool('Only with group_by=user: also return zero-hour rows for visible active team members who logged nothing.'),
    },
    ['from', 'to'],
  ),
  write: false,
  async handler(args, ctx) {
    const from = dateArg(args.from, 'from')!
    const to = dateArg(args.to, 'to')!
    if (from > to) throw invalid('from must be on or before to.', { field: 'from' })
    const groupBy = (args.group_by as string | undefined) ?? 'project'
    if (args.include_zero_hour_users && groupBy !== 'user') throw invalid('include_zero_hour_users: only valid with group_by=user.', { field: 'include_zero_hour_users' })
    const { accountId, userId } = ctx.user
    const scope = timeReadScope(ctx.actor)
    let scopeSql = Prisma.empty
    if (scope === 'self') scopeSql = Prisma.sql`AND te."userId" = ${userId}`
    if (scope === 'managed') {
      const managed = [...((await managedProjectIdsFor(ctx.user)) ?? new Set<string>())]
      scopeSql = managed.length
        ? Prisma.sql`AND (te."userId" = ${userId} OR te."projectId" IN (${Prisma.join(managed)}))`
        : Prisma.sql`AND te."userId" = ${userId}`
    }
    const filter = Prisma.sql`te."accountId" = ${accountId} AND te."spentDate" >= ${from} AND te."spentDate" <= ${to} ${scopeSql}`
    const metrics = Prisma.sql`
      SUM(te.minutes)::int AS minutes,
      SUM(CASE WHEN te."isBillable" THEN te.minutes ELSE 0 END)::int AS bmin,
      SUM(CASE WHEN te."invoiceLineItemId" IS NOT NULL OR te."lockState"::text = 'invoiced' THEN te.minutes ELSE 0 END)::int AS imin,
      SUM(CASE WHEN te."isBillable" THEN te.minutes/60.0*COALESCE(te."billableRateCents",0) ELSE 0 END)::float8 AS bcents`
    let raw: ReportRaw[]
    if (groupBy === 'client') {
      raw = await prisma.$queryRaw<ReportRaw[]>`SELECT c.id AS key, c.name AS name, ${metrics}
        FROM "TimeEntry" te JOIN "Project" p ON p.id = te."projectId" JOIN "Client" c ON c.id = p."clientId"
        WHERE ${filter} GROUP BY c.id, c.name ORDER BY c.name`
    } else if (groupBy === 'user') {
      raw = await prisma.$queryRaw<ReportRaw[]>`SELECT u.id AS key, trim(u."firstName" || ' ' || u."lastName") AS name, ${metrics}
        FROM "TimeEntry" te JOIN "User" u ON u.id = te."userId"
        WHERE ${filter} GROUP BY u.id, u."firstName", u."lastName" ORDER BY 2`
    } else if (groupBy === 'task') {
      raw = await prisma.$queryRaw<ReportRaw[]>`SELECT t.id AS key, t.name AS name, ${metrics}
        FROM "TimeEntry" te JOIN "Task" t ON t.id = te."taskId"
        WHERE ${filter} GROUP BY t.id, t.name ORDER BY t.name`
    } else {
      raw = await prisma.$queryRaw<ReportRaw[]>`SELECT p.id AS key, p.name AS name, p.code AS code, c.id AS cid, c.name AS cname, ${metrics}
        FROM "TimeEntry" te JOIN "Project" p ON p.id = te."projectId" JOIN "Client" c ON c.id = p."clientId"
        WHERE ${filter} GROUP BY p.id, p.name, p.code, c.id, c.name ORDER BY c.name, p.name`
    }
    const rates = canSeeRates(ctx.actor)
    const metricsOf = (minutes: number, bmin: number, imin: number, bcents: number) => ({
      total_hours: hoursOf(minutes),
      billable_hours: hoursOf(bmin),
      non_billable_hours: hoursOf(minutes - bmin),
      invoiced_hours: hoursOf(imin),
      uninvoiced_hours: hoursOf(minutes - imin),
      ...(rates ? { billable_amount: Math.round(bcents) / 100 } : {}),
    })
    const rows: Record<string, unknown>[] = raw.map((r) => {
      const m = metricsOf(Number(r.minutes), Number(r.bmin), Number(r.imin), Number(r.bcents))
      if (groupBy === 'client') return { client_id: r.key, client_name: r.name, ...m }
      if (groupBy === 'user') return { user_id: r.key, user_name: r.name, ...m }
      if (groupBy === 'task') return { task_id: r.key, task_name: r.name, ...m }
      return { project_id: r.key, project_name: r.name, project_code: r.code ?? null, client_id: r.cid, client_name: r.cname, ...m }
    })
    if (groupBy === 'user' && args.include_zero_hour_users) {
      const seen = new Set(raw.map((r) => r.key))
      const people =
        scope === 'all'
          ? await prisma.user.findMany({ where: { accountId, isActive: true }, select: { id: true, firstName: true, lastName: true } }).then((us) => us.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() })))
          : scope === 'managed'
            ? await listActablePeople(ctx.user)
            : [{ id: userId, name: '' }]
      for (const p of people) {
        if (seen.has(p.id)) continue
        const name = p.name || (await prisma.user.findUnique({ where: { id: p.id }, select: { firstName: true, lastName: true } }).then((u) => (u ? `${u.firstName} ${u.lastName}`.trim() : '')))
        rows.push({ user_id: p.id, user_name: name, ...metricsOf(0, 0, 0, 0) })
      }
    }
    const tot = raw.reduce((a, r) => ({ m: a.m + Number(r.minutes), b: a.b + Number(r.bmin), i: a.i + Number(r.imin), c: a.c + Number(r.bcents) }), { m: 0, b: 0, i: 0, c: 0 })
    return {
      from: ymdOf(from),
      to: ymdOf(to),
      group_by: groupBy,
      rows,
      totals: metricsOf(tot.m, tot.b, tot.i, tot.c),
      scope_limited: scope !== 'all',
    }
  },
}

export const timeTools: Tool[] = [
  listTimeEntries,
  getRunningTimer,
  getTimeReport,
  logTimeTool,
  startTimerTool,
  stopTimerTool,
  updateTimeEntryTool,
  deleteTimeEntryTool,
]
