'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { createEstimateAction, type EstimateState } from '@/app/estimates/actions'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Creating…' : 'Create estimate'}
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

export function NewEstimateForm({ clients }: { clients: { id: string; name: string }[] }) {
  const [state, formAction] = useFormState<EstimateState, FormData>(createEstimateAction, {})

  return (
    <details className="mb-6 rounded-lg border border-gray-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-brand-green">+ New estimate</summary>
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
          <input name="subject" placeholder="Project quote" className={`${input} w-52`} />
        </Field>
        <Field label="Line description">
          <input name="description" placeholder="Scope of work" className={`${input} w-56`} />
        </Field>
        <Field label="Amount">
          <input name="amount" placeholder="5,000.00" className={`${input} w-28`} />
        </Field>
        <Submit />
        {state.error && <span className="pb-2 text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="pb-2 text-sm text-brand-green">Created ✓</span>}
      </form>
    </details>
  )
}
