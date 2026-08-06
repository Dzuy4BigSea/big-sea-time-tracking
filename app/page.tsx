import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatCents } from '@/lib/format'
import { startOfWeekMonday, addDays } from '@/lib/week'
import { requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

const utcMidnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
const startOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
const hrs = (minutes: number) => (minutes / 60).toLocaleString(undefined, { maximumFractionDigits: 2 })

async function sumHours(accountId: string, gte: Date, lte: Date): Promise<number> {
  const r = await prisma.timeEntry.aggregate({
    where: { accountId, spentDate: { gte, lte } },
    _sum: { minutes: true },
  })
  return r._sum.minutes ?? 0
}

export default async function HomePage() {
  const { accountId } = await requireUser()
  const now = new Date()
  const today = utcMidnight(now)
  const yesterday = addDays(today, -1)
  const weekStart = startOfWeekMonday(now)
  const lastWeekStart = addDays(weekStart, -7)
  const lastWeekEnd = addDays(weekStart, -1)
  const monthStart = startOfMonth(now)
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const lastMonthEnd = addDays(monthStart, -1)
  const farFuture = new Date(Date.UTC(9999, 0, 1))

  const [minToday, minYesterday, minWeek, minLastWeek, minMonth, minLastMonth, invoices, recurring, retainers, projects] =
    await Promise.all([
      sumHours(accountId, today, today),
      sumHours(accountId, yesterday, yesterday),
      sumHours(accountId, weekStart, farFuture),
      sumHours(accountId, lastWeekStart, lastWeekEnd),
      sumHours(accountId, monthStart, farFuture),
      sumHours(accountId, lastMonthStart, lastMonthEnd),
    prisma.invoice.findMany({
      where: { accountId },
      select: { status: true, totalCents: true, paidCents: true, issueDate: true },
    }),
    prisma.recurringInvoiceProfile.findMany({
      where: { accountId, status: 'active' },
      select: { nextIssueDate: true },
    }),
    prisma.retainer.findMany({ where: { accountId, status: 'ongoing' }, select: { balanceCents: true } }),
    prisma.project.findMany({
      where: { accountId },
      select: {
        id: true,
        name: true,
        code: true,
        client: { select: { name: true } },
        budgetMethod: true,
        budgetValue: true,
        timeEntries: { select: { minutes: true, spentDate: true } },
      },
    }),
  ])

  const outstanding = invoices.filter((i) => i.status === 'open').reduce((s, i) => s + (i.totalCents - i.paidCents), 0)
  const totalPaid = invoices.reduce((s, i) => s + i.paidCents, 0)
  const invoicedThisMonth = invoices
    .filter((i) => i.issueDate && i.issueDate >= monthStart)
    .reduce((s, i) => s + i.totalCents, 0)

  const recurringDue = recurring.filter((r) => r.nextIssueDate && utcMidnight(r.nextIssueDate) <= today).length
  const retainerBalance = retainers.reduce((s, r) => s + r.balanceCents, 0)

  const activeProjects = projects
    .map((p) => {
      const spent = p.timeEntries.reduce((s, e) => s + e.minutes, 0)
      const last = p.timeEntries.reduce<Date | null>((m, e) => (!m || e.spentDate > m ? e.spentDate : m), null)
      return { ...p, spent, last }
    })
    .filter((p) => p.spent > 0)
    .sort((a, b) => (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0))
    .slice(0, 5)

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Dashboard</h1>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card title="Time summary">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Stat label="Hours today" value={`${hrs(minToday)}`} />
            <Stat label="Hours yesterday" value={`${hrs(minYesterday)}`} />
            <Stat label="Hours this week" value={`${hrs(minWeek)}`} />
            <Stat label="Hours last week" value={`${hrs(minLastWeek)}`} />
            <Stat label="Hours this month" value={`${hrs(minMonth)}`} />
            <Stat label="Hours last month" value={`${hrs(minLastMonth)}`} />
          </dl>
          <Link href="/timesheet" className="mt-3 inline-block text-sm text-blue-600 hover:underline">
            Go to timesheet →
          </Link>
        </Card>

        <Card title="Invoice summary">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Stat label="Amount outstanding" value={formatCents(outstanding)} accent="text-red-600" />
            <Stat label="Invoiced this month" value={formatCents(invoicedThisMonth)} />
            <Stat label="Total paid" value={formatCents(totalPaid)} />
          </dl>
          <Link href="/invoices" className="mt-3 inline-block text-sm text-blue-600 hover:underline">
            Go to invoices →
          </Link>
        </Card>

        <Card title="Recurring & retainers">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Stat label="Active recurring" value={String(recurring.length)} />
            <Stat label="Due to generate" value={String(recurringDue)} accent={recurringDue > 0 ? 'text-brand-teal' : undefined} />
            <Stat label="Ongoing retainers" value={String(retainers.length)} />
            <Stat label="Retainer balance" value={formatCents(retainerBalance)} accent="text-brand-green" />
          </dl>
          <div className="mt-3 flex gap-4 text-sm">
            <Link href="/recurring" className="text-blue-600 hover:underline">Recurring →</Link>
            <Link href="/retainers" className="text-blue-600 hover:underline">Retainers →</Link>
          </div>
        </Card>
      </div>

      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Recently active projects</h2>
        <Link href="/projects" className="text-sm text-blue-600 hover:underline">
          View projects report →
        </Link>
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 text-right font-medium">Budget</th>
              <th className="px-4 py-3 text-right font-medium">Spent</th>
              <th className="px-4 py-3 font-medium">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {activeProjects.map((p) => {
              const hoursBudget = p.budgetMethod.startsWith('hours') && p.budgetValue ? p.budgetValue : null
              const remaining = hoursBudget != null ? hoursBudget - p.spent : null
              const pct = hoursBudget ? Math.min(100, Math.round((p.spent / hoursBudget) * 100)) : null
              const over = remaining != null && remaining < 0
              return (
                <tr key={p.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="text-xs text-gray-400">{p.client.name}</div>
                    <Link href={`/projects/${p.id}`} className="font-medium text-gray-900 hover:text-brand-teal">
                      {p.code ? `[${p.code}] ` : ''}
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-500">{hoursBudget ? `${hrs(hoursBudget)}h` : '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{hrs(p.spent)}h</td>
                  <td className="px-4 py-3">
                    {hoursBudget != null ? (
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className={`h-full ${over ? 'bg-red-500' : 'bg-blue-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className={`w-24 text-right tabular-nums ${over ? 'text-red-600' : 'text-gray-600'}`}>
                          {hrs(remaining!)}h ({pct}%)
                        </span>
                      </div>
                    ) : (
                      <div className="text-right text-gray-400">—</div>
                    )}
                  </td>
                </tr>
              )
            })}
            {activeProjects.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  No tracked time yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-4 font-semibold text-gray-800">{title}</h2>
      {children}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className={`text-lg font-semibold ${accent ?? 'text-gray-900'}`}>{value}</dd>
    </div>
  )
}
