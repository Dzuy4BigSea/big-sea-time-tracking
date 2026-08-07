import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { formatCents, formatDate } from '@/lib/format'
import { formatMinutes } from '@/modules/shared/duration'
import { isUninvoiced } from '@/modules/invoicing/uninvoiced'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'

export const dynamic = 'force-dynamic'

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  open: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-500',
}

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  const canManage = can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_clients')

  const client = await prisma.client.findFirst({
    where: { id: params.id, accountId },
    include: {
      contacts: { orderBy: { isInvoiceRecipient: 'desc' } },
      projects: {
        orderBy: { name: 'asc' },
        include: {
          timeEntries: {
            select: {
              minutes: true,
              isBillable: true,
              billableRateCents: true,
              invoiceLineItemId: true,
              lockState: true,
            },
          },
        },
      },
      invoices: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!client) notFound()

  const projectRows = client.projects.map((p) => {
    let minutes = 0
    let uninvoicedCents = 0
    for (const e of p.timeEntries) {
      minutes += e.minutes
      const amount = e.isBillable && e.billableRateCents ? Math.round((e.minutes / 60) * e.billableRateCents) : 0
      if (isUninvoiced({ isBillable: e.isBillable, invoiceLineItemId: e.invoiceLineItemId, lockState: e.lockState })) {
        uninvoicedCents += amount
      }
    }
    return { id: p.id, name: p.name, code: p.code, isActive: p.isActive, minutes, uninvoicedCents }
  })

  const outstandingCents = client.invoices
    .filter((i) => i.status === 'open')
    .reduce((s, i) => s + (i.totalCents - i.paidCents), 0)
  const uninvoicedTotal = projectRows.reduce((s, r) => s + r.uninvoicedCents, 0)

  return (
    <div>
      <Link href="/clients" className="text-sm text-gray-500 hover:text-brand-teal">
        ← Back to Clients
      </Link>

      <div className="mb-4 mt-2 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{client.name}</h1>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{client.currency}</span>
        {canManage && (
          <Link
            href={`/clients/${client.id}/edit`}
            className="ml-auto rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
          >
            Edit client
          </Link>
        )}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Projects" value={String(client.projects.length)} />
        <Stat label="Uninvoiced" value={formatCents(uninvoicedTotal, client.currency)} accent="text-brand-green" />
        <Stat label="Outstanding A/R" value={formatCents(outstandingCents, client.currency)} accent="text-brand-teal" />
      </div>

      {client.address && (
        <div className="mb-6 whitespace-pre-line text-sm text-gray-500">{client.address}</div>
      )}

      {client.contacts.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Contacts</h2>
          <ul className="space-y-1 rounded-lg border border-gray-200 bg-white p-4 text-sm">
            {client.contacts.map((ct) => (
              <li key={ct.id} className="flex items-center gap-2">
                <span className="font-medium text-gray-800">
                  {ct.firstName} {ct.lastName}
                </span>
                {ct.title && <span className="text-xs text-gray-400">{ct.title}</span>}
                {ct.email && <span className="text-gray-500">{ct.email}</span>}
                {ct.isInvoiceRecipient && (
                  <span className="rounded bg-brand-teal-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-teal">invoices</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Projects</h2>
      <div className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 text-right font-medium">Tracked</th>
              <th className="px-4 py-3 text-right font-medium">Uninvoiced</th>
            </tr>
          </thead>
          <tbody>
            {projectRows.map((p) => (
              <tr key={p.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3">
                  <Link href={`/projects/${p.id}`} className="font-medium text-gray-900 hover:text-brand-teal">
                    {p.code ? `[${p.code}] ` : ''}
                    {p.name}
                  </Link>
                  {!p.isActive && <span className="ml-2 text-xs text-gray-400">(archived)</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatMinutes(p.minutes)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {p.uninvoicedCents ? formatCents(p.uninvoicedCents, client.currency) : '—'}
                </td>
              </tr>
            ))}
            {projectRows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
                  No projects yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Invoices</h2>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Invoice</th>
              <th className="px-4 py-3 font-medium">Issued</th>
              <th className="px-4 py-3 font-medium">Due</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
              <th className="px-4 py-3 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {client.invoices.map((i) => (
              <tr key={i.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3">
                  <Link href={`/invoices/${i.id}`} className="font-medium text-gray-900 hover:text-brand-teal">
                    {i.number ? `#${i.number}` : 'Draft'}
                  </Link>
                  {i.subject && <div className="text-xs text-gray-400">{i.subject}</div>}
                </td>
                <td className="px-4 py-3 text-gray-600">{formatDate(i.issueDate)}</td>
                <td className="px-4 py-3 text-gray-600">{formatDate(i.dueDate)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[i.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {i.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatCents(i.totalCents, i.currency)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {i.status === 'open' ? formatCents(i.totalCents - i.paidCents, i.currency) : '—'}
                </td>
              </tr>
            ))}
            {client.invoices.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No invoices yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${accent ?? 'text-gray-900'}`}>{value}</div>
    </div>
  )
}
