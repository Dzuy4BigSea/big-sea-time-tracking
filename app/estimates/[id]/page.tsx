import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { formatCents, formatDate } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { requireModule } from '@/lib/modules'
import { sendEstimateAction, setEstimateStatusAction, convertEstimateAction, deleteEstimateAction } from '@/app/estimates/actions'

export const dynamic = 'force-dynamic'

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-600',
}

export default async function EstimateDetailPage({ params }: { params: { id: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_invoices')) redirect('/')
  await requireModule(accountId, 'estimates')

  const est = await prisma.estimate.findFirst({
    where: { id: params.id, accountId },
    include: {
      client: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
      convertedInvoice: { select: { id: true, number: true } },
    },
  })
  if (!est) notFound()
  const cur = est.currency

  return (
    <div>
      <Link href="/estimates" className="text-sm text-gray-500 hover:text-brand-teal">
        ← Back to Estimates
      </Link>

      <div className="mb-4 mt-2 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Estimate {est.number ? `#${est.number}` : <span className="text-gray-400">(draft)</span>}</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[est.status]}`}>{est.status}</span>
        <div className="ml-auto text-right">
          <div className="text-xs uppercase tracking-wide text-gray-400">Total</div>
          <div className="text-xl font-semibold">{formatCents(est.totalCents, cur)}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {est.status === 'draft' && (
          <form action={sendEstimateAction}>
            <input type="hidden" name="id" value={est.id} />
            <button className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">Send estimate</button>
          </form>
        )}
        {est.status === 'sent' && (
          <>
            <form action={setEstimateStatusAction}>
              <input type="hidden" name="id" value={est.id} />
              <input type="hidden" name="status" value="accepted" />
              <button className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">Mark accepted</button>
            </form>
            <form action={setEstimateStatusAction}>
              <input type="hidden" name="id" value={est.id} />
              <input type="hidden" name="status" value="declined" />
              <button className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600">Mark declined</button>
            </form>
          </>
        )}
        {(est.status === 'sent' || est.status === 'accepted') && !est.convertedInvoice && (
          <form action={convertEstimateAction}>
            <input type="hidden" name="id" value={est.id} />
            <button className="rounded border border-brand-green px-4 py-1.5 text-sm font-medium text-brand-green hover:bg-green-50">Convert to invoice</button>
          </form>
        )}
        {est.convertedInvoice && (
          <Link href={`/invoices/${est.convertedInvoice.id}`} className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            View invoice {est.convertedInvoice.number ? `#${est.convertedInvoice.number}` : '(draft)'} ↗
          </Link>
        )}
        {est.status === 'draft' && (
          <form action={deleteEstimateAction}>
            <input type="hidden" name="id" value={est.id} />
            <button className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600">Delete draft</button>
          </form>
        )}
      </div>

      {/* Document */}
      <div className="rounded-lg border border-gray-200 bg-white p-8">
        <div className="flex justify-between text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400">Estimate for</div>
            <div className="mt-1 font-medium">{est.client.name}</div>
            {est.client.address && <div className="whitespace-pre-line text-gray-600">{est.client.address}</div>}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-gray-400">Estimate</div>
            <div className="font-medium">{est.number ? `#${est.number}` : '—'}</div>
            {est.sentAt && <div className="text-xs text-gray-500">Sent {formatDate(est.sentAt)}</div>}
          </div>
        </div>

        {est.subject && (
          <div className="mt-6 text-sm">
            <span className="text-xs uppercase tracking-wide text-gray-400">Subject</span>
            <div className="mt-1">{est.subject}</div>
          </div>
        )}

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {est.lineItems.map((li) => (
              <tr key={li.id} className="border-b border-gray-100">
                <td className="py-2 pr-4">{li.description}</td>
                <td className="py-2 text-right">{formatCents(li.amountCents, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <dl className="w-64 space-y-1 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>{formatCents(est.subtotalCents, cur)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold">
              <span>Total</span>
              <span>{formatCents(est.totalCents, cur)}</span>
            </div>
          </dl>
        </div>
      </div>
    </div>
  )
}
