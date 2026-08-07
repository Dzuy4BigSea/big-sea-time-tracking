import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { formatCents, formatDate } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { requireModule } from '@/lib/modules'
import { cadenceLabel, type RecurringFrequency } from '@/modules/invoicing/recurring'
import { NewRecurringForm } from '@/components/NewRecurringForm'
import { generateDueAction, toggleRecurringStatusAction, deleteRecurringAction } from '@/app/recurring/actions'

export const dynamic = 'force-dynamic'

export default async function RecurringPage() {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_invoices')) {
    redirect('/')
  }
  await requireModule(accountId, 'invoices')

  const [profiles, clients] = await Promise.all([
    prisma.recurringInvoiceProfile.findMany({
      where: { accountId },
      include: { client: { select: { name: true, currency: true } } },
      orderBy: [{ status: 'asc' }, { nextIssueDate: 'asc' }],
    }),
    prisma.client.findMany({ where: { accountId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])

  const today = new Date().toISOString().slice(0, 10)
  const dueCount = profiles.filter(
    (p) => p.status === 'active' && p.nextIssueDate && p.nextIssueDate.toISOString().slice(0, 10) <= today,
  ).length

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Recurring invoices</h1>
        <form action={generateDueAction}>
          <button className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50" disabled={dueCount === 0}>
            Generate due ({dueCount})
          </button>
        </form>
      </div>
      <p className="mb-6 text-sm text-gray-500">Scheduled invoice profiles · live from Supabase</p>

      <NewRecurringForm clients={clients} today={today} />

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Subject</th>
              <th className="px-4 py-3 font-medium">Next invoice</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 font-medium text-gray-900">{p.client.name}</td>
                <td className="px-4 py-3 text-gray-700">{p.subject}</td>
                <td className="px-4 py-3 text-gray-600">
                  {formatDate(p.nextIssueDate)}
                  <div className="text-xs text-gray-400">{cadenceLabel(p.frequency as RecurringFrequency, p.intervalCount)}</div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatCents(p.amountCents, p.client.currency)}</td>
                <td className="px-4 py-3">
                  {p.status === 'active' ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Active</span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Paused</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <form action={toggleRecurringStatusAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="text-xs text-gray-500 hover:text-brand-teal">{p.status === 'active' ? 'Pause' : 'Resume'}</button>
                    </form>
                    <form action={deleteRecurringAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="text-xs text-gray-400 hover:text-red-600">Delete</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">No recurring profiles yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Generation is manual here (“Generate due”) as a stand-in for the scheduled job; each run creates one draft per due
        profile and advances its next issue date.
      </p>
    </div>
  )
}
