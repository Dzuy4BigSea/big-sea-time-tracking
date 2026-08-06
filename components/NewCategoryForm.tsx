'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { createCategoryAction, type NewCategoryState } from '@/app/expenses/actions'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      {pending ? 'Adding…' : 'Add category'}
    </button>
  )
}

export function NewCategoryForm() {
  const [state, formAction] = useFormState<NewCategoryState, FormData>(createCategoryAction, {})

  return (
    <details className="mb-6 rounded-lg border border-gray-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-500">Manage expense categories</summary>
      <form action={formAction} className="flex flex-wrap items-end gap-3 border-t border-gray-100 p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Name</span>
          <input name="name" required placeholder="Mileage, Meals…" className={`${input} w-48`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Unit name (optional)</span>
          <input name="unitName" placeholder="mile" className={`${input} w-32`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Unit price (optional)</span>
          <input name="unitPrice" placeholder="0.67" className={`${input} w-28`} />
        </label>
        <Submit />
        {state.error && <span className="pb-2 text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="pb-2 text-sm text-brand-green">Category added ✓</span>}
      </form>
    </details>
  )
}
