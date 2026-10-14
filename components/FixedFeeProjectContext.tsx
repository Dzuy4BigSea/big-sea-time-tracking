import Link from 'next/link'
import { formatCents, formatDate } from '@/lib/format'

export interface RelatedInvoiceView {
  id: string
  label: string // number, or "Draft"
  status: string
  issueDate: Date | null
  amountCents: number // this project's lines only
}

export interface FixedFeeContextView {
  projectId: string
  projectName: string
  notesHtml: string // sanitized on the server (modules/projects/notes.ts); '' when none
  feeCents: number | null
  invoicedElsewhereCents: number // other invoices
  thisInvoiceCents: number
  related: RelatedInvoiceView[]
}

/**
 * Harvest's "Show project context" for a Fixed Fee line on a draft invoice: project notes, the fee
 * (total / amount invoiced / remaining to invoice) and the related invoices with the amount billed
 * for this project on each. A native <details> toggle, so it works without client JS.
 */
export function FixedFeeProjectContext({ ctx, currency, canManageInvoices }: { ctx: FixedFeeContextView; currency: string; canManageInvoices: boolean }) {
  const invoiced = ctx.invoicedElsewhereCents + ctx.thisInvoiceCents
  const remaining = ctx.feeCents == null ? null : ctx.feeCents - invoiced
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer select-none text-brand-teal hover:underline">Show project context</summary>
      <div className="mt-2 w-72 space-y-3 rounded border border-gray-200 bg-gray-50 p-3 text-gray-700">
        <div>
          <div className="font-semibold uppercase tracking-wide text-gray-400">Project notes</div>
          {ctx.notesHtml ? (
            <div className="rich-text mt-1" dangerouslySetInnerHTML={{ __html: ctx.notesHtml }} />
          ) : (
            <p className="mt-1 text-gray-400">No notes for {ctx.projectName}.</p>
          )}
        </div>
        <div>
          <div className="font-semibold uppercase tracking-wide text-gray-400">Project fee</div>
          {ctx.feeCents == null ? (
            <p className="mt-1 text-gray-400">No project fee set.</p>
          ) : (
            <dl className="mt-1 space-y-0.5">
              <div className="flex justify-between"><dt>Total project fee</dt><dd className="tabular-nums">{formatCents(ctx.feeCents, currency)}</dd></div>
              <div className="flex justify-between"><dt>Amount invoiced</dt><dd className="tabular-nums">{formatCents(ctx.invoicedElsewhereCents, currency)}</dd></div>
              <div className="flex justify-between"><dt>This invoice</dt><dd className="tabular-nums">{formatCents(ctx.thisInvoiceCents, currency)}</dd></div>
              <div className="flex justify-between border-t border-gray-200 pt-0.5 font-medium">
                <dt>Remaining to invoice</dt>
                <dd className={`tabular-nums ${remaining != null && remaining < 0 ? 'text-red-600' : ''}`}>{formatCents(remaining ?? 0, currency)}</dd>
              </div>
            </dl>
          )}
        </div>
        <div>
          <div className="font-semibold uppercase tracking-wide text-gray-400">Related invoices</div>
          {ctx.related.length === 0 ? (
            <p className="mt-1 text-gray-400">No other invoices for this project.</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {ctx.related.map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <span>
                    {canManageInvoices ? (
                      <Link href={`/invoices/${r.id}`} className="text-brand-teal hover:underline">{r.label}</Link>
                    ) : (
                      r.label
                    )}
                    <span className="ml-1 text-gray-400">{r.issueDate ? formatDate(r.issueDate) : r.status}</span>
                  </span>
                  <span className="tabular-nums">{formatCents(r.amountCents, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  )
}
