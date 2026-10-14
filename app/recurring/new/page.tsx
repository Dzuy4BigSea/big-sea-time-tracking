import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { requireModule } from '@/lib/modules'
import { getAccountClock } from '@/lib/accountClock'
import { todayIn } from '@/lib/tz'
import { addDaysUtc } from '@/modules/invoicing/recurring'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { RecurringTemplateForm } from '@/components/RecurringTemplateForm'

export const dynamic = 'force-dynamic'

/** Invoices > Recurring > "+ New recurring invoice" (specs/27). */
export default async function NewRecurringPage({ searchParams }: { searchParams: { client?: string } }) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_invoices')) redirect('/')
  await requireModule(accountId, 'invoices')

  const [clients, clock] = await Promise.all([
    prisma.client.findMany({ where: { accountId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    getAccountClock(accountId),
  ])
  // Harvest: the first issue date can't be today, so default (and floor) to tomorrow (AC-REC-101).
  const tomorrow = addDaysUtc(todayIn(clock.timezone), 1).toISOString().slice(0, 10)

  return (
    <div className="max-w-4xl">
      <Link href="/recurring" className="text-sm text-gray-500 hover:text-brand-teal">
        ← Back to Recurring invoices
      </Link>
      <h1 className="mb-4 mt-2 text-2xl font-semibold">New recurring invoice</h1>
      <RecurringTemplateForm
        mode="new"
        clients={clients}
        minDate={tomorrow}
        initial={{
          clientId: clients.some((c) => c.id === searchParams.client) ? searchParams.client : clients[0]?.id,
          subject: '',
          preset: 'monthly',
          customN: 1,
          customUnit: 'months',
          nextIssueDate: tomorrow,
          occurrences: '',
          paymentTerm: 'net_30',
          notes: '',
          lines: [],
        }}
      />
    </div>
  )
}
