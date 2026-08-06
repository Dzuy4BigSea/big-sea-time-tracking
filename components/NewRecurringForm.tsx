'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { createRecurringAction, type RecurringState } from '@/app/recurring/actions'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Creating…' : 'Create profile'}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-gray-400">{label}</span>
      {children}
    </label>
  )
}

export function NewRecurringForm({ clients, today }: { clients: { id: string; name: string }[]; today: string }) {
  const [state, formAction] = useFormState<RecurringState, FormData>(createRecurringAction, {})

  return (
    <details className="mb-6 rounded-lg border border-gray-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-brand-green">+ New recurring profile</summary>
      <form action={formAction} className="flex flex-wrap items-end gap-3 border-t border-gray-100 p-4">
        <Field label="Client">
          <select name="clientId" className={`${input} w-52`}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subject">
          <input name="subject" required placeholder="Monthly retainer" className={`${input} w-52`} />
        </Field>
        <Field label="Frequency">
          <select name="frequency" defaultValue="monthly" className={input}>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
            <option value="custom">Custom (days)</option>
          </select>
        </Field>
        <Field label="Every">
          <input name="intervalCount" type="number" min={1} defaultValue={1} className={`${input} w-16`} />
        </Field>
        <Field label="Next issue date">
          <input name="nextIssueDate" type="date" defaultValue={today} className={input} />
        </Field>
        <Field label="Amount">
          <input name="amount" placeholder="2,500.00" className={`${input} w-28`} />
        </Field>
        <Submit />
        {state.error && <span className="pb-2 text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="pb-2 text-sm text-brand-green">Created ✓</span>}
      </form>
    </details>
  )
}
