'use client'

import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createRecurringAction, updateRecurringAction, type RecurringState } from '@/app/recurring/actions'
import { RECURRING_PRESETS, type CustomUnit } from '@/modules/invoicing/recurring'
import { PAYMENT_TERM_LABEL } from '@/lib/labels'

const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'
const label = 'w-48 shrink-0 pt-1.5 text-sm font-medium text-gray-700'

export interface TemplateLineRow {
  description: string
  quantity: string
  unitPrice: string
  /** carried through unchanged so an edit never drops a project link / tax flag */
  meta: string
}

export interface RecurringTemplateInitial {
  id?: string
  clientId?: string
  subject: string
  preset: string
  customN: number
  customUnit: CustomUnit
  nextIssueDate: string
  occurrences: string
  paymentTerm: string
  notes: string
  lines: TemplateLineRow[]
}

const blankLine = (): TemplateLineRow => ({ description: '', quantity: '1', unitPrice: '', meta: '{}' })

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
      {pending ? 'Saving…' : 'Save recurring invoice'}
    </button>
  )
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-gray-100 py-3 last:border-0 sm:flex-row sm:gap-4">
      <div className={label}>{title}</div>
      <div className="flex-1">
        {children}
        {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      </div>
    </div>
  )
}

/** Integer-cent preview of qty × price (display only; the server recomputes, INV-1). */
function lineCents(r: TemplateLineRow): number {
  const q = r.quantity.trim() === '' ? 1 : Number(r.quantity)
  const p = Number(r.unitPrice.replace(/[$,\s]/g, ''))
  if (!Number.isFinite(q) || !Number.isFinite(p)) return 0
  return Math.round(q * Math.round(p * 100))
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)

/**
 * "+ New recurring invoice" / "Edit recurring template" (specs/27 AC-REC-101/104/105/106).
 * Free form template only (the tracked-time template type is an open gap, G14).
 */
export function RecurringTemplateForm({
  mode,
  clients,
  clientName,
  currency = 'USD',
  minDate,
  initial,
}: {
  mode: 'new' | 'edit'
  clients?: { id: string; name: string }[]
  clientName?: string
  currency?: string
  /** earliest allowed issue date (tomorrow in the account timezone), yyyy-mm-dd */
  minDate: string
  initial: RecurringTemplateInitial
}) {
  const [state, formAction] = useFormState<RecurringState, FormData>(mode === 'new' ? createRecurringAction : updateRecurringAction, {})
  const [preset, setPreset] = useState(initial.preset)
  const [lines, setLines] = useState<TemplateLineRow[]>(initial.lines.length ? initial.lines : [blankLine()])
  const total = lines.reduce((s, r) => s + lineCents(r), 0)
  const setLine = (i: number, patch: Partial<TemplateLineRow>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  return (
    <form action={formAction} className="rounded-lg border border-gray-200 bg-white p-5">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}

      <Row title="Client">
        {mode === 'new' ? (
          <select name="clientId" defaultValue={initial.clientId} required className={`${input} w-72`}>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="pt-1.5 text-sm text-gray-900">{clientName}</div>
        )}
      </Row>

      <Row title="How often">
        <div className="flex flex-wrap items-center gap-2">
          <select name="howOften" value={preset} onChange={(e) => setPreset(e.target.value)} className={input} aria-label="How often">
            {RECURRING_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
          {preset === 'custom' && (
            <span className="flex items-center gap-2 text-sm text-gray-600">
              every
              <input name="customN" type="number" min={1} max={365} defaultValue={initial.customN} aria-label="Every" className={`${input} w-20`} />
              <select name="customUnit" defaultValue={initial.customUnit} aria-label="Unit" className={input}>
                <option value="days">days</option>
                <option value="weeks">weeks</option>
                <option value="months">months</option>
              </select>
            </span>
          )}
        </div>
      </Row>

      <Row
        title={mode === 'new' ? 'First issue date' : 'Next issue date'}
        hint="Must be after today. To bill today, create a one-time invoice. Monthly dates on the 29th–31st fall on the last day of shorter months."
      >
        <input name="nextIssueDate" type="date" required defaultValue={initial.nextIssueDate} min={mode === 'new' ? minDate : undefined} className={input} />
      </Row>

      <Row title="Number of invoices to issue" hint="Leave blank to keep issuing until you pause or delete this recurring invoice.">
        <input name="occurrences" type="number" min={1} step={1} defaultValue={initial.occurrences} placeholder="No end" className={`${input} w-32`} />
      </Row>

      <Row title="Invoice due date">
        <select name="paymentTerm" defaultValue={initial.paymentTerm} className={input}>
          {Object.entries(PAYMENT_TERM_LABEL)
            .filter(([k]) => k !== 'custom')
            .map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
        </select>
      </Row>

      <Row title="Send">
        <div className="pt-1.5 text-sm text-gray-700">Create a draft invoice for me to send manually</div>
        <p className="mt-1 text-xs text-gray-500">Automatic sending is not available yet.</p>
      </Row>

      <Row title="Subject">
        <input name="subject" required defaultValue={initial.subject} placeholder="Monthly retainer" className={`${input} w-full max-w-lg`} />
      </Row>

      <div className="mt-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="py-2 pr-2 font-medium">Description</th>
              <th className="w-24 py-2 pr-2 text-right font-medium">Quantity</th>
              <th className="w-32 py-2 pr-2 text-right font-medium">Unit price</th>
              <th className="w-32 py-2 text-right font-medium">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((r, i) => (
              <tr key={i} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-2">
                  <textarea
                    name="lineDescription"
                    rows={2}
                    value={r.description}
                    onChange={(e) => setLine(i, { description: e.target.value })}
                    aria-label={`Line ${i + 1} description`}
                    className={`${input} w-full`}
                  />
                  <input type="hidden" name="lineMeta" value={r.meta} />
                </td>
                <td className="py-2 pr-2">
                  <input name="lineQuantity" value={r.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-label={`Line ${i + 1} quantity`} className={`${input} w-full text-right`} />
                </td>
                <td className="py-2 pr-2">
                  <input name="lineUnitPrice" value={r.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} placeholder="0.00" aria-label={`Line ${i + 1} unit price`} className={`${input} w-full text-right`} />
                </td>
                <td className="py-2 pt-3.5 text-right tabular-nums text-gray-700">{money(lineCents(r), currency)}</td>
                <td className="py-2 pl-2 pt-3">
                  {lines.length > 1 && (
                    <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`} className="text-gray-400 hover:text-red-600">
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex items-center justify-between">
          <button type="button" onClick={() => setLines((ls) => [...ls, blankLine()])} className="text-sm font-medium text-brand-green hover:underline">
            + Add item
          </button>
          <div className="text-sm">
            <span className="text-gray-500">Amount </span>
            <span className="font-semibold tabular-nums">{money(total, currency)}</span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="rec-notes">
          Notes
        </label>
        <textarea id="rec-notes" name="notes" rows={3} defaultValue={initial.notes} className={`${input} w-full`} />
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Submit />
        <a href="/recurring" className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Cancel
        </a>
        {state.error && (
          <span role="alert" className="text-sm text-red-600">
            {state.error}
          </span>
        )}
      </div>
    </form>
  )
}
