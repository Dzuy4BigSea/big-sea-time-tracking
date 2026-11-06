import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveAppUrl } from '@/lib/appUrl'
import { decryptSecretMap } from '@/lib/integrations'
import { getAccountClock } from '@/lib/accountClock'
import { currentUserForToken, type CurrentUser } from '@/lib/session'
import { actorOf, loggableProjectsFor, managedProjectIdsFor } from '@/lib/timesheetSubject'
import { todayYmdIn } from '@/lib/tz'
import { getAsanaTask, getAsanaUserEmail, type AsanaTaskInfo } from '@/modules/integrations/asanaClient'
import { ASANA, asanaTaskUrl, safePermalink, type ExternalRef } from '@/modules/integrations/externalRef'
import { checkGet, checkPost, corsHeaders, SIGNATURE_HEADER, type AsanaCall } from '@/modules/integrations/asanaApp/request'
import { asanaAppConfig, ASANA_APP_BASE_PATH, type AsanaAppConfig } from '@/modules/integrations/asanaApp/oauth'
import { orderTasks, type FormState, type FormValues, type Option } from '@/modules/integrations/asanaApp/form'
import { computeTimerMinutes } from '@/modules/time/timeEntry'
import { formatMinutes } from '@/modules/shared/duration'
import { timeReadScope } from '@/modules/mcp/scope'

/**
 * Server glue for the Asana app (specs/29): request checks, account + person resolution, and the data
 * the form and widget need. The rules live in modules/integrations/asanaApp/*.
 */

export interface AsanaAppContext {
  cfg: AsanaAppConfig
  call: AsanaCall
  accountId: string
  /** The account's Asana token (Settings → Integrations → Asana), for task/user lookups. */
  token: string | null
  appUrl: string
  now: Date
}

export function asanaJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' } })
}

export function asanaPreflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() })
}

/**
 * Verify an Asana call and resolve its account, then run `fn`. 503 when the app isn't configured,
 * 400 for a bad signature / expired / malformed call (AC-ASANAAPP-001), 404 for an unknown workspace
 * (AC-ASANAAPP-002). Unexpected errors → 500 with no detail.
 */
export async function handleAsanaCall(req: Request, fn: (ctx: AsanaAppContext) => Promise<Response>): Promise<Response> {
  const cfg = asanaAppConfig()
  if (!cfg) return asanaJson({ error: 'The Track2 Asana app isn’t configured.' }, 503)
  const now = new Date()
  const sig = req.headers.get(SIGNATURE_HEADER)
  const checked =
    req.method === 'POST'
      ? checkPost(await req.text(), sig, cfg.clientSecret, now.getTime())
      : checkGet(new URL(req.url).search.slice(1), sig, cfg.clientSecret, now.getTime())
  if (!checked.ok) return asanaJson({ error: 'Invalid request.' }, 400)

  const account = await accountForWorkspace(checked.call.workspace)
  if (!account) return asanaJson({ error: 'This Asana workspace isn’t connected to Track2.' }, 404)
  try {
    return await fn({ cfg, call: checked.call, accountId: account.accountId, token: account.token, appUrl: resolveAppUrl(), now })
  } catch (e) {
    console.error('[asana-app]', (e as Error).message?.slice(0, 300))
    return asanaJson({ error: 'Track2 couldn’t do that. Try again.' }, 500)
  }
}

/** The account whose shared Asana connection is for this workspace (INV-5). */
async function accountForWorkspace(workspaceGid: string): Promise<{ accountId: string; token: string | null } | null> {
  const rows = await prisma.integrationConnection.findMany({
    where: { provider: 'asana', entityId: null },
    select: { accountId: true, config: true, externalOrgId: true, secretsEnc: true },
  })
  const matches = rows.filter((r) => {
    const cfg = (r.config as Record<string, unknown> | null) ?? {}
    return String(cfg.workspaceGid ?? r.externalOrgId ?? '').trim() === workspaceGid
  })
  if (matches.length !== 1) return null // none, or ambiguous: never guess the tenant
  const r = matches[0]
  return { accountId: r.accountId, token: decryptSecretMap(r.secretsEnc).accessToken || null }
}

/**
 * The Track2 person for an Asana user (AC-ASANAAPP-003): by saved gid, else by the Asana user's email
 * (looked up with the account's token) and the gid is saved. Null when there's no active match.
 */
export async function personForAsanaUser(ctx: AsanaAppContext): Promise<CurrentUser | null> {
  const gid = ctx.call.user
  const byGid = await prisma.user.findFirst({ where: { accountId: ctx.accountId, asanaUserGid: gid, isActive: true }, select: { id: true } })
  if (byGid) return currentUserForToken({ userId: byGid.id, accountId: ctx.accountId })
  if (!ctx.token) return null
  const email = await getAsanaUserEmail(ctx.token, gid)
  if (!email) return null
  const byEmail = await prisma.user.findFirst({
    where: { accountId: ctx.accountId, isActive: true, email: { equals: email, mode: 'insensitive' } },
    select: { id: true, asanaUserGid: true },
  })
  if (!byEmail) return null
  await linkAsanaUser(ctx.accountId, byEmail.id, gid)
  return currentUserForToken({ userId: byEmail.id, accountId: ctx.accountId })
}

/** Save the gid on one person and clear it from anyone else in the account (one Asana user ↔ one person). */
export async function linkAsanaUser(accountId: string, userId: string, asanaUserGid: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.updateMany({ where: { accountId, asanaUserGid, id: { not: userId } }, data: { asanaUserGid: null } }),
    prisma.user.updateMany({ where: { accountId, id: userId }, data: { asanaUserGid } }),
  ])
}

export function appUrls(appUrl: string) {
  const base = `${appUrl}${ASANA_APP_BASE_PATH}`
  return { projects: `${base}/projects`, change: `${base}/change`, submit: `${base}/submit`, link: `${base}/auth` }
}

/** The Asana task (name/projects/link) when the token allows, else what the gid alone gives. */
export async function asanaTaskFor(ctx: AsanaAppContext): Promise<AsanaTaskInfo | null> {
  const gid = ctx.call.task
  if (!gid) return null
  return (ctx.token ? await getAsanaTask(ctx.token, gid) : null) ?? { gid, name: '', projectGids: [], permalink: null }
}

/** The link stored on entries tracked from this Asana task. */
export function externalRefFor(task: AsanaTaskInfo): ExternalRef {
  const group = task.projectGids[0] ?? null
  return { externalService: ASANA, externalId: task.gid, externalGroupId: group, externalPermalink: safePermalink(task.permalink) ?? asanaTaskUrl(task.gid, group) }
}

const projectTitle = (p: { name: string; code: string | null }) => (p.code ? `[${p.code}] ${p.name}` : p.name)

/** Typeahead items: the person's loggable projects matching the query (client, project or code). */
export async function projectItems(me: CurrentUser, query: string | null) {
  const q = (query ?? '').trim().toLowerCase()
  const projects = await loggableProjectsFor(me.userId)
  return projects
    .filter((p) => p.tasks.length && (!q || `${p.clientName} ${p.name} ${p.code ?? ''}`.toLowerCase().includes(q)))
    .slice(0, 30)
    .map((p) => ({ title: projectTitle(p), subtitle: p.clientName, value: p.id }))
}

/** Active tasks on a loggable project, the person's recently used first. Empty if not loggable. */
export async function taskOptions(me: CurrentUser, projectId: string | null): Promise<Option[]> {
  if (!projectId) return []
  const project = (await loggableProjectsFor(me.userId)).find((p) => p.id === projectId)
  if (!project) return []
  const recent = await prisma.timeEntry.findMany({
    where: { accountId: me.accountId, userId: me.userId, projectId },
    orderBy: { spentDate: 'desc' },
    select: { taskId: true },
    take: 50,
  })
  return orderTasks(project.tasks.map((t) => ({ id: t.id, label: t.name })), [...new Set(recent.map((r) => r.taskId))])
}

/**
 * Default project/task (AC-ASANAAPP-004): the person's last entry on this Asana task, else anyone's
 * last entry on the same Asana project, else the Track2 project imported from that Asana project.
 * Only projects the person can log to qualify.
 */
async function defaultProjectTask(me: CurrentUser, task: AsanaTaskInfo | null): Promise<{ projectId: string; taskId: string | null } | null> {
  const loggable = await loggableProjectsFor(me.userId)
  const ok = new Map(loggable.map((p) => [p.id, p]))
  const pick = (row: { projectId: string; taskId: string } | null) => {
    if (!row || !ok.has(row.projectId)) return null
    const p = ok.get(row.projectId)!
    return { projectId: row.projectId, taskId: p.tasks.some((t) => t.id === row.taskId) ? row.taskId : null }
  }
  if (!task) return null
  const sel = { projectId: true, taskId: true } as const
  const mine = await prisma.timeEntry.findFirst({
    where: { accountId: me.accountId, userId: me.userId, externalService: ASANA, externalId: task.gid, projectId: { in: [...ok.keys()] } },
    orderBy: [{ spentDate: 'desc' }, { createdAt: 'desc' }],
    select: sel,
  })
  if (pick(mine)) return pick(mine)
  if (task.projectGids.length) {
    const anyone = await prisma.timeEntry.findFirst({
      where: { accountId: me.accountId, externalService: ASANA, externalGroupId: { in: task.projectGids }, projectId: { in: [...ok.keys()] } },
      orderBy: [{ spentDate: 'desc' }, { createdAt: 'desc' }],
      select: sel,
    })
    if (pick(anyone)) return pick(anyone)
    const imported = await prisma.project.findFirst({
      where: { accountId: me.accountId, asanaProjectGid: { in: task.projectGids }, id: { in: [...ok.keys()] } },
      select: { id: true },
    })
    if (imported) return { projectId: imported.id, taskId: null }
  }
  return null
}

export async function runningTimerFor(me: CurrentUser, taskGid: string | null, now: Date) {
  const r = await prisma.timeEntry.findFirst({
    where: { accountId: me.accountId, userId: me.userId, isRunning: true },
    select: { minutes: true, timerStartedAt: true, externalService: true, externalId: true, project: { select: { name: true } }, task: { select: { name: true } } },
  })
  if (!r) return null
  const mins = r.minutes + (r.timerStartedAt ? computeTimerMinutes(r.timerStartedAt, now) : 0)
  return {
    label: `${r.project.name} · ${r.task.name} (${formatMinutes(mins)})`,
    onThisTask: !!taskGid && r.externalService === ASANA && r.externalId === taskGid,
  }
}

/** The form's starting values for this person and Asana task. */
export async function initialValues(me: CurrentUser, task: AsanaTaskInfo | null, now: Date): Promise<FormValues> {
  const [clock, def] = await Promise.all([getAccountClock(me.accountId), defaultProjectTask(me, task)])
  let projectTitleText: string | null = null
  let projectSubtitle: string | null = null
  if (def) {
    const p = (await loggableProjectsFor(me.userId)).find((x) => x.id === def.projectId)
    if (p) {
      projectTitleText = projectTitle(p)
      projectSubtitle = p.clientName
    }
  }
  return {
    projectId: def?.projectId ?? null,
    projectTitle: projectTitleText,
    projectSubtitle,
    taskId: def?.taskId ?? null,
    notes: task?.name ?? '',
    hours: '',
    date: todayYmdIn(clock.timezone, now),
  }
}

/** Values for fields Asana didn't send (hidden ones): nothing chosen, date = the account's today. */
export async function baseValues(me: CurrentUser, now: Date): Promise<FormValues> {
  const clock = await getAccountClock(me.accountId)
  return { projectId: null, projectTitle: null, projectSubtitle: null, taskId: null, notes: '', hours: '', date: todayYmdIn(clock.timezone, now) }
}

/** Everything buildForm needs, for an already-resolved person and values. */
export async function formState(ctx: AsanaAppContext, me: CurrentUser | null, values: FormValues | null, extra: Partial<FormState> = {}): Promise<FormState> {
  const urls = appUrls(ctx.appUrl)
  const blank: FormValues = { projectId: null, projectTitle: null, projectSubtitle: null, taskId: null, notes: '', hours: '', date: '' }
  if (!me) return { linked: false, linkUrl: urls.link, values: values ?? blank, tasks: [], running: null, urls, ...extra }
  const [running, tasks, totalLine] = await Promise.all([
    runningTimerFor(me, ctx.call.task, ctx.now),
    extra.tasks ? Promise.resolve(extra.tasks) : taskOptions(me, values?.projectId ?? null),
    ctx.call.task ? taskTotalLine(me, ctx.call.task, ctx.now) : Promise.resolve(null),
  ])
  return { linked: true, linkUrl: urls.link, values: values ?? blank, tasks, running, totalLine, urls, ...extra }
}

/** "14:00 tracked to this task" for the form's footer, as Harvest's popup shows (null when none). */
export async function taskTotalLine(me: CurrentUser, taskGid: string, now: Date): Promise<string | null> {
  const n = await widgetNumbers(me, taskGid, now)
  if (!n.entryCount) return null
  const total = `${formatMinutes(n.visibleMinutes, n.display)}${n.display === 'decimal' ? ' h' : ''}`
  return n.everyone ? `${total} tracked to this task in Track2` : `${total} tracked by you to this task in Track2`
}

/**
 * Entries on an Asana task the viewer may see: everyone's for people who see others' time, own + managed
 * projects for project managers, else their own (modules/mcp/scope).
 */
export async function visibleTaskEntries(me: CurrentUser, taskGid: string) {
  const scope = timeReadScope(actorOf(me))
  const base = { accountId: me.accountId, externalService: ASANA, externalId: taskGid }
  let visible: Prisma.TimeEntryWhereInput = { ...base, userId: me.userId }
  if (scope === 'all') visible = base
  else if (scope === 'managed') {
    const managed = (await managedProjectIdsFor(me)) ?? new Set<string>()
    visible = { ...base, OR: [{ userId: me.userId }, { projectId: { in: [...managed] } }] }
  }
  return { scope, base, visible }
}

/** Widget numbers for an Asana task, limited to what the viewer may see (AC-ASANAAPP-009). */
export async function widgetNumbers(me: CurrentUser, taskGid: string, now: Date) {
  const { scope, base, visible } = await visibleTaskEntries(me, taskGid)

  const [agg, own, running, account] = await Promise.all([
    prisma.timeEntry.aggregate({ where: visible, _sum: { minutes: true }, _count: true, _max: { spentDate: true } }),
    prisma.timeEntry.aggregate({ where: { ...base, userId: me.userId }, _sum: { minutes: true } }),
    prisma.timeEntry.findMany({
      where: { ...visible, isRunning: true },
      select: { userId: true, timerStartedAt: true, user: { select: { firstName: true, lastName: true } } },
      take: 20,
    }),
    prisma.account.findUnique({ where: { id: me.accountId }, select: { timeDisplay: true } }),
  ])
  const live = running.reduce((m, r) => m + (r.timerStartedAt ? computeTimerMinutes(r.timerStartedAt, now) : 0), 0)
  const ownLive = running.filter((r) => r.userId === me.userId).reduce((m, r) => m + (r.timerStartedAt ? computeTimerMinutes(r.timerStartedAt, now) : 0), 0)
  return {
    visibleMinutes: (agg._sum.minutes ?? 0) + live,
    everyone: scope !== 'self',
    ownMinutes: (own._sum.minutes ?? 0) + ownLive,
    entryCount: agg._count,
    runningNames: running.map((r) => (r.userId === me.userId ? 'you' : `${r.user.firstName} ${r.user.lastName}`.trim())),
    lastDate: agg._max.spentDate ? agg._max.spentDate.toISOString().slice(0, 10) : null,
    display: (account?.timeDisplay ?? 'hh_mm') as 'hh_mm' | 'decimal',
  }
}
