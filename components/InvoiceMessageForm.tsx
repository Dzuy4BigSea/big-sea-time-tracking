'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { saveMessageAction, type ConfigState } from '@/app/invoices/configure/actions'
import type { MessageTemplate } from '@/lib/messageTemplates'

function Save() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
      {pending ? 'Saving…' : 'Save'}
    </button>
  )
}

export function InvoiceMessageForm({
  kind,
  label,
  description,
  placeholders,
  template,
}: {
  kind: string
  label: string
  description: string
  placeholders: string[]
  template: MessageTemplate
}) {
  const [state, action] = useFormState(saveMessageAction, {} as ConfigState)
  return (
    <form action={action} className="rounded-lg border border-gray-200 bg-white p-4">
      <input type="hidden" name="kind" value={kind} />
      <div className="mb-1 text-sm font-semibold text-gray-800">{label}</div>
      <p className="mb-3 text-xs text-gray-500">{description}</p>
      <label className="mb-3 flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Subject</span>
        <input name="subject" defaultValue={template.subject} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-gray-400">Message</span>
        <textarea name="body" defaultValue={template.body} rows={3} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-400">Placeholders:</span>
        {placeholders.map((p) => (
          <code key={p} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{p}</code>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Save />
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-brand-green">Saved.</span>}
      </div>
    </form>
  )
}
