'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { startTimerAction, stopTimerAction } from '@/app/timesheet/actions'
import type { TopBarProject, TopBarRunning } from '@/lib/topbar'
import { TimeEntryModal } from '@/components/TimeEntryModal'

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

/* ---------- project + task cascading selects (shared) ---------- */
function ProjectTaskSelects({ projects }: { projects: TopBarProject[] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const tasks = projects.find((p) => p.id === projectId)?.tasks ?? []
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Project / Task</span>
        <select name="projectId" value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputCls}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <select name="taskId" className={inputCls}>
        {tasks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </>
  )
}

/* ---------- running-timer pill (live elapsed + stop) ---------- */
function RunningPill({ running }: { running: TopBarRunning }) {
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

  return (
    <div className="flex items-center gap-2 rounded-full bg-brand-teal-50 py-1 pl-3 pr-1 text-sm">
      <span className="hidden max-w-[220px] truncate text-gray-600 sm:inline" title={`${running.projectLabel} · ${running.taskName}`}>
        {running.projectLabel} · {running.taskName}
      </span>
      <span className="font-mono font-semibold tabular-nums text-brand-teal">{clock}</span>
      <form action={stopTimerAction}>
        <button
          title="Stop timer"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-teal text-white hover:opacity-90"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect width="10" height="10" rx="1.5" /></svg>
        </button>
      </form>
    </div>
  )
}

/* ---------- main ---------- */
type Panel = 'timer' | 'track' | 'more' | null

export function TopBar({
  projects,
  running,
  canManageInvoices,
  today,
}: {
  projects: TopBarProject[]
  running: TopBarRunning | null
  canManageInvoices: boolean
  today: string
}) {
  const pathname = usePathname()
  const [panel, setPanel] = useState<Panel>(null)
  const ref = useRef<HTMLDivElement>(null)

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
    <div className="sticky top-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white/90 px-8 py-3 backdrop-blur">
      <h2 className="text-sm font-semibold text-gray-700">{titleFor(pathname)}</h2>

      <div className="flex items-center gap-2" ref={ref}>
        {running ? (
          <RunningPill running={running} />
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
                  <form action={startTimerAction} className="space-y-2">
                    <ProjectTaskSelects projects={projects} />
                    <input name="notes" placeholder="Notes (optional)" className={`${inputCls} w-full`} />
                    <div className="flex items-center gap-2 pt-1">
                      <button className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">
                        Start timer
                      </button>
                      <button type="button" onClick={() => setPanel(null)} className="text-sm text-gray-500 hover:text-gray-700">
                        Cancel
                      </button>
                    </div>
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
      <TimeEntryModal open={panel === 'track'} onClose={() => setPanel(null)} projects={projects} defaultDate={today} />
    </div>
  )
}
