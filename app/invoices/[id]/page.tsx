import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { displayBadge, type StoredStatus } from '@/modules/invoicing/invoiceState'
import { todayIn } from '@/lib/tz'
import { deriveStatusBanner, balanceNote } from '@/modules/invoicing/statusBanner'
import { InvoiceStamp } from '@/components/InvoiceStamp'
import { formatCents, formatDate, formatDateTimeAt } from '@/lib/format'
import { BADGE_STYLES, BADGE_LABEL, PAYMENT_TERM_LABEL, PAYMENT_METHOD_LABEL } from '@/lib/labels'
import { ymd } from '@/lib/week'
import { RecordPaymentForm } from '@/components/RecordPaymentForm'
import { InvoiceLineItems } from '@/components/InvoiceLineItems'
import { InvoiceNotesText } from '@/components/InvoiceNotes'
import { CopyInvoiceLinkButton } from '@/components/CopyInvoiceLinkButton'
import { DropdownMenu } from '@/components/DropdownMenu'
import {
  sendInvoiceAction,
  markDraftAction,
  deleteInvoiceAction,
  writeOffInvoiceAction,
  reopenInvoiceAction,
  duplicateInvoiceAction,
  copyToXeroAction,
  resendInvoiceAction,
  sendReminderAction,
} from '@/app/invoices/actions'
import { deletePaymentAction } from '@/app/invoices/actions'
import { createRecurringFromInvoiceAction } from '@/app/recurring/actions'
import { requireCapability } from '@/lib/session'
import { requireModule } from '@/lib/modules'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { ConfirmSubmit } from '@/components/ConfirmSubmit'
import { getInvoiceAppearance, applyEntityBranding } from '@/lib/appearance'
import { listAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export default async function InvoiceDetailPage({ params, searchParams }: { params: { id: string }; searchParams?: { error?: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireCapability('manage_invoices')
  await requireModule(accountId, 'invoices')
  const canManage = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_invoices')
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, accountId },
    include: {
      client: true,
      account: true,
      entity: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
      payments: { orderBy: { paidOn: 'asc' } },
    },
  })
  if (!invoice) notFound()

  const appearance = applyEntityBranding(await getInvoiceAppearance(accountId), invoice.entity)
  const BRAND = appearance.brandColor
  const fromName = invoice.entity?.name ?? invoice.account.name
  const activity = await listAudit(accountId, 'invoice', invoice.id)
  const latest = activity[0]

  // The account's calendar day, so the badge and banner flip to Late on the same day (AC-STAT-001).
  const today = todayIn(invoice.account.timezone)
  const badge = displayBadge(
    {
      status: invoice.status as StoredStatus,
      sentAt: invoice.sentAt,
      dueDate: invoice.dueDate,
      totalCents: invoice.totalCents,
      paidCents: invoice.paidCents,
    },
    today,
  )
  const due = invoice.totalCents - invoice.paidCents
  const cur = invoice.currency
  const banner = deriveStatusBanner(
    {
      status: invoice.status as StoredStatus,
      dueDate: invoice.dueDate,
      sentAt: invoice.sentAt,
      totalCents: invoice.totalCents,
      paidCents: invoice.paidCents,
      lastPaymentOn: invoice.payments.length ? invoice.payments[invoice.payments.length - 1].paidOn : null,
      currency: cur,
    },
    today,
  )
  const note = balanceNote(banner)

  // "This invoice is linked to the project …" (Harvest) — the projects its lines are linked to.
  const linkedProjectIds = [...new Set(invoice.lineItems.map((li) => li.linkedProjectId).filter((x): x is string => !!x))]
  const linkedProjects = linkedProjectIds.length
    ? await prisma.project.findMany({ where: { accountId, id: { in: linkedProjectIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
    : []

  const isOpen = invoice.status === 'open'
  const hasPublicLink = !!invoice.publicToken && invoice.status !== 'draft'
  const editable = invoice.status === 'draft' || isOpen
  const btn = 'rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50'
  const primary = 'rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90'

  return (
    <div>
      <Link href="/invoices" className="text-sm text-gray-500 hover:text-brand-teal">
        ← Back to Invoices
      </Link>

      {/* Title row (Harvest): "Invoice 392631" + status pill + "View on Xero"; Preview / PDF / Print on the right */}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Invoice {invoice.number ?? <span className="text-gray-400">(draft)</span>}</h1>
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_STYLES[badge]}`}>
          {BADGE_LABEL[badge]}
        </span>
        {invoice.entity && (
          <span className="rounded bg-brand-teal-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-teal" title={`Billed as ${invoice.entity.name}`}>
            {invoice.entity.code}
          </span>
        )}
        {invoice.xeroInvoiceId && (
          <a
            href={`https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(invoice.xeroInvoiceId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-600 hover:border-brand-teal hover:text-brand-teal"
          >
            View on Xero ↗
          </a>
        )}
        <div className="ml-auto flex items-center gap-2">
          {hasPublicLink && (
            <a href={`/i/${invoice.publicToken}`} target="_blank" rel="noopener noreferrer" className={btn} title="See the invoice as your client does">
              Preview
            </a>
          )}
          <a href={`/print/${invoice.id}`} target="_blank" rel="noopener noreferrer" className={btn} title="Opens the print view — choose “Save as PDF”">
            PDF
          </a>
          <a href={`/print/${invoice.id}`} target="_blank" rel="noopener noreferrer" className={btn}>
            Print
          </a>
        </div>
      </div>

      {latest && (
        <p className="mt-2 text-sm text-gray-500">
          Latest activity: <span className="text-gray-700">{latest.summary}.</span>
          {latest.actorName ? ` ${latest.actorName}` : ''} on {formatDateTimeAt(latest.createdAt, invoice.account.timezone)}
          {' '}
          <a href="#history" className="ml-1 text-brand-teal hover:underline">View history</a>
        </p>
      )}

      {linkedProjects.length > 0 && (
        <p className="mt-1 flex flex-wrap items-center gap-1 text-sm text-gray-500">
          <span aria-hidden="true">🔗</span>
          This invoice is linked to the project{linkedProjects.length > 1 ? 's' : ''}{' '}
          {linkedProjects.map((p, i) => (
            <span key={p.id}>
              <Link href={`/projects/${p.id}`} className="text-brand-teal hover:underline">{p.name}</Link>
              {i < linkedProjects.length - 2 ? ', ' : i === linkedProjects.length - 2 ? ' and ' : ''}
            </span>
          ))}
          .
        </p>
      )}

      {searchParams?.error && (
        <div role="alert" className="mt-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {searchParams.error}
        </div>
      )}

      {/* Action row (Harvest): primary send/reminder, Copy invoice link, Edit, Actions ▾ … Balance + Record payment */}
      <div className="mb-4 mt-4 flex flex-wrap items-center gap-2">
        {invoice.status === 'draft' && (
          <form action={sendInvoiceAction}>
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <button className={primary}>Send invoice</button>
          </form>
        )}
        {isOpen && (
          <form action={sendReminderAction}>
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <button className={primary}>Send reminder</button>
          </form>
        )}

        {hasPublicLink && <CopyInvoiceLinkButton path={`/i/${invoice.publicToken}`} className={btn} />}

        {editable && (
          <a href={`/invoices/${invoice.id}/edit`} className={btn}>
            Edit invoice
          </a>
        )}

        <DropdownMenu
          label={
            <>
              Actions <span className="text-xs">▾</span>
            </>
          }
          summaryClassName={`flex cursor-pointer list-none items-center gap-1 ${btn}`}
          menuClassName="absolute left-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-gray-200 bg-white py-1 text-left shadow-lg"
        >
          {(isOpen || invoice.status === 'paid') && <MenuForm action={resendInvoiceAction} invoiceId={invoice.id} label="Resend invoice" />}
          {isOpen && <MenuForm action={markDraftAction} invoiceId={invoice.id} label="Mark as draft" />}
          {(isOpen || invoice.status === 'paid') && <MenuForm action={copyToXeroAction} invoiceId={invoice.id} label="Copy to Xero" />}
          <MenuForm action={duplicateInvoiceAction} invoiceId={invoice.id} label="Duplicate" />
          {invoice.lineItems.length > 0 && <MenuForm action={createRecurringFromInvoiceAction} invoiceId={invoice.id} label="Create recurring" />}
          {/* No per-invoice reminder schedule exists yet; this opens the account's reminder email wording. */}
          {isOpen && (
            <Link href="/invoices/configure?section=messages" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
              Set up reminder email
            </Link>
          )}
          {(isOpen || invoice.status === 'written_off' || invoice.status === 'draft') && <div className="my-1 border-t border-gray-100" />}
          {isOpen && <MenuForm action={writeOffInvoiceAction} invoiceId={invoice.id} label="Write off invoice" danger />}
          {invoice.status === 'written_off' && <MenuForm action={reopenInvoiceAction} invoiceId={invoice.id} label="Re-open invoice" />}
          {invoice.status === 'draft' && <MenuForm action={deleteInvoiceAction} invoiceId={invoice.id} label="Delete" danger />}
          {isOpen && (
            <form action={deleteInvoiceAction}>
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <ConfirmSubmit
                message={`Delete invoice ${invoice.number ?? ''}? This releases its billed time/expenses back to the uninvoiced pool.`}
                className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              >
                Delete
              </ConfirmSubmit>
            </form>
          )}
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-3">
          {/* The status itself is the stamp on the invoice below (BugHerd #14); the stamp's tooltip keeps the full detail. */}
          <div role="status" className="text-sm text-gray-700">
            Balance: <span className="font-semibold">{formatCents(due, cur)}</span>
            {note && <span className={`ml-1 ${note.late ? 'font-medium text-red-600' : 'text-gray-500'}`}>{note.text}</span>}
          </div>
          {isOpen && (
            <details className="relative" data-record-payment="">
              <summary className={`list-none cursor-pointer ${btn}`}>Record payment</summary>
              <div className="absolute right-0 z-20 mt-1 w-[30rem] max-w-[calc(100vw-2rem)] shadow-lg">
                <RecordPaymentForm invoiceId={invoice.id} defaultDate={ymd(new Date())} dueLabel={formatCents(due, cur)} />
              </div>
            </details>
          )}
        </div>
      </div>

      {/* Rendered invoice document */}
      <div className="relative rounded-lg border border-gray-200 bg-white p-8">
        {/* Harvest-style status stamp over the document */}
        <div className="absolute left-1/2 top-8 -translate-x-1/2">
          <InvoiceStamp kind={banner.kind} title={`${banner.headline} · ${banner.detail}`} />
        </div>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {appearance.logoFileUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={appearance.logoFileUrl} alt={`${fromName} logo`} className="h-10 w-auto" />
            )}
            <div className="text-lg font-semibold tracking-tight">{fromName}</div>
          </div>
          {appearance.showDocumentTitle && (
            <div className="text-2xl font-bold tracking-wide" style={{ color: BRAND }}>
              {appearance.documentTitle}
            </div>
          )}
        </div>

        <div className="mt-8 flex justify-between gap-8 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400">Invoice for</div>
            <div className="mt-1 font-medium">{invoice.client.name}</div>
            {invoice.client.address && (
              <div className="whitespace-pre-line text-gray-600">{invoice.client.address}</div>
            )}
          </div>
          <div className="text-right">
            <dl className="space-y-1">
              <Row label="Invoice ID" value={invoice.number ?? '—'} />
              <Row label="Issue date" value={formatDate(invoice.issueDate)} />
              <Row
                label="Due date"
                value={`${formatDate(invoice.dueDate)}${
                  invoice.dueDate ? ` (${PAYMENT_TERM_LABEL[invoice.paymentTerm] ?? invoice.paymentTerm})` : ''
                }`}
              />
              {invoice.poNumber && <Row label="PO number" value={invoice.poNumber} />}
            </dl>
          </div>
        </div>

        {invoice.subject && (
          <div className="mt-6 text-sm">
            <span className="text-xs uppercase tracking-wide text-gray-400">Subject</span>
            <div className="mt-1">{invoice.subject}</div>
          </div>
        )}

        {/* Line items */}
        <InvoiceLineItems
          items={invoice.lineItems.map((li) => ({
            id: li.id,
            description: li.description,
            quantity: Number(li.quantity),
            unitPriceCents: li.unitPriceCents,
            amountCents: li.amountCents,
          }))}
          appearance={appearance}
          currency={cur}
        />

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <dl className="w-64 space-y-1 text-sm">
            <TotalRow label="Subtotal" value={formatCents(invoice.subtotalCents, cur)} />
            {invoice.discountCents > 0 && <TotalRow label="Discount" value={`−${formatCents(invoice.discountCents, cur)}`} />}
            {invoice.taxCents > 0 && <TotalRow label="Tax" value={formatCents(invoice.taxCents, cur)} />}
            <div className="border-t border-gray-200 pt-1">
              <TotalRow label="Total" value={formatCents(invoice.totalCents, cur)} bold />
            </div>
            {invoice.paidCents > 0 && <TotalRow label="Paid" value={`−${formatCents(invoice.paidCents, cur)}`} />}
            <TotalRow label="Amount due" value={formatCents(due, cur)} bold brandColor={BRAND} />
          </dl>
        </div>

        {invoice.notes && (
          <div className="mt-8 border-t border-gray-200 pt-4 text-xs text-gray-500">
            <div className="mb-1 uppercase tracking-wide">Notes</div>
            <div className="whitespace-pre-line"><InvoiceNotesText text={invoice.notes} /></div>
          </div>
        )}
      </div>

      {/* Payments */}
      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Payments</h2>
        {invoice.payments.length === 0 ? (
          <p className="text-sm text-gray-400">No payments recorded.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
            {invoice.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-2">
                <span className="text-gray-600">
                  {formatDate(p.paidOn)} · {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                  {p.note ? ` · ${p.note}` : ''}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium">{formatCents(p.amountCents, cur)}</span>
                  {canManage && (
                    <form action={deletePaymentAction}>
                      <input type="hidden" name="paymentId" value={p.id} />
                      <ConfirmSubmit message={`Remove this ${formatCents(p.amountCents, cur)} payment? The invoice will reopen if it becomes underpaid.`} className="text-xs text-gray-400 hover:text-red-600">
                        ✕
                      </ConfirmSubmit>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Activity / history (spec 17) */}
      {activity.length > 0 && (
        <div id="history" className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">History</h2>
          <ol className="rounded-lg border border-gray-200 bg-white text-sm">
            {activity.map((a) => (
              <li key={a.id} className="flex items-start gap-3 border-b border-gray-100 px-4 py-2.5 last:border-0">
                <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-brand-teal" />
                <span className="flex-1 text-gray-700">{a.summary}</span>
                <span className="whitespace-nowrap text-xs text-gray-400">
                  {a.actorName ? `${a.actorName} · ` : ''}
                  {formatDate(a.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function MenuForm({
  action,
  invoiceId,
  label,
  danger,
}: {
  action: (formData: FormData) => void | Promise<void>
  invoiceId: string
  label: string
  danger?: boolean
}) {
  return (
    <form action={action}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <button
        type="submit"
        className={`block w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700'}`}
      >
        {label}
      </button>
    </form>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-end gap-6">
      <dt className="text-gray-400">{label}</dt>
      <dd className="font-medium text-gray-800">{value}</dd>
    </div>
  )
}

function TotalRow({ label, value, bold, brandColor }: { label: string; value: string; bold?: boolean; brandColor?: string }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : 'text-gray-600'}`}>
      <span>{label}</span>
      <span style={brandColor ? { color: brandColor } : undefined}>{value}</span>
    </div>
  )
}
