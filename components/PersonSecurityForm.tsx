'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { updatePersonSecurityAction, type EditPersonState } from '@/app/team/actions'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

function Save() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
      {pending ? 'Saving…' : 'Save'}
    </button>
  )
}

export function PersonSecurityForm({ person }: { person: { id: string; email: string; isActive: boolean } }) {
  const [state, formAction] = useFormState<EditPersonState, FormData>(updatePersonSecurityAction, {})
  return (
    <form action={formAction} className="max-w-lg space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <input type="hidden" name="id" value={person.id} />
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Sign-in email</span>
        <input name="email" type="email" defaultValue={person.email} className={`${input} w-72`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Reset password (optional)</span>
        <input name="newPassword" type="password" minLength={8} placeholder="leave blank to keep" className={`${input} w-72`} />
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" name="isActive" defaultChecked={person.isActive} className="h-4 w-4" /> Active (can sign in)
      </label>
      <div className="flex items-center gap-3">
        <Save />
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-brand-green">Saved ✓</span>}
      </div>
    </form>
  )
}
