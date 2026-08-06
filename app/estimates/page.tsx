import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { formatCents, formatDate } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { requireModule } from '@/lib/modules'
import { NewEstimateForm } from '@/components/NewEstimateForm'

export const dynamic = 'force-dynamic'

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-600',
}

export default async function EstimatesPage() {
  const { accountId, permissionProfile } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile }, 'manage_invoices')) redirect('/')
  await requireModule(accountId, 'estimates')

  const [estimates, clients] = await Promise.all([
    prisma.estimate.findMany({
      where: { accountId },
      include: { client: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }],
    }),
    prisma.client.findMany({ where: { accountId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Estimates</h1>
      <p className="mb-6 text-sm text-gray-500">Quotes sent before work begins · live from Supabase</p>

      <NewEstimateForm clients={clients} />

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Number</th>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Subject</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Sent</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {estimates.map((e) => (
              <tr key={e.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/estimates/${e.id}`} className="text-gray-700 hover:text-brand-teal">
                    {e.number ? `#${e.number}` : <span className="text-gray-400">Draft</span>}
                  </Link>
                </td>
                <td className="px-4 py-3 font-medium text-gray-900">
                  <Link href={`/estimates/${e.id}`} className="hover:text-brand-teal">
                    {e.client.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-600">{e.subject ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[e.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {e.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500">{formatDate(e.sentAt)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatCents(e.totalCents, e.currency)}</td>
              </tr>
            ))}
            {estimates.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">No estimates yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
