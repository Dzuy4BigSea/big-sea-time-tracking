'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { startTimerAction, stopTimerAction, type TimerState } from '@/app/timesheet/actions'
import { todayYmdIn } from '@/lib/tz'
import type { TopBarProject, TopBarRunning } from '@/lib/topbar'
import { ProjectTaskPicker, TimeEntryModal } from '@/components/TimeEntryModal'
import { GlobalSearch } from '@/components/GlobalSearch'

// Route prefix → section title shown on the left of the bar.
const TITLES: { prefix: string; title: string }[] = [
  { prefix: '/timesheet', title: 'Timesheet' },
  { prefix: '/expenses', title: 'Expenses' },
  { prefix: '/team', title: 'Team' },
  { prefix: '/clients', title: 'Clients' },
  { prefix: '/projects', title: 'Projects' },
  { prefix: '/tasks', title: 'Tasks' },
  { prefix: '/invoices', title: 'Invoices' },
  { prefix: '/reports', title: 'Reports' },
]

function titleFor(pathname: string): string {
  if (pathname === '/') return 'Home'
  return TITLES.find((t) => pathname.startsWith(t.prefix))?.title ?? 'Track2'
}

const inputCls = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

/* ---------- icons ---------- */
function IconStopwatch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 13V9M9 2h6M12 5V2" />
    </svg>
  )
}
function IconClock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}
function IconDoc() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  )
}
function IconMore() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
    </svg>
  )
}

/* ---------- running-timer pill (live elapsed + stop) ---------- */
function RunningPill({
  running,
  timezone,
  stopAction,
  onStop,
}: {
  running: TopBarRunning
  timezone: string
  stopAction: (formData: FormData) => void
  onStop: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const startedAt = new Date(running.startedAtISO).getTime()
  const totalSec = running.baseMinutes * 60 + Math.max(0, Math.floor((now - startedAt) / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const clock = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  // Left running since a previous day (in the account timezone)? Warn: it's probably forgotten.
  const fromPreviousDay = todayYmdIn(timezone, new Date(startedAt)) < todayYmdIn(timezone, new Date(now))

  return (
    <div
      className={`flex items-center gap-2 rounded-full py-1 pl-3 pr-1 text-sm ${fromPreviousDay ? 'bg-amber-50 ring-1 ring-amber-400' : 'bg-brand-teal-50'}`}
    >
      {fromPreviousDay && (
        <span className="text-xs font-medium text-amber-800" title="This timer was started on a previous day. Stop it and check the time.">
          ⚠ Started {todayYmdIn(timezone, new Date(startedAt))}
        </span>
      )}
      <span className="hidden max-w-[220px] truncate text-gray-600 sm:inline" title={`${running.projectLabel} · ${running.taskName}`}>
        {running.projectLabel} · {running.taskName}
      </span>
      <span className="font-mono font-semibold tabular-nums text-brand-teal">{clock}</span>
      {/* Optimistic: the pill hides on submit; the server result restores it on error. */}
      <form action={stopAction} onSubmit={onStop}>
        <button
          title="Stop timer"
          aria-label="Stop timer"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-teal text-white hover:opacity-90"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect width="10" height="10" rx="1.5" /></svg>
        </button>
      </form>
    </div>
  )
}

function StartTimerSubmit() {
  const { pending } = useFormStatus()
  return (
    <button
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Starting…' : 'Start timer'}
    </button>
  )
}

/* ---------- main ---------- */
type Panel = 'timer' | 'track' | 'more' | null

export function TopBar({
  projects,
  running,
  canManageInvoices,
  timezone,
}: {
  projects: TopBarProject[]
  running: TopBarRunning | null
  canManageInvoices: boolean
  /** Account timezone: default dates and the "started on a previous day" warning use it. */
  timezone: string
}) {
  const pathname = usePathname()
  const [panel, setPanel] = useState<Panel>(null)
  const ref = useRef<HTMLDivElement>(null)

  const [startState, startAction] = useFormState<TimerState, FormData>(startTimerAction, {})
  const [stopState, stopAction] = useFormState<TimerState, FormData>(stopTimerAction, {})
  // Optimistic stop: hide the pill for this entry as soon as Stop is clicked.
  const [stoppedId, setStoppedId] = useState<string | null>(null)
  useEffect(() => {
    if (stopState.error) setStoppedId(null)
  }, [stopState])
  useEffect(() => {
    if (startState.ok) setPanel(null)
  }, [startState])
  const shownRunning = running && running.id !== stoppedId ? running : null

  // Close panels on route change.
  useEffect(() => setPanel(null), [pathname])
  // Outside-click closes the anchored popovers (not the modal, which has its own backdrop).
  useEffect(() => {
    if (panel !== 'timer' && panel !== 'more') return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPanel(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [panel])

  const noProjects = projects.length === 0
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p))

  return (
    <div className="sticky top-0 z-20 flex items-center gap-4 border-b border-gray-200 bg-white/90 px-8 py-3 backdrop-blur">
      <h2 className="hidden shrink-0 text-sm font-semibold text-gray-700 lg:block">{titleFor(pathname)}</h2>

      <div className="flex flex-1 justify-center">
        <GlobalSearch />
      </div>

      <div className="flex shrink-0 items-center gap-2" ref={ref}>
        {stopState.error && shownRunning && (
          <span role="alert" className="text-xs text-red-600">{stopState.error}</span>
        )}
        {shownRunning ? (
          <RunningPill running={shownRunning} timezone={timezone} stopAction={stopAction} onStop={() => setStoppedId(shownRunning.id)} />
        ) : (
          <div className="relative">
            <button
              onClick={() => toggle('timer')}
              className="flex items-center gap-1.5 rounded-full bg-brand-teal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              aria-haspopup="dialog"
              aria-expanded={panel === 'timer'}
            >
              <IconStopwatch /> Timer
            </button>
            {panel === 'timer' && (
              <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
                <div className="mb-2 text-sm font-semibold text-gray-800">Start timer</div>
                {noProjects ? (
                  <p className="text-sm text-gray-400">No projects assigned to you yet.</p>
                ) : (
                  <form action={startAction} className="space-y-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-wide text-gray-400">Project / Task</span>
                      <ProjectTaskPicker projects={projects} />
                    </div>
                    <input name="notes" placeholder="Notes (optional)" className={`${inputCls} w-full`} />
                    <div className="flex items-center gap-2 pt-1">
                      <StartTimerSubmit />
                      <button type="button" onClick={() => setPanel(null)} className="text-sm text-gray-500 hover:text-gray-700">
                        Cancel
                      </button>
                    </div>
                    {startState.error && <p role="alert" className="text-xs text-red-600">{startState.error}</p>}
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {/* Track time (clock) */}
        <button
          onClick={() => toggle('track')}
          title="Track time"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
        >
          <IconClock />
        </button>

        {/* Create invoice (document) */}
        {canManageInvoices && (
          <Link
            href="/invoices"
            title="Create invoice"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            <IconDoc />
          </Link>
        )}

        {/* More actions */}
        <div className="relative">
          <button
            onClick={() => toggle('more')}
            title="More actions"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
            aria-haspopup="menu"
            aria-expanded={panel === 'more'}
          >
            <IconMore />
          </button>
          {panel === 'more' && (
            <div role="menu" className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              <Link href="/expenses" role="menuitem" className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                Track expenses
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Shared "New time entry" dialog (the clock button) — distinct from the Timer popover above */}
      <TimeEntryModal open={panel === 'track'} onClose={() => setPanel(null)} projects={projects} defaultDate={panel === 'track' ? todayYmdIn(timezone) : ''} />
    </div>
  )
}
