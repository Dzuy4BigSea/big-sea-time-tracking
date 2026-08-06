'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { createExpenseAction, type NewExpenseState } from '@/app/expenses/actions'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Add expense'}
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

export interface ExpenseOption {
  id: string
  label: string
}

export function NewExpenseForm({
  projects,
  categories,
  today,
}: {
  projects: ExpenseOption[]
  categories: ExpenseOption[]
  today: string
}) {
  const [state, formAction] = useFormState<NewExpenseState, FormData>(createExpenseAction, {})

  const noCategories = categories.length === 0

  return (
    <details className="mb-6 rounded-lg border border-gray-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-brand-green">+ New expense</summary>
      <form action={formAction} className="space-y-3 border-t border-gray-100 p-4">
        <div className="flex flex-wrap gap-3">
          <Field label="Project">
            <select name="projectId" required defaultValue="" className={`${input} w-64`}>
              <option value="" disabled>
                Select a project…
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select name="categoryId" required defaultValue="" className={`${input} w-56`} disabled={noCategories}>
              <option value="" disabled>
                {noCategories ? 'No categories yet' : 'Select a category…'}
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input name="spentDate" type="date" required defaultValue={today} className={input} />
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Amount">
            <input name="amount" required placeholder="42.50" className={`${input} w-28`} />
          </Field>
          <Field label="Markup %">
            <input name="markup" placeholder="0" className={`${input} w-20`} />
          </Field>
          <Field label="Notes">
            <input name="notes" placeholder="optional" className={`${input} w-64`} />
          </Field>
          <label className="flex items-center gap-1.5 pb-2 text-sm text-gray-600">
            <input type="checkbox" name="isBillable" defaultChecked /> Billable
          </label>
        </div>
        <div className="flex items-center gap-3">
          <Submit />
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span className="text-sm text-brand-green">Expense added ✓</span>}
        </div>
      </form>
    </details>
  )
}
