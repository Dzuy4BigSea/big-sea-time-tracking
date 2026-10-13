import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { requireModule } from '@/lib/modules'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { formatCents } from '@/lib/format'
import { ymd } from '@/lib/week'
import { EditInvoiceForm } from '@/components/EditInvoiceForm'
import { FixedFeeProjectContext, type FixedFeeContextView } from '@/components/FixedFeeProjectContext'
import { projectFeeCents } from '@/modules/invoicing/fixedFee'
import { addLineItemAction, updateLineItemAction, removeLineItemAction } from '@/app/invoices/[id]/edit/actions'

export const dynamic = 'force-dynamic'

const inp = 'rounded border border-gray-300 px-2 py-1 text-sm'

export default async function EditInvoicePage({ params }: { params: { id: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  await requireModule(accountId, 'invoices')
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_invoices')) redirect(`/invoices/${params.id}`)

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, accountId },
    include: { client: true, lineItems: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!invoice) notFound()

  const isDraft = invoice.status === 'draft'

  // Fixed Fee lines get Harvest's "Show project context" panel (fee / invoiced / remaining + related invoices).
  const linkedIds = [...new Set(invoice.lineItems.map((li) => li.linkedProjectId).filter((x): x is string => !!x))]
  const ffProjects = isDraft && linkedIds.length
    ? await prisma.project.findMany({
        where: { accountId, id: { in: linkedIds }, projectType: 'fixed_fee' },
        select: { id: true, name: true, notes: true, projectFeesCents: true, budgetMethod: true, budgetValue: true },
      })
    : []
  const ffContexts = new Map<string, FixedFeeContextView>()
  if (ffProjects.length) {
    const ids = ffProjects.map((p) => p.id)
    // Same rule as fixedFeeStatus: every linked non-expense line on any existing invoice counts.
    const sums = await prisma.invoiceLineItem.groupBy({
      by: ['linkedProjectId', 'invoiceId'],
      where: { accountId, linkedProjectId: { in: ids }, kind: { not: 'expense' } },
      _sum: { amountCents: true },
    })
    const otherIds = [...new Set(sums.map((s) => s.invoiceId).filter((id) => id !== invoice.id))]
    const others = otherIds.length
      ? await prisma.invoice.findMany({ where: { accountId, id: { in: otherIds } }, select: { id: true, number: true, status: true, issueDate: true } })
      : []
    const byId = new Map(others.map((o) => [o.id, o]))
    for (const p of ffProjects) {
      const mine = sums.filter((s) => s.linkedProjectId === p.id)
      const related = mine
        .filter((s) => s.invoiceId !== invoice.id && byId.has(s.invoiceId))
        .map((s) => {
          const o = byId.get(s.invoiceId)!
          return { id: o.id, label: o.number ? `#${o.number}` : 'Draft', status: o.status, issueDate: o.issueDate, amountCents: s._sum.amountCents ?? 0 }
        })
        .sort((a, b) => (b.issueDate?.getTime() ?? 0) - (a.issueDate?.getTime() ?? 0))
      ffContexts.set(p.id, {
        projectId: p.id,
        projectName: p.name,
        notes: p.notes,
        feeCents: projectFeeCents(p),
        invoicedElsewhereCents: related.reduce((s, r) => s + r.amountCents, 0),
        thisInvoiceCents: mine.filter((s) => s.invoiceId === invoice.id).reduce((s, r) => s + (r._sum.amountCents ?? 0), 0),
        related,
      })
    }
  }
  const editableMeta = isDraft || invoice.status === 'open'
  const cur = invoice.currency
  const dec = (n: unknown) => (n == null ? '' : String(Number(n)))

  return (
    <div>
      <Link href={`/invoices/${invoice.id}`} className="text-sm text-gray-500 hover:text-brand-teal">
        ← Back to invoice
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold">
        Edit invoice {invoice.number ?? <span className="text-gray-400">(draft)</span>}
      </h1>
      <p className="mb-4 text-sm text-gray-500">{invoice.client.name}</p>

      {!editableMeta && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          This invoice is <strong>{invoice.status}</strong> and can no longer be edited.
        </div>
      )}

      {editableMeta && (
        <EditInvoiceForm
          invoice={{
            id: invoice.id,
            subject: invoice.subject,
            poNumber: invoice.poNumber,
            issueDate: invoice.issueDate ? ymd(invoice.issueDate) : null,
            dueDate: invoice.dueDate ? ymd(invoice.dueDate) : null,
            paymentTerm: invoice.paymentTerm,
            discountPercent: dec(invoice.discountPercent) || null,
            tax1Name: invoice.tax1Name,
            tax1Percent: dec(invoice.tax1Percent) || null,
            tax2Name: invoice.tax2Name,
            tax2Percent: dec(invoice.tax2Percent) || null,
            terms: invoice.terms,
            notes: invoice.notes,
          }}
        />
      )}

      {/* Line items */}
      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500">Line items</h2>
      {!isDraft ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
          Line items lock once an invoice is sent. To change them, use <strong>Actions → Mark as draft</strong> first.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">Qty</th>
                <th className="px-3 py-2 font-medium">Unit price</th>
                <th className="px-3 py-2 text-center font-medium">Tax</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((li) => (
                <tr key={li.id} className="border-b border-gray-100 align-middle last:border-0">
                  <td className="px-3 py-2">
                    <form id={`li-${li.id}`} action={updateLineItemAction} className="contents">
                      <input type="hidden" name="invoiceId" value={invoice.id} />
                      <input type="hidden" name="lineItemId" value={li.id} />
                      <input name="description" defaultValue={li.description} className={`${inp} w-full`} />
                    </form>
                  </td>
                  <td className="px-3 py-2">
                    <input form={`li-${li.id}`} name="quantity" defaultValue={dec(li.quantity)} className={`${inp} w-16`} />
                  </td>
                  <td className="px-3 py-2">
                    <input form={`li-${li.id}`} name="unitPrice" defaultValue={(li.unitPriceCents / 100).toFixed(2)} className={`${inp} w-24`} />
                    {li.linkedProjectId && ffContexts.has(li.linkedProjectId) && (
                      <FixedFeeProjectContext ctx={ffContexts.get(li.linkedProjectId)!} currency={cur} canManageInvoices />
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input form={`li-${li.id}`} type="checkbox" name="taxable" defaultChecked={li.taxable} className="h-4 w-4" />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatCents(li.amountCents, cur)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button form={`li-${li.id}`} type="submit" className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
                        Save
                      </button>
                      <form action={removeLineItemAction}>
                        <input type="hidden" name="invoiceId" value={invoice.id} />
                        <input type="hidden" name="lineItemId" value={li.id} />
                        <button type="submit" className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-red-50 hover:text-red-600">
                          ✕
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {invoice.lineItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-gray-400">No line items yet — add one below.</td>
                </tr>
              )}
              {/* Add row */}
              <tr className="bg-gray-50">
                <td className="px-3 py-2">
                  <form id={`li-add-${invoice.id}`} action={addLineItemAction} className="contents">
                    <input type="hidden" name="invoiceId" value={invoice.id} />
                    <input name="description" placeholder="New line item…" className={`${inp} w-full`} />
                  </form>
                </td>
                <td className="px-3 py-2">
                  <input form={`li-add-${invoice.id}`} name="quantity" defaultValue="1" className={`${inp} w-16`} />
                </td>
                <td className="px-3 py-2">
                  <input form={`li-add-${invoice.id}`} name="unitPrice" placeholder="0.00" className={`${inp} w-24`} />
                </td>
                <td className="px-3 py-2 text-center">
                  <input form={`li-add-${invoice.id}`} type="checkbox" name="taxable" defaultChecked className="h-4 w-4" />
                </td>
                <td />
                <td className="px-3 py-2 text-right">
                  <button form={`li-add-${invoice.id}`} type="submit" className="rounded bg-brand-green px-3 py-1 text-xs font-medium text-white hover:opacity-90">
                    Add
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Totals preview */}
      <div className="mt-4 flex justify-end">
        <dl className="w-64 space-y-1 text-sm">
          <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatCents(invoice.subtotalCents, cur)}</span></div>
          {invoice.discountCents > 0 && <div className="flex justify-between text-gray-600"><span>Discount</span><span>−{formatCents(invoice.discountCents, cur)}</span></div>}
          {invoice.taxCents > 0 && <div className="flex justify-between text-gray-600"><span>Tax</span><span>{formatCents(invoice.taxCents, cur)}</span></div>}
          <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold"><span>Total</span><span>{formatCents(invoice.totalCents, cur)}</span></div>
        </dl>
      </div>
    </div>
  )
}
