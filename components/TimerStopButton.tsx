'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { stopTimerAction, type TimerState } from '@/app/timesheet/actions'

function StopSubmit() {
  const { pending } = useFormStatus()
  return (
    <button
      disabled={pending}
      className="rounded bg-brand-teal px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Stopping…' : '■ Stop'}
    </button>
  )
}

/** The timesheet's "■ Stop" for the running timer: disabled while pending, shows a server error. */
export function TimerStopButton({ forUserId }: { forUserId?: string }) {
  const [state, action] = useFormState<TimerState, FormData>(stopTimerAction, {})
  return (
    <form action={action} className="flex items-center gap-2">
      {forUserId && <input type="hidden" name="forUserId" value={forUserId} />}
      {state.error && <span role="alert" className="text-xs text-red-600">{state.error}</span>}
      <StopSubmit />
    </form>
  )
}
