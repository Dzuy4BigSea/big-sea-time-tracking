'use client'

import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createRetainerAction, type RetainerState } from '@/app/retainers/actions'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

export interface RetainerClientOption {
  id: string
  name: string
  projects: { id: string; name: string }[]
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Creating…' : 'Create retainer'}
    </button>
  )
}

export function NewRetainerForm({ clients }: { clients: RetainerClientOption[] }) {
  const [state, formAction] = useFormState<RetainerState, FormData>(createRetainerAction, {})
  const [clientId, setClientId] = useState(clients[0]?.id ?? '')
  const projects = clients.find((c) => c.id === clientId)?.projects ?? []

  return (
    <details className="mb-6 rounded-lg border border-gray-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-brand-green">+ New retainer</summary>
      <form action={formAction} className="flex flex-wrap items-end gap-3 border-t border-gray-100 p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Client</span>
          <select name="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)} className={`${input} w-56`}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Project</span>
          <select name="projectId" defaultValue="all" className={`${input} w-56`}>
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Initial deposit</span>
          <input name="deposit" placeholder="10,000.00" className={`${input} w-32`} />
        </label>
        <Submit />
        {state.error && <span className="pb-2 text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="pb-2 text-sm text-brand-green">Created ✓</span>}
      </form>
    </details>
  )
}
