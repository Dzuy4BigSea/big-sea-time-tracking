'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { updateAppearanceAction, type SettingsState } from '@/app/settings/actions'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

export interface AppearanceValues {
  brandColor: string
  documentTitle: string
  logoFileUrl: string | null
  showDocumentTitle: boolean
  showDescriptionCol: boolean
  showQuantityCol: boolean
  showUnitPriceCol: boolean
  showAmountCol: boolean
}

function Save() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save appearance'}
    </button>
  )
}

function Toggle({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" name={name} defaultChecked={checked} className="h-4 w-4" /> {label}
    </label>
  )
}

export function AppearanceForm({ values }: { values: AppearanceValues }) {
  const [state, formAction] = useFormState<SettingsState, FormData>(updateAppearanceAction, {})

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Brand color</span>
          <div className="flex items-center gap-2">
            <input type="color" name="brandColor" defaultValue={values.brandColor} className="h-8 w-10 rounded border border-gray-300" />
            <span className="text-xs text-gray-500">{values.brandColor}</span>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Document title</span>
          <input name="documentTitle" defaultValue={values.documentTitle} className={`${input} w-40`} />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Logo URL (optional)</span>
          <input name="logoFileUrl" defaultValue={values.logoFileUrl ?? ''} placeholder="https://…" className={`${input} w-full`} />
        </label>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-gray-100 pt-3">
        <Toggle name="showDocumentTitle" label="Show document title" checked={values.showDocumentTitle} />
        <Toggle name="showDescriptionCol" label="Description column" checked={values.showDescriptionCol} />
        <Toggle name="showQuantityCol" label="Quantity column" checked={values.showQuantityCol} />
        <Toggle name="showUnitPriceCol" label="Unit price column" checked={values.showUnitPriceCol} />
        <Toggle name="showAmountCol" label="Amount column" checked={values.showAmountCol} />
      </div>

      <div className="flex items-center gap-3">
        <Save />
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-brand-green">Saved ✓</span>}
      </div>
    </form>
  )
}
