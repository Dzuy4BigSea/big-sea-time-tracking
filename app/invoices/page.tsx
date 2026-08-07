import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { displayBadge, type StoredStatus } from '@/modules/invoicing/invoiceState'
import { formatCents, formatDate } from '@/lib/format'
import { BADGE_STYLES, BADGE_LABEL } from '@/lib/labels'
import { generateInvoiceAction } from '@/app/invoices/actions'
import { createBlankInvoiceAction } from '@/app/invoices/[id]/edit/actions'
import { ClickableRow } from '@/components/ClickableRow'
import { requireUser } from '@/lib/session'
import { requireModule } from '@/lib/modules'

export const dynamic = 'force-dynamic'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const dayDiff = (due: Date, today: Date) =>
  Math.round(
    (Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()) -
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) /
      86_400_000,
  )

function dueLabel(status: string, dueDate: Date | null, today: Date): { text: string; overdue: boolean } {
  if (status === 'draft') return { text: 'Not sent yet', overdue: false }
  if (status === 'paid') return { text: 'Paid', overdue: false }
  if (status === 'written_off') return { text: 'Written off', overdue: false }
  if (status === 'closed') return { text: 'Closed', overdue: false }
  if (!dueDate) return { text: '—', overdue: false }
  const d = dayDiff(dueDate, today)
  if (d === 0) return { text: 'Due today', overdue: false }
  if (d > 0) return { text: `Due in ${d} day${d === 1 ? '' : 's'}`, overdue: false }
  const n = Math.abs(d)
  return { text: `Overdue by ${n} day${n === 1 ? '' : 's'}`, overdue: true }
}

const TABS = [
  { key: 'overview', label: 'Overview', href: '/invoices' },
  { key: 'recurring', label: 'Recurring', href: '/recurring' },
  { key: 'retainers', label: 'Retainers', href: '/retainers' },
  { key: 'uninvoiced', label: 'Uninvoiced', href: '/reports' },
  { key: 'configure', label: 'Configure', href: '/settings' },
]

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: { nothing?: string; year?: string; view?: string; q?: string }
}) {
  const { accountId } = await requireUser()
  await requireModule(accountId, 'invoices')
  const [invoices, clients] = await Promise.all([
    prisma.invoice.findMany({
      where: { accountId },
      include: { client: true },
      orderBy: [{ issueDate: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
    }),
    prisma.client.findMany({ where: { accountId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])

  const today = new Date()
  const thisYear = today.getUTCFullYear()
  const year = Number(searchParams.year) || thisYear
  const view = searchParams.view === 'all' ? 'all' : 'open'
  const q = (searchParams.q ?? '').trim().toLowerCase()

  // Monthly stacked chart (Open vs Paid) for issued invoices in the selected year.
  const months = MONTHS.map(() => ({ paid: 0, open: 0 }))
  for (const i of invoices) {
    if (!i.issueDate || i.issueDate.getUTCFullYear() !== year) continue
    const m = i.issueDate.getUTCMonth()
    months[m].paid += i.paidCents
    months[m].open += Math.max(0, i.totalCents - i.paidCents)
  }
  const maxMonth = Math.max(1, ...months.map((m) => m.paid + m.open))
  const totalOpen = invoices.filter((i) => i.status === 'open').reduce((s, i) => s + (i.totalCents - i.paidCents), 0)
  const paidThisYear = invoices
    .filter((i) => i.issueDate?.getUTCFullYear() === year)
    .reduce((s, i) => s + i.paidCents, 0)

  const openCount = invoices.filter((i) => i.status === 'open').length
  const rows = invoices
    .filter((i) => (view === 'open' ? i.status === 'open' : true))
    .filter((i) => (q ? i.client.name.toLowerCase().includes(q) || (i.number ?? '').toLowerCase().includes(q) : true))

  const qp = (over: Record<string, string>) => {
    const p = new URLSearchParams({ year: String(year), view, ...(q ? { q } : {}), ...over })
    return `/invoices?${p.toString()}`
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <form action={generateInvoiceAction} className="flex items-center gap-2">
          <select name="clientId" className="rounded border border-gray-300 px-2 py-1.5 text-sm" title="Generate from a client's tracked time">
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Generate</button>
          <button formAction={createBlankInvoiceAction} className="rounded border border-brand-green px-3 py-1.5 text-sm font-medium text-brand-green hover:bg-green-50">+ New invoice</button>
        </form>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex gap-6 border-b border-gray-200 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`-mb-px border-b-2 pb-2 ${t.key === 'overview' ? 'border-brand-teal font-medium text-brand-teal' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {searchParams.nothing && <p className="mb-4 text-sm text-gray-500">No uninvoiced time or expenses for that client.</p>}

      {/* Reporting header: stat cards + issued-per-year chart */}
      <div className="mb-6 grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-gray-400">Total open</div>
            <div className="mt-1 text-2xl font-semibold">{formatCents(totalOpen)}</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-gray-400">Total paid amount</div>
            <div className="mt-1 text-2xl font-semibold">{formatCents(paidThisYear)}</div>
            <div className="mt-0.5 text-xs text-gray-400">For invoices issued in {year}, excluding retainer deposits.</div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-3">
            <Link href={qp({ year: String(year - 1) })} className="rounded border border-gray-300 px-2 text-sm text-gray-600 hover:bg-gray-50">←</Link>
            <Link href={qp({ year: String(year + 1) })} className="rounded border border-gray-300 px-2 text-sm text-gray-600 hover:bg-gray-50">→</Link>
            <h2 className="text-base font-semibold">Invoices issued in {year}</h2>
            <div className="ml-auto flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#a7e3be' }} />Open</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-green" />Paid</span>
            </div>
          </div>
          <div className="flex h-40 items-end gap-1.5">
            {months.map((m, i) => {
              const paidH = Math.round((m.paid / maxMonth) * 100)
              const openH = Math.round((m.open / maxMonth) * 100)
              return (
                <div key={i} className="flex flex-1 flex-col items-center gap-1" title={`${MONTHS[i]}: ${formatCents(m.paid)} paid, ${formatCents(m.open)} open`}>
                  <div className="flex w-full flex-1 flex-col justify-end">
                    <div className="w-full rounded-t-sm" style={{ height: `${openH}%`, background: '#a7e3be' }} />
                    <div className="w-full" style={{ height: `${paidH}%`, background: '#047a44' }} />
                  </div>
                  <span className="text-[10px] text-gray-400">{MONTHS[i]}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Sub-tabs + search */}
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <div className="flex gap-4 text-sm">
          <Link href={qp({ view: 'open' })} className={view === 'open' ? 'font-medium text-brand-teal' : 'text-gray-500 hover:text-gray-800'}>
            Open <span className="text-gray-400">({openCount})</span>
          </Link>
          <Link href={qp({ view: 'all' })} className={view === 'all' ? 'font-medium text-brand-teal' : 'text-gray-500 hover:text-gray-800'}>
            All invoices
          </Link>
        </div>
        <form className="ml-auto">
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="view" value={view} />
          <input name="q" defaultValue={searchParams.q ?? ''} placeholder="Search invoices…" className="w-56 rounded border border-gray-300 px-3 py-1.5 text-sm" />
        </form>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Due</th>
              <th className="px-4 py-3 font-medium">Issue date</th>
              <th className="px-4 py-3 font-medium">Number</th>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv) => {
              const badge = displayBadge(
                { status: inv.status as StoredStatus, sentAt: inv.sentAt, dueDate: inv.dueDate, totalCents: inv.totalCents, paidCents: inv.paidCents },
                today,
              )
              const balance = inv.totalCents - inv.paidCents
              const due = dueLabel(inv.status, inv.dueDate, today)
              return (
                <ClickableRow key={inv.id} href={`/invoices/${inv.id}`} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_STYLES[badge]}`}>{BADGE_LABEL[badge]}</span>
                  </td>
                  <td className={`px-4 py-3 text-sm ${due.overdue ? 'font-medium text-red-600' : 'text-gray-500'}`}>{due.text}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(inv.issueDate)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${inv.id}`} className="text-gray-700 hover:text-brand-teal">
                      {inv.number ?? <span className="text-gray-400">Draft</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${inv.id}`} className="font-medium text-gray-900 hover:text-brand-teal">{inv.client.name}</Link>
                    {inv.subject && <div className="text-xs text-gray-500">{inv.subject}</div>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{formatCents(balance, inv.currency)}</td>
                </ClickableRow>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  {view === 'open' ? 'No open invoices.' : 'No invoices match.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
