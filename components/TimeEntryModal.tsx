'use client'

import { useEffect, useMemo, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { logTimeAction, startTimerAction, type LogTimeState } from '@/app/timesheet/actions'
import { Combobox } from '@/components/Combobox'
import {
  defaultTaskId,
  projectComboOptions,
  taskComboOptions,
  type TimeEntryProject,
} from '@/lib/timeEntryProjects'

export type { TimeEntryProject }

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

/**
 * Harvest's project -> task pickers: the project list is grouped by client and filters as you type;
 * the task list follows the chosen project (and resets to its first task when the project changes).
 * Posts `projectId` / `taskId` like the old <select>s. Shared with the top-bar Timer popover.
 */
export function ProjectTaskPicker({ projects }: { projects: TimeEntryProject[] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const projectOptions = useMemo(() => projectComboOptions(projects), [projects])
  const taskOptions = useMemo(() => taskComboOptions(projects, projectId), [projects, projectId])
  return (
    <div className="space-y-2">
      <Combobox
        name="projectId"
        options={projectOptions}
        defaultValue={projectId}
        placeholder="Choose a project…"
        emptyText="No matching projects"
        required
        onValueChange={setProjectId}
        aria-label="Project"
      />
      <Combobox
        // Remount on project change so the task resets to the new project's first task.
        key={projectId}
        name="taskId"
        options={taskOptions}
        defaultValue={defaultTaskId(projects, projectId)}
        placeholder={taskOptions.length ? 'Choose a task…' : 'No tasks on this project'}
        emptyText="No matching tasks"
        required
        disabled={taskOptions.length === 0}
        aria-label="Task"
      />
    </div>
  )
}

function PrimaryButton({ hasDuration }: { hasDuration: boolean }) {
  const { pending } = useFormStatus()
  // With a duration entered the green button logs the entry; empty → it starts a timer (Harvest).
  // On a teammate's timesheet the timer is theirs (forUserId is posted and re-authorized server-side).
  const startsTimer = !hasDuration
  return (
    <button
      type="submit"
      formAction={startsTimer ? startTimerAction : undefined}
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Saving…' : startsTimer ? 'Start timer' : 'Log time'}
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
  forUser,
}: {
  open: boolean
  onClose: () => void
  projects: TimeEntryProject[]
  defaultDate: string
  /** Logging on someone else's timesheet (person switcher). Re-authorized server-side. */
  forUser?: { id: string; name: string }
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
          <h3 className="text-base font-semibold text-gray-800">
            New time entry{forUser && <span className="font-normal text-gray-500"> for {forUser.name}</span>}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            ✕
          </button>
        </div>

        {noProjects ? (
          <p className="text-sm text-gray-400">
            {forUser
              ? `${forUser.name} has no active projects assigned.`
              : 'No projects assigned to you yet — ask a manager to add you to a project.'}
          </p>
        ) : (
          <form action={formAction} className="space-y-4">
            {forUser && <input type="hidden" name="forUserId" value={forUser.id} />}
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700">Date</span>
              <input type="date" name="spentDate" defaultValue={defaultDate} className={input} />
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700">Project / Task</span>
              <ProjectTaskPicker projects={projects} />
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
