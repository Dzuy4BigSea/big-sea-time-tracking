'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { createTaskAction, type NewTaskState } from '@/app/tasks/actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Adding…' : 'Add task'}
    </button>
  )
}

export function NewTaskForm() {
  const [state, formAction] = useFormState<NewTaskState, FormData>(createTaskAction, {})

  return (
    <details className="mb-6 rounded-lg border border-gray-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-brand-green">+ New task</summary>
      <form action={formAction} className="flex flex-wrap items-end gap-4 border-t border-gray-100 p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Name</span>
          <input name="name" required className="w-56 rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Default rate ($/h)</span>
          <input name="rate" placeholder="160" className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-gray-600">
          <input type="checkbox" name="defaultBillable" defaultChecked /> Billable by default
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-gray-600">
          <input type="checkbox" name="autoAdd" /> Common (add to all new projects)
        </label>
        <Submit />
        {state.error && <span className="w-full text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="w-full text-sm text-brand-green">Task added ✓</span>}
      </form>
    </details>
  )
}
