'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { saveLabelsAction, resetLabelsAction, type ConfigState } from '@/app/invoices/configure/actions'
import { LABEL_FIELDS, DEFAULT_LABELS, type InvoiceLabelSet } from '@/lib/invoiceLabels'

function Save() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
      {pending ? 'Saving…' : 'Save labels'}
    </button>
  )
}

export function InvoiceLabelsForm({ labels, entityId }: { labels: InvoiceLabelSet; entityId?: string }) {
  const [state, action] = useFormState(saveLabelsAction, {} as ConfigState)
  return (
    <form action={action} className="space-y-4">
      {entityId && <input type="hidden" name="entityId" value={entityId} />}
      <p className="text-sm text-gray-500">
        Rename the labels shown on the invoice your client sees. Leave a field blank to use the default.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {LABEL_FIELDS.map(({ key, hint }) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-gray-400">
              {key}
              {hint && <span className="ml-1 normal-case tracking-normal text-gray-300">· {hint}</span>}
            </span>
            <input
              name={`label_${key}`}
              defaultValue={labels[key]}
              placeholder={DEFAULT_LABELS[key]}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
        ))}
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="text-sm text-brand-green">Saved.</p>}
      <div className="flex items-center gap-3">
        <Save />
        <button formAction={resetLabelsAction} className="text-sm text-gray-500 hover:text-gray-700">
          Reset to defaults
        </button>
      </div>
    </form>
  )
}
