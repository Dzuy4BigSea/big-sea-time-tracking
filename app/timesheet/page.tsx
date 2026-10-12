import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatMinutes } from '@/modules/shared/duration'
import { addDays, ymd, sameDay, weekdayShort, dayMonth, weekNavLabel, dayNavLabel } from '@/lib/week'
import { resolveTimesheetNav, timesheetUrl, navQuery, type TimesheetNav } from '@/lib/timesheetNav'
import { TimeEntryButton } from '@/components/TimeEntryButton'
import { EntryRow, type EntryRowData } from '@/components/EntryRow'
import { stopTimerAction } from '@/app/timesheet/actions'
import { requireUser } from '@/lib/session'
import { requireModule } from '@/lib/modules'
import { listActablePeople, loggableProjectsFor, managedProjectIdsFor, resolveSubjectUserId } from '@/lib/timesheetSubject'
import { TimesheetPersonSwitcher } from '@/components/TimesheetPersonSwitcher'
import { toTimeEntryProject } from '@/lib/timeEntryProjects'

const timeFmt = (d: Date) =>
  new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d)

export const dynamic = 'force-dynamic'

/** Harvest's row label: "[CODE] Project name (Client)". */
const projectLabel = (p: { name: string; code: string | null; client: { name: string } | null }) =>
  `${p.code ? `[${p.code}] ` : ''}${p.name}${p.client ? ` (${p.client.name})` : ''}`

const projectSelect = { select: { name: true, code: true, client: { select: { name: true } } } } as const

export default async function TimesheetPage({
  searchParams,
}: {
  searchParams: { week?: string; user?: string; view?: string; date?: string }
}) {
  const current = await requireUser()
  const { accountId } = current
  await requireModule(accountId, 'timeTracking')
  // Whose timesheet: ?user=<id> when the actor may act for that person (view_edit_others_time,
  // scope + tenancy re-checked server-side); anything else falls back to the actor's own.
  const userId = (await resolveSubjectUserId(current, searchParams.user)) ?? current.userId
  const isSelf = userId === current.userId
  const [user, account, people] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, type: true } }),
    prisma.account.findUnique({ where: { id: accountId }, select: { weekStartsOn: true } }),
    listActablePeople(current),
  ])
  const userName = user ? `${user.firstName} ${user.lastName}`.trim() : userId
  // The switcher lists active people; keep a permitted-but-archived subject selectable too.
  if (people.length > 0 && !people.some((p) => p.id === userId)) {
    people.push({ id: userId, name: userName, type: user?.type ?? 'employee' })
  }
  const weekStartsOn = (account?.weekStartsOn ?? 'monday') as 'monday' | 'sunday'

  // Open on the current week, as Harvest does; ?week= navigates elsewhere, ?view=day&date= is the Day view.
  const nav = resolveTimesheetNav(searchParams, new Date(), weekStartsOn)
  const { weekStart, weekEnd, days } = nav
  const subjectParam = isSelf ? undefined : userId

  // Bounded to one person's week (indexed on userId, spentDate); the Day view filters this in memory.
  const entries = await prisma.timeEntry.findMany({
    where: { accountId, userId, spentDate: { gte: weekStart, lte: weekEnd } },
    include: { project: projectSelect, task: { select: { name: true } } },
    orderBy: [{ spentDate: 'asc' }, { createdAt: 'asc' }],
  })

  // Active projects (with their tasks) this user may log against, to populate the log-time form.
  // Archived projects / clients are excluded (BugHerd #1).
  // On someone else's sheet a project manager only acts on projects they manage (null = no limit).
  const managed = isSelf ? null : await managedProjectIdsFor(current)
  const projectOptions = (await loggableProjectsFor(userId))
    .filter((p) => managed === null || managed.has(p.id))
    .map(toTimeEntryProject)

  // Any running timer for this user (shown regardless of the viewed week).
  const running = await prisma.timeEntry.findFirst({
    where: { accountId, userId, isRunning: true },
    include: { project: projectSelect, task: { select: { name: true } } },
  })

  // Group into rows keyed by project+task; each row holds minutes per weekday.
  type Row = { key: string; projectLabel: string; taskName: string; perDay: number[]; total: number }
  const rows = new Map<string, Row>()
  for (const e of entries) {
    const key = `${e.projectId}|${e.taskId}`
    let row = rows.get(key)
    if (!row) {
      row = { key, projectLabel: projectLabel(e.project), taskName: e.task.name, perDay: [0, 0, 0, 0, 0, 0, 0], total: 0 }
      rows.set(key, row)
    }
    const dayIdx = days.findIndex((d) => sameDay(d, e.spentDate))
    if (dayIdx >= 0) row.perDay[dayIdx] += e.minutes
    row.total += e.minutes
  }
  const rowList = [...rows.values()]
  const dayTotals = days.map((_, i) => rowList.reduce((s, r) => s + r.perDay[i], 0))
  const weekTotal = dayTotals.reduce((s, n) => s + n, 0)

  // On a teammate's sheet a project manager may stop their timer only on a project they manage.
  const canStopRunning = !!running && (managed === null || managed.has(running.projectId))

  const toRowData = (e: (typeof entries)[number]): EntryRowData => ({
    id: e.id,
    dateLabel: `${e.spentDate.getUTCMonth() + 1}/${e.spentDate.getUTCDate()}`,
    projectLabel: projectLabel(e.project),
    taskName: e.task.name,
    notes: e.notes,
    isBillable: e.isBillable,
    isRunning: e.isRunning,
    lockState: e.lockState,
    minutes: e.minutes,
    durationValue: formatMinutes(e.minutes),
    minutesLabel: formatMinutes(e.minutes),
    userId,
    canEdit: managed === null || managed.has(e.projectId),
  })

  const isDay = nav.view === 'day'
  const prevHref = isDay ? timesheetUrl({ day: addDays(nav.date, -1) }, subjectParam) : timesheetUrl({ week: addDays(weekStart, -7) }, subjectParam)
  const nextHref = isDay ? timesheetUrl({ day: addDays(nav.date, 1) }, subjectParam) : timesheetUrl({ week: addDays(weekStart, 7) }, subjectParam)
  const navLabel = isDay ? dayNavLabel(nav.date, nav.isToday) : weekNavLabel(weekStart, weekEnd, nav.isCurrentWeek)
  // "Resume editing your own timesheet" keeps the same view and date.
  const ownHref = isDay ? timesheetUrl({ day: nav.date }) : timesheetUrl({ week: weekStart })

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{isSelf ? 'Timesheet' : `${userName}’s timesheet`}</h1>
          {!isSelf && (
            // Harvest: a notice while you're on someone else's timesheet.
            <p role="status" className="mt-1 text-sm text-amber-800">
              Changes will save to {userName}’s timesheet.{' '}
              <Link href={ownHref} className="font-medium text-blue-600 underline hover:no-underline">
                Resume editing your own timesheet
              </Link>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle nav={nav} userId={subjectParam} />
          {/* Harvest's "Teammates" switcher, top-right; only for people who may act for others. */}
          {people.length > 1 && (
            <TimesheetPersonSwitcher people={people} selectedId={userId} selfId={current.userId} query={navQuery(nav)} />
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <div className="inline-flex items-stretch overflow-hidden rounded-full border border-gray-300 bg-white">
          <Link
            href={prevHref}
            aria-label={isDay ? 'Previous day' : 'Previous week'}
            className="px-3 py-1.5 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          >
            ←
          </Link>
          <span className="border-x border-gray-300 px-4 py-1.5 font-medium text-gray-900">{navLabel}</span>
          <Link
            href={nextHref}
            aria-label={isDay ? 'Next day' : 'Next week'}
            className="px-3 py-1.5 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          >
            →
          </Link>
        </div>
        {isDay && !nav.isToday && (
          <Link href={timesheetUrl({ today: true }, subjectParam)} className="text-blue-600 underline hover:no-underline">
            Return to today
          </Link>
        )}
        {!isDay && !nav.isCurrentWeek && (
          <Link href={timesheetUrl({ thisWeek: true }, subjectParam)} className="text-blue-600 underline hover:no-underline">
            Return to this week
          </Link>
        )}
      </div>

      {running && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-brand-teal bg-brand-teal-50 px-4 py-3">
          <div className="text-sm">
            <span className="font-medium text-brand-teal">▶ Timer running</span>
            <span className="ml-2 text-gray-700">
              {projectLabel(running.project)} · {running.task.name}
            </span>
            {running.timerStartedAt && (
              <span className="ml-2 text-xs text-gray-500">since {timeFmt(running.timerStartedAt)} UTC</span>
            )}
          </div>
          {/* On a teammate's sheet the timer is theirs to stop too (re-authorized server-side). */}
          {canStopRunning && (
            <form action={stopTimerAction}>
              {!isSelf && <input type="hidden" name="forUserId" value={userId} />}
              <button className="rounded bg-brand-teal px-3 py-1 text-sm font-medium text-white hover:opacity-90">
                ■ Stop
              </button>
            </form>
          )}
        </div>
      )}

      <div className="mb-4">
        <TimeEntryButton
          key={`${userId}|${ymd(nav.date)}`}
          projects={projectOptions}
          defaultDate={ymd(nav.date)}
          forUser={isSelf ? undefined : { id: userId, name: userName }}
        />
      </div>

      {isDay ? (
        <DayView nav={nav} userId={subjectParam} dayTotals={dayTotals} weekTotal={weekTotal}>
          {(() => {
            const dayEntries = entries.filter((e) => sameDay(e.spentDate, nav.date))
            const dayTotal = dayEntries.reduce((s, e) => s + e.minutes, 0)
            if (dayEntries.length === 0) {
              return <EmptyState title="No time tracked on this day" />
            }
            return (
              <div className="rounded-lg border border-gray-200 bg-white text-sm">
                <ul className="divide-y divide-gray-100">
                  {dayEntries.map((e) => (
                    <EntryRow key={e.id} entry={toRowData(e)} layout="day" />
                  ))}
                </ul>
                <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 font-semibold">
                  <span className="text-gray-500">Total:</span>
                  <span className="tabular-nums text-gray-900">{formatMinutes(dayTotal)}</span>
                </div>
              </div>
            )
          })()}
        </DayView>
      ) : rowList.length === 0 ? (
        <EmptyState title="No time tracked this week" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500">
                  <th className="px-4 py-3 text-left font-medium" />
                  {days.map((d, i) => {
                    const today = sameDay(d, nav.today)
                    return (
                      <th key={i} className="px-2 py-3 text-right font-medium">
                        <Link
                          href={timesheetUrl({ day: d }, subjectParam)}
                          className={`block hover:text-gray-900 ${today ? 'text-gray-900' : ''}`}
                          title="Open day view"
                        >
                          <div className="font-semibold">{weekdayShort(d)}</div>
                          <div className="font-normal">{dayMonth(d)}</div>
                        </Link>
                      </th>
                    )
                  })}
                  <th className="px-4 py-3 text-right align-bottom font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {rowList.map((r) => (
                  <tr key={r.key} className="border-b border-gray-100">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{r.projectLabel}</div>
                      <div className="text-gray-600">{r.taskName}</div>
                    </td>
                    {r.perDay.map((m, i) => (
                      <td key={i} className="px-2 py-3 text-right tabular-nums text-gray-700">
                        {m ? formatMinutes(m) : <span className="text-gray-300">·</span>}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{formatMinutes(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 font-medium">
                  <td className="px-4 py-3 text-right text-xs uppercase tracking-wide text-gray-400">Daily total</td>
                  {dayTotals.map((m, i) => (
                    <td key={i} className="px-2 py-3 text-right tabular-nums text-gray-700">
                      {m ? formatMinutes(m) : <span className="text-gray-300">·</span>}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right tabular-nums">{formatMinutes(weekTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Individual entries this week, with lock-guarded edit / delete */}
          <div className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">Entries this week</h2>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
              {entries.map((e) => (
                <EntryRow key={e.id} entry={toRowData(e)} />
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

/** Harvest's [Day | Week] segmented toggle; the active segment is peach with an orange border. */
function ViewToggle({ nav, userId }: { nav: TimesheetNav; userId?: string }) {
  const seg = (active: boolean) =>
    `border px-3 py-1.5 text-sm font-medium ${
      active ? 'relative z-10 border-orange-400 bg-orange-50 text-gray-900' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
    }`
  return (
    <div role="group" aria-label="Timesheet view" className="inline-flex">
      <Link
        href={timesheetUrl({ day: nav.date }, userId)}
        aria-current={nav.view === 'day' ? 'page' : undefined}
        className={`${seg(nav.view === 'day')} rounded-l-md`}
      >
        Day
      </Link>
      <Link
        href={timesheetUrl({ week: nav.weekStart }, userId)}
        aria-current={nav.view === 'week' ? 'page' : undefined}
        className={`${seg(nav.view === 'week')} -ml-px rounded-r-md`}
      >
        Week
      </Link>
    </div>
  )
}

/** Day view: Mon..Sun tabs with each day's total (active underlined orange) and the week total. */
function DayView({
  nav,
  userId,
  dayTotals,
  weekTotal,
  children,
}: {
  nav: TimesheetNav
  userId?: string
  dayTotals: number[]
  weekTotal: number
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-4 flex items-end gap-1 overflow-x-auto border-b border-gray-200 text-sm">
        {nav.days.map((d, i) => {
          const active = sameDay(d, nav.date)
          return (
            <Link
              key={i}
              href={timesheetUrl({ day: d }, userId)}
              aria-current={active ? 'date' : undefined}
              className={`-mb-px min-w-[4.5rem] border-b-2 px-3 py-2 text-center ${
                active ? 'border-orange-500 font-semibold text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              <div>{weekdayShort(d)}</div>
              <div className="tabular-nums">{formatMinutes(dayTotals[i])}</div>
            </Link>
          )
        })}
        <div className="ml-auto shrink-0 px-3 py-2 text-right">
          <div className="text-gray-500">Week total</div>
          <div className="font-semibold tabular-nums text-gray-900">{formatMinutes(weekTotal)}</div>
        </div>
      </div>
      {children}
    </div>
  )
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      <div className="text-base font-medium text-gray-700">{title}</div>
      <p className="mt-1 text-sm text-gray-500">Use “+ New time entry” above to log time against a project.</p>
    </div>
  )
}
