'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { saveInvoiceAction, type EditInvoiceState } from '@/app/invoices/[id]/edit/actions'
import { computeTotals } from '@/modules/invoicing/totals'
import { DUE_OPTIONS, parsePriceCents, parseQuantityHundredths, parsePercent, lineAmountFromHundredths } from '@/modules/invoicing/editInvoice'
import { formatCents } from '@/lib/format'
import { FixedFeeProjectContext, type FixedFeeContextView } from '@/components/FixedFeeProjectContext'
import { useLeavePageGuard } from '@/components/useLeavePageGuard'

const input = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-teal focus:outline-none'
const readOnly = 'w-full rounded border border-gray-200 bg-gray-100 px-2 py-1.5 text-sm text-gray-600'

export interface EditableInvoice {
  id: string
  number: string | null
  status: string
  clientName: string
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
  currency: string
  notes: string | null
  paidCents: number
  acceptOnlinePayments: boolean
  allowCardPayments: boolean
  allowAchPayments: boolean
}

export interface EditableLine {
  id: string
  itemTypeId: string | null
  description: string
  quantity: string
  unitPrice: string
  linkedProjectId: string | null
  taxable: boolean
  /** tracked time entries + expenses billed on this line */
  linkedCount: number
}

interface Row extends Omit<EditableLine, 'id'> {
  key: string
  id: string | null
}

let seq = 0
const newRow = (): Row => ({
  key: `new-${++seq}`,
  id: null,
  itemTypeId: null,
  description: '',
  quantity: '1',
  unitPrice: '',
  linkedProjectId: null,
  taxable: true,
  linkedCount: 0,
})

function Save() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="rounded bg-brand-green px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
      {pending ? 'Saving…' : 'Update invoice'}
    </button>
  )
}

function Field({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-center gap-3">
      <label htmlFor={htmlFor} className="text-right text-sm font-medium text-gray-700">
        {label}
      </label>
      <div>{children}</div>
    </div>
  )
}

export function EditInvoiceForm({
  invoice,
  lines,
  itemTypes,
  projects,
  currencies,
  fixedFeeContexts,
}: {
  invoice: EditableInvoice
  lines: EditableLine[]
  itemTypes: { id: string; name: string }[]
  projects: { id: string; label: string }[]
  currencies: string[]
  fixedFeeContexts: Record<string, FixedFeeContextView>
}) {
  const [state, formAction] = useFormState<EditInvoiceState, FormData>(saveInvoiceAction, {})
  const [rows, setRows] = useState<Row[]>(() => (lines.length ? lines.map((l) => ({ ...l, key: l.id })) : [newRow()]))
  const [term, setTerm] = useState(invoice.paymentTerm)
  const [currency, setCurrency] = useState(invoice.currency)
  const [pct, setPct] = useState({ discount: invoice.discountPercent ?? '', tax1: invoice.tax1Percent ?? '', tax2: invoice.tax2Percent ?? '' })
  const [online, setOnline] = useState(invoice.acceptOnlinePayments)
  const [reorder, setReorder] = useState(false)
  const [dirty, setDirty] = useState(false)
  useLeavePageGuard(dirty)

  const update = (key: string, patch: Partial<Row>) => {
    setDirty(true)
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }
  const remove = (r: Row) => {
    if (r.linkedCount > 0 && !window.confirm(`This line bills ${r.linkedCount} tracked time entr${r.linkedCount === 1 ? 'y' : 'ies'} / expenses. Removing it returns them to uninvoiced. Remove it?`)) return
    setDirty(true)
    setRows((rs) => rs.filter((x) => x.key !== r.key))
  }
  const move = (i: number, d: -1 | 1) => {
    setDirty(true)
    setRows((rs) => {
      const j = i + d
      if (j < 0 || j >= rs.length) return rs
      const next = [...rs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  // Live totals with the same integer-cents math the server uses (the server recomputes on save).
  const amounts = rows.map((r) => {
    const q = parseQuantityHundredths(r.quantity)
    const p = parsePriceCents(r.unitPrice)
    return q == null || p == null ? null : lineAmountFromHundredths(q, p)
  })
  const tax1 = parsePercent(pct.tax1) ?? null
  const tax2 = parsePercent(pct.tax2) ?? null
  const totals = computeTotals({
    lineItems: rows.map((r, i) => ({ amountCents: amounts[i] ?? 0, taxable: r.taxable })),
    discountPercent: parsePercent(pct.discount) ?? null,
    tax1Percent: tax1,
    tax2Percent: tax2,
  })
  // Harvest shows the per-line "Tax" checkbox only once a tax applies.
  const showTaxCol = !!tax1 || !!tax2
  const money = (c: number) => formatCents(c, currency)
  const due = totals.totalCents - invoice.paidCents
  const isDraft = invoice.status === 'draft'

  const submittedLines = JSON.stringify(
    rows.map((r) => ({
      id: r.id,
      itemTypeId: r.itemTypeId,
      description: r.description,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      linkedProjectId: r.linkedProjectId,
      taxable: r.taxable,
    })),
  )

  return (
    <form
      action={(fd) => {
        setDirty(false)
        formAction(fd)
      }}
      onChange={() => setDirty(true)}
      className="pb-24"
    >
      <input type="hidden" name="invoiceId" value={invoice.id} />
      <input type="hidden" name="lines" value={submittedLines} />

      {state.error && (
        <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        {/* Two-column header (Harvest layout) */}
        <div className="grid gap-x-10 gap-y-3 md:grid-cols-2">
          <div className="space-y-3">
            <Field label="Invoice ID" htmlFor="number">
              <input
                id="number"
                name="number"
                defaultValue={invoice.number ?? ''}
                placeholder={isDraft ? 'Assigned when sent' : ''}
                className={`${input} max-w-[12rem]`}
              />
            </Field>
            <Field label="PO Number" htmlFor="poNumber">
              <input id="poNumber" name="poNumber" defaultValue={invoice.poNumber ?? ''} className={`${input} max-w-[12rem]`} />
            </Field>
            <Field label="Issue Date" htmlFor="issueDate">
              <input id="issueDate" type="date" name="issueDate" defaultValue={invoice.issueDate ?? ''} className={`${input} max-w-[12rem]`} />
            </Field>
            <Field label="Due Date" htmlFor="paymentTerm">
              <div className="flex flex-wrap items-center gap-2">
                <select id="paymentTerm" name="paymentTerm" value={term} onChange={(e) => setTerm(e.target.value)} className={`${input} max-w-[12rem]`}>
                  {DUE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {term === 'custom' && (
                  <input type="date" name="dueDate" aria-label="Custom due date" defaultValue={invoice.dueDate ?? ''} required className={`${input} max-w-[12rem]`} />
                )}
              </div>
            </Field>
          </div>

          <div className="space-y-3">
            <Field label="Invoice For">
              <div className={readOnly}>{invoice.clientName}</div>
            </Field>
            <Field label="Tax" htmlFor="tax1Percent">
              <div className="flex items-center gap-2">
                <input
                  id="tax1Percent"
                  name="tax1Percent"
                  value={pct.tax1}
                  onChange={(e) => setPct((p) => ({ ...p, tax1: e.target.value }))}
                  placeholder="0"
                  inputMode="decimal"
                  className={`${input} w-20`}
                />
                <span className="text-sm text-gray-500">%</span>
                <input name="tax1Name" defaultValue={invoice.tax1Name ?? ''} placeholder="Name (e.g. Sales tax)" aria-label="Tax name" className={`${input} max-w-[12rem]`} />
              </div>
            </Field>
            <Field label="Tax 2" htmlFor="tax2Percent">
              <div className="flex items-center gap-2">
                <input
                  id="tax2Percent"
                  name="tax2Percent"
                  value={pct.tax2}
                  onChange={(e) => setPct((p) => ({ ...p, tax2: e.target.value }))}
                  placeholder="0"
                  inputMode="decimal"
                  className={`${input} w-20`}
                />
                <span className="text-sm text-gray-500">%</span>
                <input name="tax2Name" defaultValue={invoice.tax2Name ?? ''} placeholder="Name" aria-label="Tax 2 name" className={`${input} max-w-[12rem]`} />
              </div>
            </Field>
            <Field label="Discount" htmlFor="discountPercent">
              <div className="flex items-center gap-2">
                <input
                  id="discountPercent"
                  name="discountPercent"
                  value={pct.discount}
                  onChange={(e) => setPct((p) => ({ ...p, discount: e.target.value }))}
                  placeholder="0"
                  inputMode="decimal"
                  className={`${input} w-20`}
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
            </Field>
            <Field label="Currency" htmlFor="currency">
              <select
                id="currency"
                name="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={invoice.paidCents > 0}
                className={`${input} max-w-[12rem]`}
              >
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {invoice.paidCents > 0 && <input type="hidden" name="currency" value={currency} />}
            </Field>
          </div>
        </div>

        <div className="mt-4">
          <Field label="Subject" htmlFor="subject">
            <input id="subject" name="subject" defaultValue={invoice.subject ?? ''} className={input} />
          </Field>
        </div>

        {/* Line items */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="w-8 py-2" />
                <th className="w-36 py-2 pr-2 font-medium">Item Type</th>
                <th className="py-2 pr-2 font-medium">Description</th>
                <th className="w-24 py-2 pr-2 text-right font-medium">Quantity</th>
                <th className="w-28 py-2 pr-2 text-right font-medium">Unit Price</th>
                {showTaxCol && <th className="w-12 py-2 pr-2 text-center font-medium">Tax</th>}
                <th className="w-28 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const amount = amounts[i]
                const ff = r.linkedProjectId ? fixedFeeContexts[r.linkedProjectId] : undefined
                const badQty = parseQuantityHundredths(r.quantity) == null
                const badPrice = parsePriceCents(r.unitPrice) == null
                return (
                  <tr key={r.key} className="border-b border-gray-100 align-top" data-line-row="">
                    <td className="py-2 pr-1">
                      {reorder ? (
                        <div className="flex flex-col">
                          <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="px-1 text-xs text-gray-500 hover:text-brand-teal disabled:opacity-30">
                            ▲
                          </button>
                          <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down" className="px-1 text-xs text-gray-500 hover:text-brand-teal disabled:opacity-30">
                            ▼
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => remove(r)} aria-label={`Remove line ${i + 1}`} title="Remove line" className="mt-1.5 rounded px-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
                          ✕
                        </button>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <select value={r.itemTypeId ?? ''} onChange={(e) => update(r.key, { itemTypeId: e.target.value || null })} aria-label="Item type" className={input}>
                        <option value="">—</option>
                        {itemTypes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <textarea
                        value={r.description}
                        onChange={(e) => update(r.key, { description: e.target.value })}
                        rows={2}
                        aria-label="Description"
                        className={input}
                      />
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                        <span>Linked project:</span>
                        <select
                          value={r.linkedProjectId ?? ''}
                          onChange={(e) => update(r.key, { linkedProjectId: e.target.value || null })}
                          aria-label="Linked project"
                          className="max-w-[16rem] rounded border border-gray-300 px-1 py-0.5 text-xs"
                        >
                          <option value="">None</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                        <span
                          className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-gray-300 text-[10px] text-gray-500"
                          title="Linking a line to a project counts its amount toward that project's invoiced total (and a Fixed Fee project's remaining fee), and lets you filter invoices by project."
                        >
                          ?
                        </span>
                        {r.linkedCount > 0 && <span className="text-gray-400">· {r.linkedCount} tracked item{r.linkedCount === 1 ? '' : 's'}</span>}
                      </div>
                      {ff && <FixedFeeProjectContext ctx={ff} currency={currency} canManageInvoices />}
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        value={r.quantity}
                        onChange={(e) => update(r.key, { quantity: e.target.value })}
                        inputMode="decimal"
                        aria-label="Quantity"
                        aria-invalid={badQty}
                        className={`${input} text-right ${badQty ? 'border-red-400' : ''}`}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        value={r.unitPrice}
                        onChange={(e) => update(r.key, { unitPrice: e.target.value })}
                        inputMode="decimal"
                        placeholder="0.00"
                        aria-label="Unit price"
                        aria-invalid={badPrice}
                        className={`${input} text-right ${badPrice ? 'border-red-400' : ''}`}
                      />
                    </td>
                    {showTaxCol && (
                      <td className="py-2 pr-2 pt-3 text-center">
                        <input type="checkbox" checked={r.taxable} onChange={(e) => update(r.key, { taxable: e.target.checked })} aria-label="Taxable" className="h-4 w-4" />
                      </td>
                    )}
                    <td className="py-2 pt-3.5 text-right tabular-nums text-gray-800">{amount == null ? '—' : money(amount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDirty(true)
                setRows((rs) => [...rs, newRow()])
              }}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              + Add item
            </button>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => setReorder((v) => !v)}
                aria-pressed={reorder}
                className={`rounded border px-3 py-1.5 text-sm font-medium hover:bg-gray-50 ${reorder ? 'border-brand-teal text-brand-teal' : 'border-gray-300 text-gray-700'}`}
              >
                {reorder ? 'Done reordering' : 'Reorder rows'}
              </button>
            )}
          </div>

          <dl className="w-72 space-y-1 text-sm">
            <div className="flex justify-between text-gray-600">
              <dt>Subtotal</dt>
              <dd className="tabular-nums" data-testid="subtotal">{money(totals.subtotalCents)}</dd>
            </div>
            {totals.discountCents > 0 && (
              <div className="flex justify-between text-gray-600">
                <dt>Discount</dt>
                <dd className="tabular-nums">−{money(totals.discountCents)}</dd>
              </div>
            )}
            {totals.taxCents > 0 && (
              <div className="flex justify-between text-gray-600">
                <dt>Tax</dt>
                <dd className="tabular-nums">{money(totals.taxCents)}</dd>
              </div>
            )}
            {invoice.paidCents > 0 && (
              <div className="flex justify-between text-gray-600">
                <dt>Paid</dt>
                <dd className="tabular-nums">−{money(invoice.paidCents)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-200 pt-1 text-base font-semibold">
              <dt>Amount Due</dt>
              <dd className="tabular-nums" data-testid="amount-due">{money(due)}</dd>
            </div>
            {due < 0 && <p className="text-xs text-red-600">The total can&apos;t be less than what has already been paid.</p>}
          </dl>
        </div>

        <div className="mt-6">
          <label htmlFor="notes" className="text-sm font-medium text-gray-700">
            Notes <span className="font-normal text-gray-400">(optional, displayed on invoice)</span>
          </label>
          <textarea id="notes" name="notes" rows={4} defaultValue={invoice.notes ?? ''} className={`${input} mt-1`} />
          <p className="mt-1 text-xs text-gray-400">
            Formatting tips: <strong>*bold*</strong> <em>_italics_</em>
          </p>
        </div>

        <div className="mt-6 rounded border border-gray-200 bg-gray-50 p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input type="checkbox" name="acceptOnlinePayments" checked={online} onChange={(e) => setOnline(e.target.checked)} className="h-4 w-4" />
            Accept online payments for this invoice
          </label>
          <div className={`ml-6 mt-2 flex gap-5 text-sm ${online ? 'text-gray-700' : 'text-gray-400'}`}>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="allowCardPayments" defaultChecked={invoice.allowCardPayments} disabled={!online} className="h-4 w-4" />
              Credit Card
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="allowAchPayments" defaultChecked={invoice.allowAchPayments} disabled={!online} className="h-4 w-4" />
              ACH
            </label>
          </div>
          {/* Disabled checkboxes aren't submitted; keep their stored choice when online payments are off. */}
          {!online && invoice.allowCardPayments && <input type="hidden" name="allowCardPayments" value="on" />}
          {!online && invoice.allowAchPayments && <input type="hidden" name="allowAchPayments" value="on" />}
          <p className="ml-6 mt-1 text-xs text-gray-400">Uses the company&apos;s Stripe connection; only the methods enabled there are offered.</p>
        </div>
      </div>

      {/* Sticky footer */}
      <div className="sticky bottom-0 z-10 -mx-1 mt-4 flex items-center gap-3 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
        <Save />
        <Link href={`/invoices/${invoice.id}`} className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Cancel
        </Link>
      </div>
    </form>
  )
}
