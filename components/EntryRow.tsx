'use client'

import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { updateTimeEntryAction, deleteTimeEntryAction, type EditTimeState } from '@/app/timesheet/actions'

export interface EntryRowData {
  id: string
  dateLabel: string
  projectLabel: string
  taskName: string
  notes: string | null
  isBillable: boolean
  isRunning: boolean
  lockState: string
  minutes: number
  durationValue: string // pre-filled H:MM for the edit field
  minutesLabel: string
  userId: string
}

const input = 'rounded border border-gray-300 px-2 py-1 text-sm'

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded bg-brand-green px-2 py-0.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
  )
}

export function EntryRow({ entry }: { entry: EntryRowData }) {
  const [editing, setEditing] = useState(false)
  const [state, formAction] = useFormState<EditTimeState, FormData>(updateTimeEntryAction, {})

  // Close the editor once a save succeeds.
  useEffect(() => {
    if (state.ok) setEditing(false)
  }, [state])

  const editable = entry.lockState === 'open' && !entry.isRunning

  if (editing) {
    return (
      <li className="px-4 py-2">
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="entryId" value={entry.id} />
          <span className="w-12 shrink-0 text-gray-400">{entry.dateLabel}</span>
          <span className="min-w-0 flex-1 text-gray-700">
            <span className="font-medium text-gray-900">{entry.projectLabel}</span>
            <span className="text-gray-500"> · {entry.taskName}</span>
          </span>
          <input
            name="notes"
            defaultValue={entry.notes ?? ''}
            placeholder="notes"
            className={`${input} w-40`}
          />
          <input name="duration" defaultValue={entry.durationValue} className={`${input} w-16 text-right`} />
          <SaveButton />
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="shrink-0 rounded px-2 py-0.5 text-xs text-gray-400 hover:text-gray-600"
          >
            Cancel
          </button>
          {state.error && <span className="w-full text-xs text-red-600">{state.error}</span>}
        </form>
      </li>
    )
  }

  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <span className="w-12 shrink-0 text-gray-400">{entry.dateLabel}</span>
      <span className="min-w-0 flex-1">
        <span className="font-medium text-gray-900">{entry.projectLabel}</span>
        <span className="text-gray-500"> · {entry.taskName}</span>
        {entry.notes && <span className="text-gray-400"> — {entry.notes}</span>}
      </span>
      {!entry.isBillable && <span className="shrink-0 text-xs text-gray-400">non-billable</span>}
      <span className="w-14 shrink-0 text-right tabular-nums">
        {entry.isRunning ? <span className="text-brand-teal">▶ running</span> : entry.minutesLabel}
      </span>
      {editable ? (
        <>
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            Edit
          </button>
          <form action={deleteTimeEntryAction}>
            <input type="hidden" name="entryId" value={entry.id} />
            <input type="hidden" name="userId" value={entry.userId} />
            <button className="shrink-0 rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600">
              Delete
            </button>
          </form>
        </>
      ) : (
        <span className="w-12 shrink-0 text-right text-xs text-gray-300" title={`Locked: ${entry.lockState}`}>
          🔒
        </span>
      )}
    </li>
  )
}
