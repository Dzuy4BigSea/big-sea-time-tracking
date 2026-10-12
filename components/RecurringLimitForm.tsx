'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { updateRecurringLimitAction, type RecurringState } from '@/app/recurring/actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="text-xs font-medium text-brand-green hover:underline disabled:opacity-50">
      {pending ? 'Saving…' : 'Save'}
    </button>
  )
}

/** Inline editor for a recurring profile's "invoices left to issue" (blank = no limit). BugHerd #13. */
export function RecurringLimitForm({ id, remaining }: { id: string; remaining: number | null }) {
  const [state, formAction] = useFormState<RecurringState, FormData>(updateRecurringLimitAction, {})
  return (
    <details className="text-xs">
      <summary className="cursor-pointer list-none text-gray-400 hover:text-brand-teal">
        {remaining == null ? 'No end · set limit' : `${remaining} left · edit`}
      </summary>
      <form action={formAction} className="mt-1 flex items-center gap-2">
        <input type="hidden" name="id" value={id} />
        <input
          name="occurrences"
          type="number"
          min={1}
          step={1}
          defaultValue={remaining && remaining > 0 ? remaining : ''}
          placeholder="No limit"
          aria-label="Invoices left to issue"
          className="w-20 rounded border border-gray-300 px-1.5 py-1 text-xs"
        />
        <Submit />
      </form>
      {state.error && <div className="mt-1 text-red-600">{state.error}</div>}
    </details>
  )
}
