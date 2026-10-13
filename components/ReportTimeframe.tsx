import Link from 'next/link'
import { DropdownMenu } from '@/components/DropdownMenu'
import { PeriodJumpButton } from '@/components/PeriodJumpButton'
import { PERIODS, buildHref, customSeed, inTimeframe, stepperLabel, type Timeframe } from '@/modules/shared/timeframe'
import { ymd } from '@/lib/week'

/**
 * Timeframe control shared by the report screens, laid out like Harvest's: a period dropdown
 * ("Week ⌄": Week / Semimonth / Month / Quarter / Year / All time / Custom) next to a
 * [← | 📅 This week 12 – 18 Oct 2026 | →] stepper (the middle opens a date picker), or a from/to
 * form for Custom. URL-driven: `keep` holds the page's other params (grouping, tab, sort) so
 * changing the timeframe preserves them.
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
  const current = PERIODS.find((p) => p.key === tf.period)!
  const showToday = tf.anchor != null && !inTimeframe(tf, new Date(`${todayYmd}T00:00:00.000Z`))
  const { prefix, range } = stepperLabel(tf)
  const arrow = 'flex items-center px-2.5 text-gray-600 hover:bg-gray-50 hover:text-brand-teal'

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
      <DropdownMenu
        label={
          <span className="flex items-center gap-2 font-medium">
            {current.label}
            <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        }
        summaryClassName="cursor-pointer list-none rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-800 shadow-sm hover:bg-gray-50"
        menuClassName="absolute left-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg"
      >
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={href(anchorFor(p.key))}
            scroll={false}
            aria-current={tf.period === p.key ? 'true' : undefined}
            className={`block px-3 py-1.5 hover:bg-gray-50 ${tf.period === p.key ? 'font-medium text-brand-teal' : 'text-gray-700'}`}
          >
            {p.label}
          </Link>
        ))}
      </DropdownMenu>

      {tf.anchor && tf.prevAnchor && tf.nextAnchor && (
        <div className="flex items-stretch divide-x divide-gray-300 overflow-hidden rounded-md border border-gray-300 bg-white shadow-sm">
          <Link href={href({ period: tf.period, anchor: tf.prevAnchor })} scroll={false} aria-label="Previous period" className={arrow}>
            ←
          </Link>
          <PeriodJumpButton basePath={basePath} params={{ ...keep, period: tf.period }} anchor={tf.anchor} prefix={prefix} range={range} />
          <Link href={href({ period: tf.period, anchor: tf.nextAnchor })} scroll={false} aria-label="Next period" className={arrow}>
            →
          </Link>
        </div>
      )}
      {showToday && (
        <Link href={href({ period: tf.period, anchor: todayYmd })} scroll={false} className="text-xs text-gray-500 hover:text-brand-teal">
          Return to this {current.label.toLowerCase()}
        </Link>
      )}

      {tf.period === 'custom' && (
        <form action={basePath} method="get" className="flex flex-wrap items-center gap-2">
          {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          <input type="hidden" name="period" value="custom" />
          <label className="flex items-center gap-1 text-gray-500">
            From
            <input type="date" name="from" defaultValue={tf.from ? ymd(tf.from) : ''} className="rounded-md border border-gray-300 px-2 py-1 text-gray-800" />
          </label>
          <label className="flex items-center gap-1 text-gray-500">
            to
            <input type="date" name="to" defaultValue={tf.till ? ymd(tf.till) : ''} className="rounded-md border border-gray-300 px-2 py-1 text-gray-800" />
          </label>
          <button type="submit" className="rounded-md border border-gray-300 bg-white px-3 py-1 text-gray-700 hover:bg-gray-50">
            {submitLabel}
          </button>
        </form>
      )}
    </div>
  )
}
