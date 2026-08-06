'use client'

import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { updateClientAction, type EditClientState } from '@/app/clients/actions'

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

export function EditClientForm({
  client,
  currencyLocked,
}: {
  client: { id: string; name: string; currency: string; address: string | null }
  currencyLocked: boolean
}) {
  const [state, formAction] = useFormState<EditClientState, FormData>(updateClientAction, {})

  return (
    <form action={formAction} className="max-w-md space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <input type="hidden" name="id" value={client.id} />

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Name</span>
        <input name="name" required defaultValue={client.name} className={input} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Currency</span>
        {currencyLocked ? (
          <>
            <input type="hidden" name="currency" value={client.currency} />
            <div className="text-sm text-gray-500">
              {client.currency} <span className="text-xs text-gray-400">(locked — client has invoices)</span>
            </div>
          </>
        ) : (
          <select name="currency" defaultValue={client.currency} className={input}>
            <option>USD</option>
            <option>EUR</option>
            <option>GBP</option>
            <option>CAD</option>
            <option>AUD</option>
          </select>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Address</span>
        <textarea name="address" rows={3} defaultValue={client.address ?? ''} className={input} />
      </label>

      <div className="flex items-center gap-3">
        <Submit />
        <Link href="/clients" className="text-sm text-gray-500 hover:text-brand-orange">
          Back to clients
        </Link>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-brand-green">Saved ✓</span>}
      </div>
    </form>
  )
}
