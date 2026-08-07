'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { updatePersonBasicAction, type EditPersonState } from '@/app/team/actions'
import { EntitySelect, type EntityOption } from '@/components/EntitySelect'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

function Save() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
      {pending ? 'Saving…' : 'Save'}
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

export function PersonBasicForm({
  person,
  entities = [],
}: {
  person: { id: string; firstName: string; lastName: string; email: string; type: string; capacityHoursPerWeek: number | null; homeEntityId: string | null }
  entities?: EntityOption[]
}) {
  const [state, formAction] = useFormState<EditPersonState, FormData>(updatePersonBasicAction, {})
  return (
    <form action={formAction} className="max-w-lg space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <input type="hidden" name="id" value={person.id} />
      <div className="text-xs text-gray-400">{person.email} · sign-in email (change under Security)</div>
      <div className="flex flex-wrap gap-3">
        <Field label="First name">
          <input name="firstName" required defaultValue={person.firstName} className={`${input} w-40`} />
        </Field>
        <Field label="Last name">
          <input name="lastName" defaultValue={person.lastName} className={`${input} w-40`} />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Type">
          <select name="type" defaultValue={person.type} className={input}>
            <option value="employee">Employee</option>
            <option value="contractor">Contractor</option>
          </select>
        </Field>
        <Field label="Capacity (h/wk)">
          <input name="capacity" defaultValue={person.capacityHoursPerWeek?.toString() ?? ''} className={`${input} w-24`} />
        </Field>
        <EntitySelect entities={entities} name="homeEntityId" defaultValue={person.homeEntityId} label="Home company" />
      </div>
      <div className="flex items-center gap-3">
        <Save />
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-brand-green">Saved ✓</span>}
      </div>
    </form>
  )
}
