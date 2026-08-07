'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { addPersonRateAction, type EditPersonState } from '@/app/team/actions'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

function Add() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
      {pending ? 'Adding…' : 'Add rate'}
    </button>
  )
}

/** Add an effective-dated billable or cost rate for a person. */
export function AddRateForm({ personId, kind, todayYmd }: { personId: string; kind: 'billable' | 'cost'; todayYmd: string }) {
  const [state, formAction] = useFormState<EditPersonState, FormData>(addPersonRateAction, {})
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={personId} />
      <input type="hidden" name="kind" value={kind} />
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-gray-400">{kind === 'cost' ? 'Cost' : 'Billable'} rate ($/h)</span>
        <input name="rate" placeholder="0.00" className={`${input} w-28`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-gray-400">Effective from</span>
        <input type="date" name="startDate" defaultValue={todayYmd} className={input} />
      </label>
      <Add />
      {state.error && <span className="pb-1.5 text-xs text-red-600">{state.error}</span>}
      {state.ok && <span className="pb-1.5 text-xs text-brand-green">Added ✓</span>}
    </form>
  )
}
