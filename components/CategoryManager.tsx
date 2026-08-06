'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { createCategoryAction, toggleCategoryAction, type SettingsState } from '@/app/settings/actions'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

export interface CategoryRow {
  id: string
  name: string
  unitName: string | null
  unitPriceCents: number | null
  isActive: boolean
}

function Add() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      {pending ? 'Adding…' : 'Add category'}
    </button>
  )
}

export function CategoryManager({ categories }: { categories: CategoryRow[] }) {
  const [state, formAction] = useFormState<SettingsState, FormData>(createCategoryAction, {})

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      {categories.length > 0 && (
        <ul className="mb-4 divide-y divide-gray-100 text-sm">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2">
              <span>
                <span className={c.isActive ? 'font-medium text-gray-800' : 'font-medium text-gray-400 line-through'}>
                  {c.name}
                </span>
                {c.unitName && (
                  <span className="ml-2 text-xs text-gray-400">
                    {c.unitPriceCents != null ? `$${(c.unitPriceCents / 100).toFixed(2)}/` : 'per '}
                    {c.unitName}
                  </span>
                )}
              </span>
              <form action={toggleCategoryAction}>
                <input type="hidden" name="id" value={c.id} />
                <button className="text-xs text-gray-400 hover:text-brand-orange">
                  {c.isActive ? 'Archive' : 'Restore'}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Name</span>
          <input name="name" required placeholder="Mileage, Meals…" className={`${input} w-48`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Unit (optional)</span>
          <input name="unitName" placeholder="mile" className={`${input} w-28`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Unit price (optional)</span>
          <input name="unitPrice" placeholder="0.67" className={`${input} w-28`} />
        </label>
        <Add />
        {state.error && <span className="pb-2 text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="pb-2 text-sm text-brand-green">Added ✓</span>}
      </form>
    </div>
  )
}
