'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { createPersonAction, type NewPersonState } from '@/app/team/actions'

const PROFILE_OPTIONS: { value: string; label: string }[] = [
  { value: 'member', label: 'Member' },
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'people_admin', label: 'People Admin' },
  { value: 'accounting', label: 'Accounting' },
  { value: 'executive_manager', label: 'Executive Manager' },
  { value: 'administrator', label: 'Administrator' },
]

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Adding…' : 'Add person'}
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

export function NewPersonForm() {
  const [state, formAction] = useFormState<NewPersonState, FormData>(createPersonAction, {})

  return (
    <details className="mb-6 rounded-lg border border-gray-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-brand-green">+ Invite person</summary>
      <form action={formAction} className="space-y-3 border-t border-gray-100 p-4">
        <div className="flex flex-wrap gap-3">
          <Field label="First name">
            <input name="firstName" required className={`${input} w-40`} />
          </Field>
          <Field label="Last name">
            <input name="lastName" className={`${input} w-40`} />
          </Field>
          <Field label="Email">
            <input name="email" type="email" required className={`${input} w-64`} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-3">
          <Field label="Permission">
            <select name="profile" defaultValue="member" className={input}>
              {PROFILE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select name="type" defaultValue="employee" className={input}>
              <option value="employee">Employee</option>
              <option value="contractor">Contractor</option>
            </select>
          </Field>
          <Field label="Capacity (h/wk)">
            <input name="capacity" placeholder="35" className={`${input} w-24`} />
          </Field>
          <Field label="Initial password">
            <input name="password" type="password" required minLength={8} className={`${input} w-48`} />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Submit />
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span className="text-sm text-brand-green">Person added ✓</span>}
          <span className="text-xs text-gray-400">They sign in with this email + password.</span>
        </div>
      </form>
    </details>
  )
}
