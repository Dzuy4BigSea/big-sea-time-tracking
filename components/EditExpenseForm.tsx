'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { updateExpenseAction, deleteExpenseAction, type EditExpenseState } from '@/app/expenses/actions'
import { toComboOptions, ExpenseAmountField, Field, type ExpenseOption, type ExpenseCategoryOption } from '@/components/NewExpenseForm'
import { Combobox } from '@/components/Combobox'
import { ConfirmSubmit } from '@/components/ConfirmSubmit'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

function Save() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
      {pending ? 'Saving…' : 'Update expense'}
    </button>
  )
}

export interface EditableExpense {
  id: string
  projectId: string
  categoryId: string
  spentDate: string
  amount: string
  /** Quantity for a unit-priced category (derived from total ÷ unit price; specs/26 G15). */
  units: string
  markup: string
  isBillable: boolean
  notes: string
  receiptFileUrl: string
}

export function EditExpenseForm({
  expense,
  projects,
  categories,
  backHref = '/expenses',
}: {
  expense: EditableExpense
  projects: ExpenseOption[]
  categories: ExpenseCategoryOption[]
  backHref?: string
}) {
  const [state, formAction] = useFormState<EditExpenseState, FormData>(updateExpenseAction, {})
  const [categoryId, setCategoryId] = useState(expense.categoryId)
  const category = categories.find((c) => c.id === categoryId)
  return (
    <div className="max-w-2xl space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="id" value={expense.id} />
        <div className="flex flex-wrap gap-3">
          <Field label="Date">
            <input name="spentDate" type="date" defaultValue={expense.spentDate} className={input} />
          </Field>
          <Field label="Project">
            <Combobox name="projectId" required defaultValue={expense.projectId} options={toComboOptions(projects)} className="w-64" />
          </Field>
          <Field label="Category">
            <Combobox name="categoryId" required defaultValue={expense.categoryId} options={toComboOptions(categories)} className="w-56" onValueChange={setCategoryId} />
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <ExpenseAmountField
            key={categoryId}
            category={category}
            defaultAmount={expense.amount}
            defaultUnits={categoryId === expense.categoryId ? expense.units : ''}
          />
          <Field label="Markup %">
            <input name="markup" defaultValue={expense.markup} className={`${input} w-20`} />
          </Field>
          <Field label="Notes (optional)">
            <input name="notes" defaultValue={expense.notes} className={`${input} w-64`} />
          </Field>
        </div>
        <Field label="Receipt link (optional)">
          <input name="receiptFileUrl" type="url" defaultValue={expense.receiptFileUrl} placeholder="https://…" className={`${input} w-full max-w-md`} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" name="isBillable" defaultChecked={expense.isBillable} /> This expense is billable
        </label>
        <div className="flex items-center gap-3">
          <Save />
          <Link href={backHref} className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancel
          </Link>
          {state.error && <span role="alert" className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span role="status" className="text-sm text-brand-green">Saved ✓</span>}
        </div>
      </form>
      {/* Harvest: "Delete" link on the edit form, with a confirm. */}
      <form action={deleteExpenseAction} className="border-t border-gray-100 pt-3 text-right">
        <input type="hidden" name="id" value={expense.id} />
        <input type="hidden" name="redirectTo" value={backHref} />
        <ConfirmSubmit message="Permanently delete this expense?" className="text-sm text-red-600 underline hover:no-underline">
          Delete
        </ConfirmSubmit>
      </form>
    </div>
  )
}
