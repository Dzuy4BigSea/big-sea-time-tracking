import Link from 'next/link'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { displayBadge, type StoredStatus } from '@/modules/invoicing/invoiceState'
import { formatCents, formatDate } from '@/lib/format'
import { BADGE_STYLES, BADGE_LABEL } from '@/lib/labels'
import { generateInvoiceAction } from '@/app/invoices/actions'
import { createBlankInvoiceAction } from '@/app/invoices/[id]/edit/actions'
import { ClickableRow } from '@/components/ClickableRow'
import { ColumnChart } from '@/components/ColumnChart'
import { requireUser } from '@/lib/session'
import { requireModule } from '@/lib/modules'

export const dynamic = 'force-dynamic'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const PAGE_SIZE = 50

const dayDiff = (due: Date, today: Date) =>
  Math.round((Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86_400_000)

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
  { key: 'configure', label: 'Configure', href: '/invoices/configure' },
]
const PERIODS: Record<string, string> = { all: 'All time', ytd: 'This year', q: 'This quarter', d30: 'Last 30 days', d90: 'Last 90 days' }
const SORTS: Record<string, string> = { issueDate: 'Issue date', number: 'Number', dueDate: 'Due', client: 'Client' }

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: { nothing?: string; year?: string; view?: string; q?: string; client?: string; period?: string; sort?: string; dir?: string; page?: string }
}) {
  const { accountId } = await requireUser()
  await requireModule(accountId, 'invoices')

  const today = new Date()
  const thisYear = today.getUTCFullYear()
  const view = searchParams.view === 'all' ? 'all' : 'open'
  const q = (searchParams.q ?? '').trim()
  const clientId = searchParams.client || ''
  const period = PERIODS[searchParams.period ?? ''] ? searchParams.period! : 'all'
  const sort = SORTS[searchParams.sort ?? ''] ? searchParams.sort! : 'issueDate'
  const dir = searchParams.dir === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Number(searchParams.page) || 1)

  // Chart defaults to the latest year that actually has invoices, so it's populated on load.
  const latest = await prisma.invoice.aggregate({ where: { accountId, issueDate: { not: null } }, _max: { issueDate: true } })
  const dataYear = latest._max.issueDate?.getUTCFullYear() ?? thisYear
  const year = Number(searchParams.year) || dataYear
  const yStart = new Date(Date.UTC(year, 0, 1))
  const yEnd = new Date(Date.UTC(year + 1, 0, 1))

  // Period → issueDate lower bound for the list.
  let periodStart: Date | null = null
  if (period === 'ytd') periodStart = new Date(Date.UTC(thisYear, 0, 1))
  else if (period === 'q') periodStart = new Date(Date.UTC(thisYear, Math.floor(today.getUTCMonth() / 3) * 3, 1))
  else if (period === 'd30') periodStart = new Date(today.getTime() - 30 * 86_400_000)
  else if (period === 'd90') periodStart = new Date(today.getTime() - 90 * 86_400_000)

  const listWhere: Prisma.InvoiceWhereInput = {
    accountId,
    ...(view === 'open' ? { status: 'open' } : {}),
    ...(clientId ? { clientId } : {}),
    ...(periodStart ? { issueDate: { gte: periodStart } } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: 'insensitive' } }, { subject: { contains: q, mode: 'insensitive' } }, { client: { name: { contains: q, mode: 'insensitive' } } }] } : {}),
  }
  const orderBy: Prisma.InvoiceOrderByWithRelationInput =
    sort === 'number' ? { number: dir } : sort === 'dueDate' ? { dueDate: dir } : sort === 'client' ? { client: { name: dir } } : { issueDate: { sort: dir, nulls: 'last' } }

  const [chart, openAgg, paidYearAgg, openCount, totalMatched, rows, clients] = await Promise.all([
    prisma.$queryRaw<{ m: number; paid: bigint; open: bigint }[]>`
      SELECT EXTRACT(MONTH FROM "issueDate")::int AS m, COALESCE(SUM("paidCents"),0)::bigint AS paid,
        COALESCE(SUM(GREATEST("totalCents" - "paidCents", 0)),0)::bigint AS open
      FROM "Invoice" WHERE "accountId" = ${accountId} AND "issueDate" >= ${yStart} AND "issueDate" < ${yEnd} GROUP BY 1`,
    prisma.$queryRaw<{ c: bigint }[]>`SELECT COALESCE(SUM("totalCents" - "paidCents"),0)::bigint AS c FROM "Invoice" WHERE "accountId" = ${accountId} AND status::text = 'open'`,
    prisma.$queryRaw<{ c: bigint }[]>`SELECT COALESCE(SUM("paidCents"),0)::bigint AS c FROM "Invoice" WHERE "accountId" = ${accountId} AND "issueDate" >= ${yStart} AND "issueDate" < ${yEnd}`,
    prisma.invoice.count({ where: { accountId, status: 'open', ...(clientId ? { clientId } : {}) } }),
    prisma.invoice.count({ where: listWhere }),
    prisma.invoice.findMany({ where: listWhere, include: { client: { select: { name: true } } }, orderBy, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }),
    prisma.client.findMany({ where: { accountId, invoices: { some: {} } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])

  const months = MONTHS.map((_, i) => {
    const r = chart.find((x) => x.m === i + 1)
    return { paid: Number(r?.paid ?? 0), open: Number(r?.open ?? 0) }
  })
  const totalOpen = Number(openAgg[0]?.c ?? 0)
  const paidThisYear = Number(paidYearAgg[0]?.c ?? 0)
  const totalPages = Math.max(1, Math.ceil(totalMatched / PAGE_SIZE))

  const clientsForGenerate = clients
  const qp = (over: Record<string, string>) => {
    const base: Record<string, string> = { year: String(year), view }
    if (q) base.q = q
    if (clientId) base.client = clientId
    if (period !== 'all') base.period = period
    if (sort !== 'issueDate') base.sort = sort
    if (dir !== 'desc') base.dir = dir
    if (page > 1) base.page = String(page)
    return `/invoices?${new URLSearchParams({ ...base, ...over }).toString()}`
  }
  const sortHref = (col: string) => qp({ sort: col, dir: sort === col && dir === 'asc' ? 'desc' : 'asc', page: '1' })
  const sortArrow = (col: string) => (sort === col ? (dir === 'asc' ? ' ↑' : ' ↓') : '')

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <form action={generateInvoiceAction} className="flex items-center gap-2">
          <select name="clientId" className="rounded border border-gray-300 px-2 py-1.5 text-sm" title="Generate from a client's tracked time">
            {clientsForGenerate.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="rounded bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Generate</button>
          <button formAction={createBlankInvoiceAction} className="rounded border border-brand-green px-3 py-1.5 text-sm font-medium text-brand-green hover:bg-green-50">+ New invoice</button>
        </form>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex gap-6 border-b border-gray-200 text-sm">
        {TABS.map((t) => (
          <Link key={t.key} href={t.href} className={`-mb-px border-b-2 pb-2 ${t.key === 'overview' ? 'border-brand-teal font-medium text-brand-teal' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{t.label}</Link>
        ))}
      </div>

      {searchParams.nothing && <p className="mb-4 text-sm text-gray-500">No uninvoiced time or expenses for that client.</p>}

      {/* Reporting header */}
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
          <ColumnChart
            format={(v) => (v >= 1000_00 ? `$${Math.round(v / 100 / 1000)}k` : formatCents(v))}
            bars={months.map((m, i) => ({
              label: MONTHS[i],
              title: `${MONTHS[i]}: ${formatCents(m.paid)} paid, ${formatCents(m.open)} open`,
              highlight: year === thisYear && i === today.getUTCMonth(),
              // top segment first (open, lighter) then paid (darker) at the base
              segments: [
                { value: m.open, color: '#a7e3be' },
                { value: m.paid, color: '#047a44' },
              ],
            }))}
          />
        </div>
      </div>

      {/* Sub-tabs + filters */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-4 text-sm">
          <Link href={qp({ view: 'open', page: '1' })} className={view === 'open' ? 'font-medium text-brand-teal' : 'text-gray-500 hover:text-gray-800'}>Open <span className="text-gray-400">({openCount})</span></Link>
          <Link href={qp({ view: 'all', page: '1' })} className={view === 'all' ? 'font-medium text-brand-teal' : 'text-gray-500 hover:text-gray-800'}>All invoices</Link>
        </div>
        <form className="ml-auto flex flex-wrap items-center gap-2">
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="view" value={view} />
          <select name="client" defaultValue={clientId} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="period" defaultValue={period} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
            {Object.entries(PERIODS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input name="q" defaultValue={q} placeholder="Search invoices…" className="w-48 rounded border border-gray-300 px-3 py-1.5 text-sm" />
          <button className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Apply</button>
          {(clientId || period !== 'all' || q) && <Link href={qp({ client: '', period: 'all', q: '' })} className="text-sm text-gray-400 hover:text-gray-600">Clear</Link>}
        </form>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium"><Link href={sortHref('dueDate')} className="hover:text-gray-700">Due{sortArrow('dueDate')}</Link></th>
              <th className="px-4 py-3 font-medium"><Link href={sortHref('issueDate')} className="hover:text-gray-700">Issue date{sortArrow('issueDate')}</Link></th>
              <th className="px-4 py-3 font-medium"><Link href={sortHref('number')} className="hover:text-gray-700">Number{sortArrow('number')}</Link></th>
              <th className="px-4 py-3 font-medium"><Link href={sortHref('client')} className="hover:text-gray-700">Client{sortArrow('client')}</Link></th>
              <th className="px-4 py-3 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv) => {
              const badge = displayBadge({ status: inv.status as StoredStatus, sentAt: inv.sentAt, dueDate: inv.dueDate, totalCents: inv.totalCents, paidCents: inv.paidCents }, today)
              const balance = inv.totalCents - inv.paidCents
              const due = dueLabel(inv.status, inv.dueDate, today)
              return (
                <ClickableRow key={inv.id} href={`/invoices/${inv.id}`} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3"><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_STYLES[badge]}`}>{BADGE_LABEL[badge]}</span></td>
                  <td className={`px-4 py-3 text-sm ${due.overdue ? 'font-medium text-red-600' : 'text-gray-500'}`}>{due.text}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(inv.issueDate)}</td>
                  <td className="px-4 py-3"><Link href={`/invoices/${inv.id}`} className="text-gray-700 hover:text-brand-teal">{inv.number ?? <span className="text-gray-400">Draft</span>}</Link></td>
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${inv.id}`} className="font-medium text-gray-900 hover:text-brand-teal">{inv.client.name}</Link>
                    {inv.subject && <div className="text-xs text-gray-500">{inv.subject}</div>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{formatCents(balance, inv.currency)}</td>
                </ClickableRow>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">{view === 'open' ? 'No open invoices match.' : 'No invoices match.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
        <span>{totalMatched.toLocaleString()} invoice{totalMatched === 1 ? '' : 's'}{totalPages > 1 ? ` · page ${page} of ${totalPages}` : ''}</span>
        {totalPages > 1 && (
          <div className="flex gap-2">
            {page > 1 && <Link href={qp({ page: String(page - 1) })} className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50">← Prev</Link>}
            {page < totalPages && <Link href={qp({ page: String(page + 1) })} className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50">Next →</Link>}
          </div>
        )}
      </div>
    </div>
  )
}
