'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { createExpenseAction, type NewExpenseState } from '@/app/expenses/actions'
import { Combobox } from '@/components/Combobox'

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
  /** Section heading in the picker (projects are grouped under their client, like Harvest). */
  group?: string
  /** Extra hidden search text (e.g. project code). */
  keywords?: string
}

/** Map expense options to type-to-filter combobox options. */
export const toComboOptions = (opts: ExpenseOption[]) => opts.map((o) => ({ value: o.id, label: o.label, group: o.group, keywords: o.keywords }))

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
            <Combobox name="projectId" required options={toComboOptions(projects)} placeholder="Select a project…" className="w-64" />
          </Field>
          <Field label="Category">
            <Combobox
              name="categoryId"
              required
              disabled={noCategories}
              options={toComboOptions(categories)}
              placeholder={noCategories ? 'No categories yet' : 'Select a category…'}
              className="w-56"
            />
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
        <Field label="Receipt URL (optional)">
          <input name="receiptFileUrl" type="url" placeholder="https://…link to the receipt" className={`${input} w-full max-w-md`} />
        </Field>
        <div className="flex items-center gap-3">
          <Submit />
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span className="text-sm text-brand-green">Expense added ✓</span>}
        </div>
      </form>
    </details>
  )
}
