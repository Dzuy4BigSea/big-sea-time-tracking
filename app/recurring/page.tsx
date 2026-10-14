import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { formatCents, formatDate } from '@/lib/format'
import { requireUser } from '@/lib/session'
import { getAccountClock } from '@/lib/accountClock'
import { todayYmdIn } from '@/lib/tz'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { requireModule } from '@/lib/modules'
import { cadenceLabel, isCompleted, matchesRecurringSearch, type RecurringFrequency } from '@/modules/invoicing/recurring'
import { RecurringLimitForm } from '@/components/RecurringLimitForm'
import { LiveSearchInput } from '@/components/LiveFilters'
import { ClickableRow } from '@/components/ClickableRow'
import { generateDueAction, toggleRecurringStatusAction, deleteRecurringAction } from '@/app/recurring/actions'
import { ConfirmSubmit } from '@/components/ConfirmSubmit'

export const dynamic = 'force-dynamic'

export default async function RecurringPage({ searchParams }: { searchParams: { q?: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_invoices')) {
    redirect('/')
  }
  await requireModule(accountId, 'invoices')
  const q = (searchParams.q ?? '').trim()

  // Recurring templates are a small per-account set (dozens), so search runs in memory.
  const [all, clock] = await Promise.all([
    prisma.recurringInvoiceProfile.findMany({
      where: { accountId },
      include: { client: { select: { name: true, currency: true } } },
      orderBy: [{ status: 'asc' }, { nextIssueDate: 'asc' }],
    }),
    getAccountClock(accountId),
  ])
  // Harvest searches recurring templates by subject, line-item description and notes (AC-REC-108).
  const profiles = q ? all.filter((p) => matchesRecurringSearch(p, q)) : all

  const today = todayYmdIn(clock.timezone) // the account's calendar day, not the server's UTC day
  const dueCount = all.filter(
    (p) =>
      p.status === 'active' &&
      !isCompleted(p.remainingOccurrences) &&
      p.nextIssueDate &&
      p.nextIssueDate.toISOString().slice(0, 10) <= today,
  ).length

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">Recurring invoices</h1>
        <div className="flex items-center gap-2">
          <form action={generateDueAction}>
            <button className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50" disabled={dueCount === 0}>
              Generate due ({dueCount})
            </button>
          </form>
          <Link href="/recurring/new" className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
            + New recurring invoice
          </Link>
        </div>
      </div>
      <p className="mb-4 text-sm text-gray-500">Templates that generate an invoice on a schedule. Generated invoices are saved as drafts for you to review and send.</p>

      <div className="mb-3">
        <LiveSearchInput param="q" placeholder="Search by subject, line item or notes" clearLabel="Clear" activeClassName="bg-orange-50" className="w-80 rounded border border-gray-300 px-3 py-1.5 text-sm" />
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Invoice subject</th>
              <th className="px-4 py-3 font-medium">Next invoice</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => {
              const completed = isCompleted(p.remainingOccurrences)
              return (
                <ClickableRow key={p.id} href={`/recurring/${p.id}/edit`} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{p.client.name}</td>
                  <td className="px-4 py-3">
                    <Link href={`/recurring/${p.id}/edit`} className="text-gray-700 hover:text-brand-teal">
                      {p.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {completed ? '—' : formatDate(p.nextIssueDate)}
                    <div className="text-xs text-gray-400">{cadenceLabel(p.frequency as RecurringFrequency, p.intervalCount)}</div>
                    <RecurringLimitForm id={p.id} remaining={p.remainingOccurrences} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatCents(p.amountCents, p.client.currency)}</td>
                  <td className="px-4 py-3">
                    {p.status === 'active' ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Active</span>
                    ) : completed ? (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">Completed</span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Paused</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link href={`/recurring/${p.id}/edit`} className="text-xs text-gray-500 hover:text-brand-teal">
                        Edit
                      </Link>
                      {!(p.status === 'paused' && completed) && (
                        <form action={toggleRecurringStatusAction}>
                          <input type="hidden" name="id" value={p.id} />
                          <button className="text-xs text-gray-500 hover:text-brand-teal">{p.status === 'active' ? 'Pause' : 'Resume'}</button>
                        </form>
                      )}
                      <form action={deleteRecurringAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <ConfirmSubmit message="Delete this recurring invoice? Invoices it already generated are kept." className="text-xs text-gray-400 hover:text-red-600">
                          Delete
                        </ConfirmSubmit>
                      </form>
                    </div>
                  </td>
                </ClickableRow>
              )
            })}
            {profiles.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  {q ? `No recurring invoices match “${q}”.` : 'No recurring invoices yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Due invoices are generated automatically early each morning; “Generate due” runs it now. A template with a number of invoices to
        issue counts down and reads Completed after its last one.
      </p>
    </div>
  )
}
