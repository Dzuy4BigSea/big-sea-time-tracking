'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { createClientAction, type NewClientState } from '@/app/clients/actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Adding…' : 'Add client'}
    </button>
  )
}

export function NewClientForm() {
  const [state, formAction] = useFormState<NewClientState, FormData>(createClientAction, {})

  return (
    <details className="mb-6 rounded-lg border border-gray-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-brand-green">+ New client</summary>
      <form action={formAction} className="space-y-3 border-t border-gray-100 p-4">
        <div className="flex flex-wrap gap-3">
          <Field label="Name" wide>
            <input name="name" required className="w-64 rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </Field>
          <Field label="Currency">
            <select name="currency" defaultValue="USD" className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option>USD</option>
              <option>EUR</option>
              <option>GBP</option>
              <option>CAD</option>
              <option>AUD</option>
            </select>
          </Field>
        </div>

        <Field label="Address">
          <textarea name="address" rows={2} className="w-full max-w-md rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </Field>

        <fieldset className="rounded border border-gray-100 p-3">
          <legend className="px-1 text-xs uppercase tracking-wide text-gray-400">First contact (optional)</legend>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="First name">
              <input name="contactFirst" className="w-36 rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </Field>
            <Field label="Last name">
              <input name="contactLast" className="w-36 rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </Field>
            <Field label="Email">
              <input name="contactEmail" type="email" className="w-56 rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </Field>
            <label className="flex items-center gap-1.5 pb-2 text-sm text-gray-600">
              <input type="checkbox" name="contactIsRecipient" /> Invoice recipient
            </label>
          </div>
        </fieldset>

        <div className="flex items-center gap-3">
          <Submit />
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span className="text-sm text-brand-green">Client added ✓</span>}
        </div>
      </form>
    </details>
  )
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? '' : ''}`}>
      <span className="text-xs uppercase tracking-wide text-gray-400">{label}</span>
      {children}
    </label>
  )
}
