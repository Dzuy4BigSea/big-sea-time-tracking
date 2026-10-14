'use client'

import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createExpenseAction, type NewExpenseState } from '@/app/expenses/actions'
import { Combobox } from '@/components/Combobox'
import { formatCents } from '@/lib/format'
import { isUnitBased, parseQuantityHundredths, unitTotalCents } from '@/modules/expenses/expenses'

const input = 'rounded border border-gray-300 bg-white px-2 py-1.5 text-sm'

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Saving…' : label}
    </button>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
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

/** A project in the expense picker; `billable` is the default for "This expense is billable" (AC-EXP-115). */
export interface ExpenseProjectOption extends ExpenseOption {
  billable?: boolean
}

/** A category in the expense picker; unit-priced ones (Mileage) take a quantity (AC-EXP-116). */
export interface ExpenseCategoryOption extends ExpenseOption {
  unitName?: string | null
  unitPriceCents?: number | null
}

/** Map expense options to type-to-filter combobox options. */
export const toComboOptions = (opts: ExpenseOption[]) => opts.map((o) => ({ value: o.id, label: o.label, group: o.group, keywords: o.keywords }))

/**
 * Amount input: money for a flat category, or a quantity × unit price for a unit-priced one, with a live
 * "100 miles × $0.55 = $55.00" preview. The server recomputes the total (modules/expenses).
 */
export function ExpenseAmountField({
  category,
  defaultAmount = '',
  defaultUnits = '',
}: {
  category: ExpenseCategoryOption | undefined
  defaultAmount?: string
  defaultUnits?: string
}) {
  const [units, setUnits] = useState(defaultUnits)
  const pricing = { unitName: category?.unitName ?? null, unitPriceCents: category?.unitPriceCents ?? null }
  if (category && isUnitBased(pricing)) {
    const h = parseQuantityHundredths(units)
    const unit = pricing.unitName || 'units'
    return (
      <Field label={`Quantity (${unit})`}>
        <span className="flex items-center gap-2">
          <input name="units" required inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="0" className={`${input} w-24`} />
          <span className="whitespace-nowrap text-sm text-gray-500">
            {unit} × {formatCents(pricing.unitPriceCents)}
            {h != null && <> = <span className="font-medium tabular-nums text-gray-800">{formatCents(unitTotalCents(h, pricing.unitPriceCents))}</span></>}
          </span>
        </span>
      </Field>
    )
  }
  return (
    <Field label="Amount">
      <input name="amount" required inputMode="decimal" defaultValue={defaultAmount} placeholder="0.00" className={`${input} w-28`} />
    </Field>
  )
}

/**
 * Harvest's "Track expenses": a green button that opens the orange "New expense" box (specs/26 §10).
 * `forUserId` is set on a teammate's Expenses page; the server re-checks it.
 */
export function NewExpenseForm({
  projects,
  categories,
  today,
  forUserId,
}: {
  projects: ExpenseProjectOption[]
  categories: ExpenseCategoryOption[]
  today: string
  forUserId?: string
}) {
  const [state, formAction] = useFormState<NewExpenseState, FormData>(createExpenseAction, {})
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [billable, setBillable] = useState(true)
  const [categoryId, setCategoryId] = useState('')

  // A saved expense closes the box (it remounts empty next time), like Harvest's Save expense.
  useEffect(() => {
    if (state.ok) {
      setOpen(false)
      setSaved(true)
    }
  }, [state])

  const noCategories = categories.length === 0
  const noProjects = projects.length === 0
  const category = categories.find((c) => c.id === categoryId)

  if (!open) {
    return (
      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setOpen(true)
            setSaved(false)
            setBillable(true)
            setCategoryId('')
          }}
          className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          + Track expenses
        </button>
        {saved && <span role="status" className="text-sm text-brand-green">Expense saved ✓</span>}
      </div>
    )
  }

  return (
    <form action={formAction} className="mb-6 space-y-3 rounded-lg border-2 border-brand-orange/60 bg-orange-50/60 p-4">
      <h2 className="text-sm font-semibold text-gray-800">New expense</h2>
      {forUserId && <input type="hidden" name="forUserId" value={forUserId} />}
      <div className="flex flex-wrap gap-3">
        <Field label="Date">
          <input name="spentDate" type="date" required defaultValue={today} className={input} />
        </Field>
        <Field label="Project">
          <Combobox
            name="projectId"
            required
            disabled={noProjects}
            options={toComboOptions(projects)}
            placeholder={noProjects ? 'No assigned projects' : 'Choose a project…'}
            emptyText="No results match"
            className="w-72"
            onValueChange={(id) => {
              const p = projects.find((x) => x.id === id)
              if (p) setBillable(p.billable !== false)
            }}
          />
        </Field>
        <Field label="Category">
          <Combobox
            name="categoryId"
            required
            disabled={noCategories}
            options={toComboOptions(categories)}
            placeholder={noCategories ? 'No categories yet' : 'Choose a category…'}
            className="w-60"
            onValueChange={setCategoryId}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <ExpenseAmountField key={categoryId} category={category} />
        <Field label="Markup %">
          <input name="markup" inputMode="decimal" placeholder="0" className={`${input} w-20`} />
        </Field>
        <Field label="Notes (optional)">
          <input name="notes" placeholder="e.g. vendor" className={`${input} w-72`} />
        </Field>
      </div>
      <Field label="Receipt link (optional)">
        <input name="receiptFileUrl" type="url" placeholder="https://… link to the receipt" className={`${input} w-full max-w-md`} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" name="isBillable" checked={billable} onChange={(e) => setBillable(e.target.checked)} /> This expense is billable
      </label>
      {noProjects && (
        <p className="text-sm text-amber-700">If you don’t see the project you need, ask an Administrator to assign you to it.</p>
      )}
      <div className="flex items-center gap-3">
        <Submit label="Save expense" />
        <button type="button" onClick={() => setOpen(false)} className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        {state.error && <span role="alert" className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  )
}
