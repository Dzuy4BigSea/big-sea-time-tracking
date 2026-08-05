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
  const weekStart = startOfWeekMonday(now)
  const monthStart = startOfMonth(now)
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const lastMonthEnd = addDays(monthStart, -1)
  const farFuture = new Date(Date.UTC(9999, 0, 1))

  const [minToday, minWeek, minMonth, minLastMonth, invoices, projects] = await Promise.all([
    sumHours(accountId, today, today),
    sumHours(accountId, weekStart, farFuture),
    sumHours(accountId, monthStart, farFuture),
    sumHours(accountId, lastMonthStart, lastMonthEnd),
    prisma.invoice.findMany({
      where: { accountId },
      select: { status: true, totalCents: true, paidCents: true, issueDate: true },
    }),
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
            <Stat label="Hours this week" value={`${hrs(minWeek)}`} />
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
      </div>

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Recently active projects</h2>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 text-right font-medium">Spent</th>
              <th className="px-4 py-3 text-right font-medium">Budget</th>
            </tr>
          </thead>
          <tbody>
            {activeProjects.map((p) => (
              <tr key={p.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3">
                  <div className="text-xs text-gray-400">{p.client.name}</div>
                  <div className="font-medium text-gray-900">
                    {p.code ? `[${p.code}] ` : ''}
                    {p.name}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{hrs(p.spent)}h</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                  {p.budgetMethod.startsWith('hours') && p.budgetValue ? `${hrs(p.budgetValue)}h` : '—'}
                </td>
              </tr>
            ))}
            {activeProjects.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
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
