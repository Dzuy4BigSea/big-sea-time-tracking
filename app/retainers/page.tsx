import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { isUninvoiced } from '@/modules/invoicing/uninvoiced'
import { requireModule } from '@/lib/modules'
import { NewRetainerForm } from '@/components/NewRetainerForm'
import { addDepositAction, applyDrawdownAction, archiveRetainerAction } from '@/app/retainers/actions'

export const dynamic = 'force-dynamic'

const amt = 'w-24 rounded border border-gray-300 px-2 py-1 text-sm'

export default async function RetainersPage() {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_invoices')) {
    redirect('/')
  }
  await requireModule(accountId, 'invoices')

  const [retainers, clients, timeRows, expenseRows] = await Promise.all([
    prisma.retainer.findMany({
      where: { accountId },
      include: { client: { select: { name: true, currency: true } }, project: { select: { name: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.client.findMany({
      where: { accountId },
      select: { id: true, name: true, projects: { where: { isActive: true }, select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.timeEntry.findMany({
      where: { accountId, isBillable: true, isRunning: false, invoiceLineItemId: null, lockState: { not: 'invoiced' } },
      select: { minutes: true, billableRateCents: true, invoiceLineItemId: true, lockState: true, isBillable: true, project: { select: { id: true, clientId: true } } },
    }),
    prisma.expense.findMany({
      where: { accountId, isBillable: true, invoiceLineItemId: null, lockState: { not: 'invoiced' } },
      select: { totalCents: true, markupPercent: true, project: { select: { id: true, clientId: true } } },
    }),
  ])

  // Aggregate uninvoiced billable amounts keyed by clientId and by clientId|projectId.
  const byClient = new Map<string, number>()
  const byProject = new Map<string, number>()
  const add = (clientId: string, projectId: string, cents: number) => {
    byClient.set(clientId, (byClient.get(clientId) ?? 0) + cents)
    byProject.set(`${clientId}|${projectId}`, (byProject.get(`${clientId}|${projectId}`) ?? 0) + cents)
  }
  for (const e of timeRows) {
    if (!isUninvoiced({ isBillable: e.isBillable, invoiceLineItemId: e.invoiceLineItemId, lockState: e.lockState })) continue
    const cents = e.billableRateCents ? Math.round((e.minutes / 60) * e.billableRateCents) : 0
    add(e.project.clientId, e.project.id, cents)
  }
  for (const x of expenseRows) {
    const pct = x.markupPercent ? Number(x.markupPercent) : 0
    add(x.project.clientId, x.project.id, Math.round(x.totalCents * (1 + pct / 100)))
  }
  const uninvoicedFor = (clientId: string, projectId: string | null) =>
    projectId ? byProject.get(`${clientId}|${projectId}`) ?? 0 : byClient.get(clientId) ?? 0

  const ongoing = retainers.filter((r) => r.status === 'ongoing')
  const archived = retainers.filter((r) => r.status === 'archived')

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Retainers</h1>
      <p className="mb-6 text-sm text-gray-500">Prepaid client balances · live from Supabase</p>

      <NewRetainerForm clients={clients.map((c) => ({ id: c.id, name: c.name, projects: c.projects }))} />

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Ongoing retainers</h2>
      <div className="mb-8 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 text-right font-medium">Uninvoiced</th>
              <th className="px-4 py-3 text-right font-medium">Balance</th>
              <th className="px-4 py-3 font-medium">Manage</th>
            </tr>
          </thead>
          <tbody>
            {ongoing.map((r) => {
              const cur = r.client.currency
              return (
                <tr key={r.id} className="border-b border-gray-100 align-top last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.client.name}</td>
                  <td className="px-4 py-3 text-gray-600">{r.project?.name ?? <span className="text-gray-400">All projects</span>}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatCents(uninvoicedFor(r.clientId, r.projectId), cur)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">
                    {formatCents(r.balanceCents, cur)}
                    <div className="text-xs font-normal text-gray-400">
                      {formatCents(r.depositCents, cur)} in · {formatCents(r.drawnCents, cur)} drawn
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={addDepositAction} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={r.id} />
                        <input name="amount" placeholder="deposit" className={amt} />
                        <button className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">+ Deposit</button>
                      </form>
                      <form action={applyDrawdownAction} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={r.id} />
                        <input name="amount" placeholder="draw" className={amt} />
                        <button className="rounded border border-brand-teal px-2 py-1 text-xs text-brand-teal hover:bg-brand-teal-50">− Apply</button>
                      </form>
                      <form action={archiveRetainerAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-700">Archive</button>
                      </form>
                    </div>
                  </td>
                </tr>
              )
            })}
            {ongoing.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">No ongoing retainers.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {archived.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Archived retainers</h2>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 text-right font-medium">Drawn balance</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {archived.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-gray-900">{r.client.name}</td>
                    <td className="px-4 py-3 text-gray-600">{r.project?.name ?? 'All projects'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatCents(r.drawnCents, r.client.currency)}</td>
                    <td className="px-4 py-3 text-right">
                      <form action={archiveRetainerAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="text-xs text-gray-400 hover:text-brand-teal">Restore</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="mt-4 text-xs text-gray-400">Retainer deposits are excluded from revenue “total paid” (AC-RET-002).</p>
    </div>
  )
}
