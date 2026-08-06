import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatMinutes } from '@/modules/shared/duration'
import { startOfWeekMonday, addDays, ymd, parseYmd, sameDay } from '@/lib/week'
import { LogTimeForm } from '@/components/LogTimeForm'
import { EntryRow } from '@/components/EntryRow'
import { stopTimerAction } from '@/app/timesheet/actions'
import { requireUser } from '@/lib/session'

const timeFmt = (d: Date) =>
  new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d)

export const dynamic = 'force-dynamic'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default async function TimesheetPage({
  searchParams,
}: {
  searchParams: { week?: string }
}) {
  const { userId } = await requireUser()
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } })

  // Default to the week containing the user's most recent entry, so there's data to see.
  let anchor = parseYmd(searchParams.week)
  if (!anchor) {
    const latest = await prisma.timeEntry.aggregate({ where: { userId }, _max: { spentDate: true } })
    anchor = latest._max.spentDate ?? new Date()
  }
  const monday = startOfWeekMonday(anchor)
  const sunday = addDays(monday, 6)
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))

  const entries = await prisma.timeEntry.findMany({
    where: { userId, spentDate: { gte: monday, lte: sunday } },
    include: { project: { select: { name: true, code: true } }, task: { select: { name: true } } },
  })

  // Projects (with their tasks) this user may log against, to populate the log-time form.
  const assignments = await prisma.projectUserAssignment.findMany({
    where: { userId, isActive: true },
    select: {
      project: {
        select: {
          id: true,
          name: true,
          taskAssignments: { where: { isActive: true }, select: { task: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: { project: { name: 'asc' } },
  })
  const projectOptions = assignments.map((a) => ({
    id: a.project.id,
    name: a.project.name,
    tasks: a.project.taskAssignments.map((ta) => ta.task),
  }))

  // Any running timer for this user (shown regardless of the viewed week).
  const running = await prisma.timeEntry.findFirst({
    where: { userId, isRunning: true },
    include: { project: { select: { name: true, code: true } }, task: { select: { name: true } } },
  })

  // Group into rows keyed by project+task; each row holds minutes per weekday.
  type Row = { key: string; projectLabel: string; taskName: string; perDay: number[]; total: number }
  const rows = new Map<string, Row>()
  for (const e of entries) {
    const key = `${e.projectId}|${e.taskId}`
    let row = rows.get(key)
    if (!row) {
      row = {
        key,
        projectLabel: `${e.project.code ? `[${e.project.code}] ` : ''}${e.project.name}`,
        taskName: e.task.name,
        perDay: [0, 0, 0, 0, 0, 0, 0],
        total: 0,
      }
      rows.set(key, row)
    }
    const dayIdx = days.findIndex((d) => sameDay(d, e.spentDate))
    if (dayIdx >= 0) row.perDay[dayIdx] += e.minutes
    row.total += e.minutes
  }
  const rowList = [...rows.values()]
  const dayTotals = days.map((_, i) => rowList.reduce((s, r) => s + r.perDay[i], 0))
  const weekTotal = dayTotals.reduce((s, n) => s + n, 0)

  const prevWeek = ymd(addDays(monday, -7))
  const nextWeek = ymd(addDays(monday, 7))

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Timesheet</h1>
        <span className="text-sm text-gray-500">
          {user ? `${user.firstName} ${user.lastName}` : userId}
        </span>
      </div>
      <p className="mb-4 text-xs text-gray-400">
        Read-only week view · scoped to a demo user until auth lands · live from Supabase
      </p>

      <div className="mb-4 flex items-center gap-2 text-sm">
        <NavLink href={`/timesheet?week=${prevWeek}&user=${userId}`}>← Prev</NavLink>
        <span className="rounded border border-gray-200 bg-white px-3 py-1">
          {formatRange(monday, sunday)}
        </span>
        <NavLink href={`/timesheet?week=${nextWeek}&user=${userId}`}>Next →</NavLink>
      </div>

      {running && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-brand-orange bg-orange-50 px-4 py-3">
          <div className="text-sm">
            <span className="font-medium text-brand-orange">▶ Timer running</span>
            <span className="ml-2 text-gray-700">
              {running.project.code ? `[${running.project.code}] ` : ''}
              {running.project.name} · {running.task.name}
            </span>
            {running.timerStartedAt && (
              <span className="ml-2 text-xs text-gray-500">since {timeFmt(running.timerStartedAt)} UTC</span>
            )}
          </div>
          <form action={stopTimerAction}>
            <input type="hidden" name="userId" value={userId} />
            <button className="rounded bg-brand-orange px-3 py-1 text-sm font-medium text-white hover:opacity-90">
              ■ Stop
            </button>
          </form>
        </div>
      )}

      <div className="mb-4">
        <LogTimeForm projects={projectOptions} userId={userId} defaultDate={ymd(monday)} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 text-left font-medium">Project / Task</th>
              {days.map((d, i) => (
                <th key={i} className="px-2 py-3 text-right font-medium">
                  {WEEKDAYS[i]}
                  <div className="font-normal normal-case text-gray-300">{d.getUTCMonth() + 1}/{d.getUTCDate()}</div>
                </th>
              ))}
              <th className="px-4 py-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rowList.map((r) => (
              <tr key={r.key} className="border-b border-gray-100">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{r.projectLabel}</div>
                  <div className="text-xs text-gray-500">{r.taskName}</div>
                </td>
                {r.perDay.map((m, i) => (
                  <td key={i} className="px-2 py-3 text-right tabular-nums text-gray-700">
                    {m ? formatMinutes(m) : <span className="text-gray-300">·</span>}
                  </td>
                ))}
                <td className="px-4 py-3 text-right font-medium tabular-nums">{formatMinutes(r.total)}</td>
              </tr>
            ))}
            {rowList.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                  No time logged this week.
                </td>
              </tr>
            )}
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

      {/* Individual entries this week, with lock-guarded delete */}
      {entries.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Entries this week</h2>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
            {entries
              .slice()
              .sort((a, b) => a.spentDate.getTime() - b.spentDate.getTime())
              .map((e) => (
                <EntryRow
                  key={e.id}
                  entry={{
                    id: e.id,
                    dateLabel: `${e.spentDate.getUTCMonth() + 1}/${e.spentDate.getUTCDate()}`,
                    projectLabel: `${e.project.code ? `[${e.project.code}] ` : ''}${e.project.name}`,
                    taskName: e.task.name,
                    notes: e.notes,
                    isBillable: e.isBillable,
                    isRunning: e.isRunning,
                    lockState: e.lockState,
                    minutes: e.minutes,
                    durationValue: formatMinutes(e.minutes),
                    minutesLabel: formatMinutes(e.minutes),
                    userId,
                  }}
                />
              ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded border border-gray-200 bg-white px-3 py-1 text-gray-600 hover:text-brand-orange">
      {children}
    </Link>
  )
}

function formatRange(a: Date, b: Date): string {
  const f = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
  return `${f(a)} – ${f(b)} ${b.getUTCFullYear()}`
}
