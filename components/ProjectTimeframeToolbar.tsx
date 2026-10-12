import Link from 'next/link'
import { DropdownMenu } from '@/components/DropdownMenu'
import { PERIODS, buildHref, customSeed, inTimeframe, periodHeading, type Timeframe } from '@/modules/shared/timeframe'
import { ymd } from '@/lib/week'

/**
 * Table toolbar on the project analysis page (Harvest): the heading is "All time", or
 * "[←][→] This Month: October 2026" for an anchored period (arrows step the period); the timeframe
 * dropdown sits on the right next to any tab-specific `actions`. URL-driven like ReportTimeframe:
 * `keep` holds the page's other params (tab, sort) so a timeframe change keeps them — and every tab
 * link carries the timeframe, so it persists across Tasks / Team / Invoices.
 */
export function ProjectTimeframeToolbar({
  basePath,
  tf,
  keep = {},
  actions,
  now = new Date(),
}: {
  basePath: string
  tf: Timeframe
  keep?: Record<string, string | null | undefined>
  actions?: React.ReactNode
  now?: Date
}) {
  const href = (q: Record<string, string | null | undefined>) => buildHref(basePath, { ...keep, ...q })
  const todayYmd = ymd(now)
  const anchorFor = (p: string) => {
    if (p === 'all') return { period: 'all' }
    if (p === 'custom') return { period: 'custom', ...customSeed(tf, now) }
    // Switching granularity keeps you near what you were looking at.
    return { period: p, anchor: tf.anchor ?? (tf.from ? ymd(tf.from) : todayYmd) }
  }
  const current = PERIODS.find((p) => p.key === tf.period)?.label ?? 'All time'
  const showToday = tf.anchor != null && !inTimeframe(tf, new Date(`${todayYmd}T00:00:00.000Z`))
  const arrow = 'rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-600 hover:text-brand-teal'

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-3">
        {tf.prevAnchor && tf.nextAnchor && (
          <div className="flex items-center gap-1 text-sm">
            <Link href={href({ period: tf.period, anchor: tf.prevAnchor })} scroll={false} aria-label="Previous period" className={arrow}>←</Link>
            <Link href={href({ period: tf.period, anchor: tf.nextAnchor })} scroll={false} aria-label="Next period" className={arrow}>→</Link>
          </div>
        )}
        <h2 className="text-lg font-semibold text-gray-900">{periodHeading(tf, now)}</h2>
        {showToday && (
          <Link href={href({ period: tf.period, anchor: todayYmd })} scroll={false} className="text-xs text-gray-500 hover:text-brand-teal">
            Return to current
          </Link>
        )}
        <div className="ml-auto flex items-center gap-3">
          <DropdownMenu
            label={<span>{current} ▾</span>}
            summaryClassName="cursor-pointer list-none rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
          >
            {PERIODS.map((p) => (
              <Link
                key={p.key}
                href={href(anchorFor(p.key))}
                scroll={false}
                aria-current={tf.period === p.key ? 'true' : undefined}
                className={`block px-3 py-1.5 text-sm hover:bg-gray-50 ${tf.period === p.key ? 'font-medium text-brand-teal' : 'text-gray-700'}`}
              >
                {p.label}
              </Link>
            ))}
          </DropdownMenu>
          {actions}
        </div>
      </div>
      {tf.period === 'custom' && (
        <form action={basePath} method="get" className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          <input type="hidden" name="period" value="custom" />
          <label className="flex items-center gap-1 text-gray-500">
            From
            <input type="date" name="from" defaultValue={tf.from ? ymd(tf.from) : ''} className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-800" />
          </label>
          <label className="flex items-center gap-1 text-gray-500">
            to
            <input type="date" name="to" defaultValue={tf.till ? ymd(tf.till) : ''} className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-800" />
          </label>
          <button type="submit" className="rounded border border-gray-300 bg-white px-3 py-1 text-gray-700 hover:bg-gray-50">Apply</button>
        </form>
      )}
    </div>
  )
}
