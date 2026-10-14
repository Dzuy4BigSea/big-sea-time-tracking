import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { requireModule } from '@/lib/modules'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { ymd } from '@/lib/week'
import { EditInvoiceForm } from '@/components/EditInvoiceForm'
import { type FixedFeeContextView } from '@/components/FixedFeeProjectContext'
import { projectFeeCents } from '@/modules/invoicing/fixedFee'
import { projectNotesHtml } from '@/modules/projects/notes'
import { INVOICE_CURRENCIES } from '@/modules/invoicing/saveInvoiceEdit'

export const dynamic = 'force-dynamic'

/**
 * Harvest-style "Edit invoice" (specs/05 §Editing an invoice): one form for the header, Invoice ID,
 * line items and online-payment choice, saved by saveInvoiceAction. Draft and open invoices only.
 */
export default async function EditInvoicePage({ params }: { params: { id: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  await requireModule(accountId, 'invoices')
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_invoices')) redirect(`/invoices/${params.id}`)

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, accountId },
    include: {
      client: true,
      lineItems: { orderBy: { sortOrder: 'asc' }, include: { _count: { select: { timeEntries: true, expenses: true } } } },
    },
  })
  if (!invoice) notFound()

  const editable = invoice.status === 'draft' || invoice.status === 'open'

  // Fixed Fee lines get Harvest's "Show project context" panel (fee / invoiced / remaining + related invoices).
  const linkedIds = [...new Set(invoice.lineItems.map((li) => li.linkedProjectId).filter((x): x is string => !!x))]
  const ffProjects = editable && linkedIds.length
    ? await prisma.project.findMany({
        where: { accountId, id: { in: linkedIds }, projectType: 'fixed_fee' },
        select: { id: true, name: true, notes: true, projectFeesCents: true, budgetMethod: true, budgetValue: true },
      })
    : []
  const ffContexts: Record<string, FixedFeeContextView> = {}
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
      ffContexts[p.id] = {
        projectId: p.id,
        projectName: p.name,
        notesHtml: projectNotesHtml(p.notes),
        feeCents: projectFeeCents(p),
        invoicedElsewhereCents: related.reduce((s, r) => s + r.amountCents, 0),
        thisInvoiceCents: mine.filter((s) => s.invoiceId === invoice.id).reduce((s, r) => s + (r._sum.amountCents ?? 0), 0),
        related,
      }
    }
  }

  // Item types (Invoices → Configure → Item types) and the client's projects for "Linked project".
  const [itemTypes, clientProjects] = editable
    ? await Promise.all([
        prisma.itemType.findMany({ where: { accountId }, orderBy: [{ isSystemDefault: 'desc' }, { name: 'asc' }], select: { id: true, name: true } }),
        prisma.project.findMany({
          where: { accountId, OR: [{ clientId: invoice.clientId }, { id: { in: linkedIds } }] },
          orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
          select: { id: true, name: true, code: true, isActive: true },
        }),
      ])
    : [[], []]
  const dec = (n: unknown) => (n == null ? '' : String(Number(n)))

  return (
    <div>
      <Link href={`/invoices/${invoice.id}`} className="text-sm text-gray-500 hover:text-brand-teal">
        ← Back to invoice
      </Link>
      <h1 className="mb-4 mt-2 text-2xl font-semibold">
        Edit invoice {invoice.number ?? <span className="text-gray-400">(draft)</span>}
      </h1>

      {!editable ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          This invoice is <strong>{invoice.status.replace('_', ' ')}</strong> and can no longer be edited.
        </div>
      ) : (
        <EditInvoiceForm
          invoice={{
            id: invoice.id,
            number: invoice.number,
            status: invoice.status,
            clientName: invoice.client.name,
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
            currency: invoice.currency,
            notes: invoice.notes,
            paidCents: invoice.paidCents,
            acceptOnlinePayments: invoice.acceptOnlinePayments,
            allowCardPayments: invoice.allowCardPayments,
            allowAchPayments: invoice.allowAchPayments,
          }}
          lines={invoice.lineItems.map((li) => ({
            id: li.id,
            itemTypeId: li.itemTypeId,
            description: li.description,
            quantity: dec(li.quantity),
            unitPrice: (li.unitPriceCents / 100).toFixed(2),
            linkedProjectId: li.linkedProjectId,
            taxable: li.taxable,
            linkedCount: li._count.timeEntries + li._count.expenses,
          }))}
          itemTypes={itemTypes}
          projects={clientProjects.map((p) => ({
            id: p.id,
            label: `${p.code ? `[${p.code}] ` : ''}${p.name}${p.isActive ? '' : ' (archived)'}`,
          }))}
          currencies={[...new Set([...INVOICE_CURRENCIES, invoice.currency])]}
          fixedFeeContexts={ffContexts}
        />
      )}
    </div>
  )
}
