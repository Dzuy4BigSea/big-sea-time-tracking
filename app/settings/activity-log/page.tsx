import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { userCan } from '@/lib/session'
import { requireActivityLogViewer, invoiceIdsForQuery, invoiceNumbers, findEvents } from '@/lib/activityLog'
import { parseFilters, decodeCursor, pageOf, filtersToQuery, buildEventWhere, PAGE_SIZE, PROBLEMS_DAYS, SOURCES } from '@/modules/observability/eventQuery'
import { SOURCE_LABEL } from '@/modules/observability/invoiceTraceSummary'
import { TraceEventList, LEVEL_STYLES } from '@/components/TraceEventList'
import { RunHealthChecks } from '@/components/RunHealthChecks'

export const dynamic = 'force-dynamic'

type SP = Record<string, string | string[] | undefined>

/**
 * Settings → Activity log: every billing-chain trace event for the account (OPS.md "Billing chain:
 * trace, checks, tests"). Default view = Problems (warn + error, last 30 days). Keyset-paginated,
 * 50 per page; level counts are aggregated in the database.
 */
export default async function ActivityLogPage({ searchParams }: { searchParams: SP }) {
  const me = await requireActivityLogViewer()
  if (!me) notFound()
  const { accountId } = me
  const isAdmin = userCan(me, 'edit_account_settings')

  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true } })
  const tz = account?.timezone ?? 'America/New_York'
  const f = parseFilters(searchParams, tz)
  const cursorRaw = typeof searchParams.cursor === 'string' ? searchParams.cursor : null
  const cursor = decodeCursor(cursorRaw)
  const invoiceIds = await invoiceIdsForQuery(accountId, f.invoiceQuery)

  const [raw, levelCounts] = await Promise.all([
    findEvents(accountId, f, invoiceIds, cursor, PAGE_SIZE + 1),
    prisma.invoiceEvent.groupBy({ by: ['level'], where: buildEventWhere(accountId, f, { invoiceIds }), _count: { _all: true } }),
  ])
  const { rows, next } = pageOf(raw)
  const numbers = await invoiceNumbers(accountId, rows.map((r) => r.invoiceId))
  const counts = Object.fromEntries(levelCounts.map((c) => [c.level, c._count._all])) as Record<string, number>
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  const base = '/settings/activity-log'
  const qs = filtersToQuery(f)
  const input = 'rounded border border-gray-300 px-2 py-1.5 text-sm'
  const label = 'mb-1 block text-xs uppercase tracking-wide text-gray-400'
  const tab = (active: boolean) =>
    `rounded-full px-3 py-1 text-sm ${active ? 'bg-orange-50 font-medium text-brand-orange' : 'text-gray-600 hover:bg-gray-100'}`

  return (
    <div>
      <Link href="/settings" className="text-sm text-gray-500 hover:text-brand-teal">← Settings</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold">Activity log</h1>
      <p className="mb-5 text-sm text-gray-500">
        Every traced step of the billing chain: invoice sent, email delivered or bounced, client opened, Stripe payment, Xero sync, and the daily health checks.
      </p>

      {isAdmin && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Integration health</h2>
          <RunHealthChecks />
        </section>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={`${base}?view=problems`} className={tab(f.view === 'problems')}>Problems (last {PROBLEMS_DAYS} days)</Link>
        <Link href={`${base}?view=all`} className={tab(f.view === 'all')}>All events</Link>
      </div>

      <form method="get" action={base} className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <input type="hidden" name="view" value={f.view} />
        {f.view === 'all' && (
          <div>
            <label className={label} htmlFor="al-level">Level</label>
            <select id="al-level" name="level" defaultValue={f.levels.join(',')} className={input}>
              <option value="">All levels</option>
              <option value="error">Error</option>
              <option value="warn">Warning</option>
              <option value="warn,error">Warning + error</option>
              <option value="info">Info</option>
            </select>
          </div>
        )}
        <div>
          <label className={label} htmlFor="al-source">Source</label>
          <select id="al-source" name="source" defaultValue={f.source ?? ''} className={input}>
            <option value="">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{SOURCE_LABEL[s] ?? s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="al-stage">Stage starts with</label>
          <input id="al-stage" name="stage" defaultValue={f.stagePrefix ?? ''} placeholder="email. / payment. / xero." className={`${input} w-44`} />
        </div>
        <div>
          <label className={label} htmlFor="al-from">From</label>
          <input id="al-from" type="date" name="from" defaultValue={f.fromYmd ?? ''} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="al-to">To</label>
          <input id="al-to" type="date" name="to" defaultValue={f.toYmd ?? ''} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="al-q">Invoice #</label>
          <input id="al-q" name="q" defaultValue={f.invoiceQuery ?? ''} placeholder="7801" className={`${input} w-28`} />
        </div>
        <button type="submit" className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">Filter</button>
        <Link href={base} className="py-1.5 text-sm text-gray-500 hover:underline">Reset</Link>
        <a href={`${base}/export?${qs}`} className="ml-auto rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Export CSV</a>
      </form>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500" data-testid="level-counts">
        <span>{total.toLocaleString('en-US')} matching event{total === 1 ? '' : 's'}</span>
        {(['error', 'warn', 'info'] as const).map((l) =>
          counts[l] ? (
            <span key={l} className={`rounded-full px-2 py-0.5 font-medium ${LEVEL_STYLES[l]}`}>
              {counts[l].toLocaleString('en-US')} {l}
            </span>
          ) : null,
        )}
        <span className="ml-auto">Times in {tz}</span>
      </div>

      <TraceEventList
        rows={rows.map((r) => ({ ...r, invoiceNumber: r.invoiceId ? numbers.get(r.invoiceId) ?? null : null }))}
        timezone={tz}
        showInvoice
      />

      <div className="mt-3 flex items-center gap-4 text-sm">
        {cursor && <Link href={`${base}?${qs}`} className="text-brand-teal hover:underline">← Newest</Link>}
        {next && <Link href={`${base}?${filtersToQuery(f, { cursor: next })}`} className="text-brand-teal hover:underline">Older →</Link>}
      </div>
    </div>
  )
}
