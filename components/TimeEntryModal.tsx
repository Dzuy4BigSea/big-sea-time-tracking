'use client'

import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { logTimeAction, startTimerAction, type LogTimeState } from '@/app/timesheet/actions'

export interface TimeEntryProject {
  id: string
  name: string
  tasks: { id: string; name: string }[]
}

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

function ProjectTaskSelects({ projects }: { projects: TimeEntryProject[] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const tasks = projects.find((p) => p.id === projectId)?.tasks ?? []
  return (
    <div className="space-y-2">
      <select
        name="projectId"
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        className={`${input} w-full`}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select name="taskId" className={`${input} w-full`}>
        {tasks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function PrimaryButton({ hasDuration }: { hasDuration: boolean }) {
  const { pending } = useFormStatus()
  // With a duration entered the green button logs the entry; empty → it starts a timer (Harvest).
  return (
    <button
      type="submit"
      formAction={hasDuration ? undefined : startTimerAction}
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Saving…' : hasDuration ? 'Log time' : 'Start timer'}
    </button>
  )
}

/**
 * Harvest's "New time entry" dialog — the shared time-tracking interface used by the
 * top-bar clock and the timesheet. Date · Project/Task · Notes + duration · Start timer/Log.
 */
export function TimeEntryModal({
  open,
  onClose,
  projects,
  defaultDate,
}: {
  open: boolean
  onClose: () => void
  projects: TimeEntryProject[]
  defaultDate: string
}) {
  const [state, formAction] = useFormState<LogTimeState, FormData>(logTimeAction, {})
  const [duration, setDuration] = useState('')

  useEffect(() => {
    if (state.ok) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  if (!open) return null
  const noProjects = projects.length === 0
  const hasDuration = duration.trim() !== '' && duration.trim() !== '0:00'

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-4 pt-24" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">New time entry</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            ✕
          </button>
        </div>

        {noProjects ? (
          <p className="text-sm text-gray-400">No projects assigned to you yet — ask a manager to add you to a project.</p>
        ) : (
          <form action={formAction} className="space-y-4">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700">Date</span>
              <input type="date" name="spentDate" defaultValue={defaultDate} className={input} />
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700">Project / Task</span>
              <ProjectTaskSelects projects={projects} />
            </div>

            <div className="flex gap-2">
              <textarea
                name="notes"
                rows={3}
                placeholder="Notes (optional)"
                className={`${input} flex-1 resize-none`}
              />
              <input
                name="duration"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="0:00"
                className={`${input} w-20 self-stretch text-right text-lg`}
                aria-label="Duration"
              />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <PrimaryButton hasDuration={hasDuration} />
              <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
                Cancel
              </button>
              {state.error && <span className="text-sm text-red-600">{state.error}</span>}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
