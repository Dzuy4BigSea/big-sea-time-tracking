import Link from 'next/link'
import { PERIODS, buildHref, customSeed, inTimeframe, type Timeframe } from '@/modules/shared/timeframe'
import { ymd } from '@/lib/week'

/**
 * Timeframe picker shared by every report and the project detail page (Week / Semimonth / Month /
 * Quarter / Year / All time / Custom, with ← → stepping and a custom from/to form). Server-rendered:
 * plain links and a GET form, URL-driven. `keep` holds the page's other params (grouping, tab, sort)
 * so changing the timeframe preserves them.
 */
export function ReportTimeframe({
  basePath,
  tf,
  keep = {},
  submitLabel = 'Update report',
}: {
  basePath: string
  tf: Timeframe
  keep?: Record<string, string | null | undefined>
  submitLabel?: string
}) {
  const href = (q: Record<string, string | null | undefined>) => buildHref(basePath, { ...keep, ...q })
  const todayYmd = ymd(new Date())
  const anchorFor = (p: string) => {
    if (p === 'all') return { period: 'all' }
    if (p === 'custom') return { period: 'custom', ...customSeed(tf) }
    // Switching granularity keeps you near what you were looking at.
    return { period: p, anchor: tf.anchor ?? (tf.from ? ymd(tf.from) : todayYmd) }
  }
  const showToday = tf.anchor != null && !inTimeframe(tf, new Date(`${todayYmd}T00:00:00.000Z`))

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap gap-1 text-sm" role="group" aria-label="Timeframe">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={href(anchorFor(p.key))}
            aria-current={tf.period === p.key ? 'true' : undefined}
            className={`rounded px-3 py-1 ${tf.period === p.key ? 'bg-brand-teal-50 font-medium text-brand-teal' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            {p.label}
          </Link>
        ))}
      </div>
      {tf.prevAnchor && tf.nextAnchor && (
        <div className="flex items-center gap-2 text-sm">
          <Link href={href({ period: tf.period, anchor: tf.prevAnchor })} aria-label="Previous period" className="rounded border border-gray-200 bg-white px-2 py-1 text-gray-600 hover:text-brand-teal">←</Link>
          <span className="rounded border border-gray-200 bg-white px-3 py-1">{tf.label}</span>
          <Link href={href({ period: tf.period, anchor: tf.nextAnchor })} aria-label="Next period" className="rounded border border-gray-200 bg-white px-2 py-1 text-gray-600 hover:text-brand-teal">→</Link>
          {showToday && (
            <Link href={href({ period: tf.period, anchor: todayYmd })} className="text-xs text-gray-500 hover:text-brand-teal">
              Return to current
            </Link>
          )}
        </div>
      )}
      {tf.period === 'custom' && (
        <form action={basePath} method="get" className="flex flex-wrap items-center gap-2 text-sm">
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
          <button type="submit" className="rounded border border-gray-300 bg-white px-3 py-1 text-gray-700 hover:bg-gray-50">
            {submitLabel}
          </button>
        </form>
      )}
    </div>
  )
}
