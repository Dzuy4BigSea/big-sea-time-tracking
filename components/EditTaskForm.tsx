'use client'

import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { updateTaskAction, type EditTaskState } from '@/app/tasks/actions'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
  )
}

export function EditTaskForm({
  task,
}: {
  task: { id: string; name: string; defaultBillable: boolean; defaultHourlyRateCents: number | null; autoAddToNewProjects: boolean }
}) {
  const [state, formAction] = useFormState<EditTaskState, FormData>(updateTaskAction, {})

  return (
    <form action={formAction} className="max-w-md space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <input type="hidden" name="id" value={task.id} />
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Name</span>
        <input name="name" required defaultValue={task.name} className={input} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Default rate ($/h)</span>
        <input
          name="rate"
          defaultValue={task.defaultHourlyRateCents ? (task.defaultHourlyRateCents / 100).toString() : ''}
          className={`${input} w-28`}
        />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-600">
        <input type="checkbox" name="defaultBillable" defaultChecked={task.defaultBillable} /> Billable by default
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-600">
        <input type="checkbox" name="autoAdd" defaultChecked={task.autoAddToNewProjects} /> Common (add to all new projects)
      </label>
      <div className="flex items-center gap-3">
        <Submit />
        <Link href="/tasks" className="text-sm text-gray-500 hover:text-brand-orange">
          Back to tasks
        </Link>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-brand-green">Saved ✓</span>}
      </div>
    </form>
  )
}
