'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { updateInvoiceMetaAction, type EditInvoiceState } from '@/app/invoices/[id]/edit/actions'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

const TERMS = [
  { value: 'due_on_receipt', label: 'Due on receipt' },
  { value: 'net_15', label: 'Net 15' },
  { value: 'net_30', label: 'Net 30' },
  { value: 'net_45', label: 'Net 45' },
  { value: 'net_60', label: 'Net 60' },
  { value: 'custom', label: 'Custom' },
]

function Save() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
      {pending ? 'Saving…' : 'Save details'}
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

export interface EditableInvoice {
  id: string
  subject: string | null
  poNumber: string | null
  issueDate: string | null // ymd
  dueDate: string | null // ymd
  paymentTerm: string
  discountPercent: string | null
  tax1Name: string | null
  tax1Percent: string | null
  tax2Name: string | null
  tax2Percent: string | null
  terms: string | null
  notes: string | null
}

export function EditInvoiceForm({ invoice }: { invoice: EditableInvoice }) {
  const [state, formAction] = useFormState<EditInvoiceState, FormData>(updateInvoiceMetaAction, {})

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <input type="hidden" name="invoiceId" value={invoice.id} />

      <div className="flex flex-wrap gap-3">
        <Field label="Subject">
          <input name="subject" defaultValue={invoice.subject ?? ''} className={`${input} w-80`} />
        </Field>
        <Field label="PO number">
          <input name="poNumber" defaultValue={invoice.poNumber ?? ''} className={`${input} w-40`} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-3">
        <Field label="Issue date">
          <input type="date" name="issueDate" defaultValue={invoice.issueDate ?? ''} className={input} />
        </Field>
        <Field label="Due date">
          <input type="date" name="dueDate" defaultValue={invoice.dueDate ?? ''} className={input} />
        </Field>
        <Field label="Payment term">
          <select name="paymentTerm" defaultValue={invoice.paymentTerm} className={input}>
            {TERMS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Discount %">
          <input name="discountPercent" defaultValue={invoice.discountPercent ?? ''} placeholder="0" className={`${input} w-24`} />
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Tax 1 name">
          <input name="tax1Name" defaultValue={invoice.tax1Name ?? ''} placeholder="e.g. GST" className={`${input} w-32`} />
        </Field>
        <Field label="Tax 1 %">
          <input name="tax1Percent" defaultValue={invoice.tax1Percent ?? ''} placeholder="0" className={`${input} w-20`} />
        </Field>
        <Field label="Tax 2 name">
          <input name="tax2Name" defaultValue={invoice.tax2Name ?? ''} className={`${input} w-32`} />
        </Field>
        <Field label="Tax 2 %">
          <input name="tax2Percent" defaultValue={invoice.tax2Percent ?? ''} placeholder="0" className={`${input} w-20`} />
        </Field>
      </div>

      <Field label="Notes (shown on the invoice)">
        <textarea name="notes" rows={2} defaultValue={invoice.notes ?? ''} className={`${input} w-full max-w-2xl`} />
      </Field>
      <Field label="Terms">
        <textarea name="terms" rows={2} defaultValue={invoice.terms ?? ''} className={`${input} w-full max-w-2xl`} />
      </Field>

      <div className="flex items-center gap-3">
        <Save />
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-brand-green">Saved ✓</span>}
      </div>
    </form>
  )
}
