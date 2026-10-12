'use client'

import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { updateExpenseAction, type EditExpenseState } from '@/app/expenses/actions'
import { toComboOptions, type ExpenseOption } from '@/components/NewExpenseForm'
import { Combobox } from '@/components/Combobox'

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

export interface EditableExpense {
  id: string
  projectId: string
  categoryId: string
  spentDate: string
  amount: string
  markup: string
  isBillable: boolean
  notes: string
  receiptFileUrl: string
}

export function EditExpenseForm({
  expense,
  projects,
  categories,
}: {
  expense: EditableExpense
  projects: ExpenseOption[]
  categories: ExpenseOption[]
}) {
  const [state, formAction] = useFormState<EditExpenseState, FormData>(updateExpenseAction, {})
  return (
    <form action={formAction} className="max-w-2xl space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <input type="hidden" name="id" value={expense.id} />
      <div className="flex flex-wrap gap-3">
        <Field label="Project">
          <Combobox name="projectId" required defaultValue={expense.projectId} options={toComboOptions(projects)} className="w-64" />
        </Field>
        <Field label="Category">
          <Combobox name="categoryId" required defaultValue={expense.categoryId} options={toComboOptions(categories)} className="w-56" />
        </Field>
        <Field label="Date">
          <input name="spentDate" type="date" defaultValue={expense.spentDate} className={input} />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Amount">
          <input name="amount" defaultValue={expense.amount} className={`${input} w-28`} />
        </Field>
        <Field label="Markup %">
          <input name="markup" defaultValue={expense.markup} className={`${input} w-20`} />
        </Field>
        <Field label="Notes">
          <input name="notes" defaultValue={expense.notes} className={`${input} w-64`} />
        </Field>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-gray-600">
          <input type="checkbox" name="isBillable" defaultChecked={expense.isBillable} /> Billable
        </label>
      </div>
      <Field label="Receipt URL">
        <input name="receiptFileUrl" type="url" defaultValue={expense.receiptFileUrl} placeholder="https://…" className={`${input} w-full max-w-md`} />
      </Field>
      <div className="flex items-center gap-3">
        <Save />
        <Link href="/expenses" className="text-sm text-gray-500 hover:text-brand-teal">Back to expenses</Link>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-brand-green">Saved ✓</span>}
      </div>
    </form>
  )
}
