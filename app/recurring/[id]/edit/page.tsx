import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { requireModule } from '@/lib/modules'
import { getAccountClock } from '@/lib/accountClock'
import { todayIn } from '@/lib/tz'
import { addDaysUtc, scheduleToForm, type RecurringFrequency } from '@/modules/invoicing/recurring'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { RecurringTemplateForm, type TemplateLineRow } from '@/components/RecurringTemplateForm'
import { ConfirmSubmit } from '@/components/ConfirmSubmit'
import { deleteRecurringAction } from '@/app/recurring/actions'

export const dynamic = 'force-dynamic'

interface StoredLine {
  description?: string
  quantity?: number
  unitPriceCents?: number
  taxable?: boolean
  linkedProjectId?: string | null
}

/** Invoices > Recurring > template > "Edit recurring template" (specs/27 AC-REC-105). */
export default async function EditRecurringPage({ params }: { params: { id: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_invoices')) redirect('/')
  await requireModule(accountId, 'invoices')

  const [p, clock] = await Promise.all([
    prisma.recurringInvoiceProfile.findFirst({ where: { id: params.id, accountId }, include: { client: { select: { name: true, currency: true } } } }),
    getAccountClock(accountId),
  ])
  if (!p) notFound()

  const tomorrow = addDaysUtc(todayIn(clock.timezone), 1).toISOString().slice(0, 10)
  const sched = scheduleToForm(p.frequency as RecurringFrequency, p.intervalCount)
  const stored = Array.isArray(p.templateLineItems) ? (p.templateLineItems as unknown as StoredLine[]) : []
  const lines: TemplateLineRow[] = stored.map((l) => ({
    description: String(l.description ?? ''),
    quantity: String(l.quantity ?? 1),
    unitPrice: ((l.unitPriceCents ?? 0) / 100).toFixed(2),
    meta: JSON.stringify({ taxable: !!l.taxable, linkedProjectId: l.linkedProjectId ?? null }),
  }))

  return (
    <div className="max-w-4xl">
      <Link href="/recurring" className="text-sm text-gray-500 hover:text-brand-teal">
        ← Back to Recurring invoices
      </Link>
      <div className="mb-4 mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Edit recurring template</h1>
        <form action={deleteRecurringAction}>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="redirect" value="1" />
          <ConfirmSubmit
            message="Delete this recurring invoice? No more invoices will be generated from it. Invoices it already generated are kept. This can't be undone."
            className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Delete recurring invoice
          </ConfirmSubmit>
        </form>
      </div>
      <p className="mb-4 text-sm text-gray-500">Changes apply to future invoices only. Invoices already generated are not changed.</p>
      <RecurringTemplateForm
        mode="edit"
        clientName={p.client.name}
        currency={p.client.currency ?? 'USD'}
        minDate={tomorrow}
        initial={{
          id: p.id,
          subject: p.subject,
          preset: sched.preset,
          customN: sched.customN,
          customUnit: sched.customUnit,
          nextIssueDate: p.nextIssueDate ? p.nextIssueDate.toISOString().slice(0, 10) : tomorrow,
          occurrences: p.remainingOccurrences != null && p.remainingOccurrences > 0 ? String(p.remainingOccurrences) : '',
          paymentTerm: p.paymentTerm,
          notes: p.notes ?? '',
          lines,
        }}
      />
    </div>
  )
}
