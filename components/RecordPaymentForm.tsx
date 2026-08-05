'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { recordPaymentAction, type PaymentState } from '@/app/invoices/actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Recording…' : 'Record payment'}
    </button>
  )
}

export function RecordPaymentForm({
  invoiceId,
  defaultDate,
  dueLabel,
}: {
  invoiceId: string
  defaultDate: string
  dueLabel: string
}) {
  const [state, formAction] = useFormState<PaymentState, FormData>(recordPaymentAction, {})

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Field label={`Amount (due ${dueLabel})`}>
        <input name="amount" placeholder="0.00" className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </Field>
      <Field label="Date">
        <input type="date" name="paidOn" defaultValue={defaultDate} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </Field>
      <Field label="Method">
        <select name="method" className="rounded border border-gray-300 px-2 py-1.5 text-sm" defaultValue="bank_transfer">
          <option value="cash">Cash</option>
          <option value="check">Check</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="card">Card</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <Submit />
      {state.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="w-full text-sm text-brand-green">Payment recorded ✓</p>}
    </form>
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
