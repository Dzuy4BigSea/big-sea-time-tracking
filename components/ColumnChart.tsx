import type { ReactNode } from 'react'

export type Bar = { label: string; segments: { value: number; color: string }[]; highlight?: boolean; title?: string }

/** Round up to a "nice" axis maximum (1/2/2.5/5/10 × 10ⁿ) so gridline labels read cleanly. */
function niceCeil(n: number): number {
  if (n <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(n)))
  const f = n / pow
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nf * pow
}

/**
 * Presentational column chart with horizontal reference lines + value labels on the Y axis, so the
 * magnitude of each bar is legible. Bars are stacked segments; heights are scaled to a "nice" max
 * shared with the gridlines. Pure/server — no interactivity.
 */
export function ColumnChart({
  bars,
  format,
  ticks = 4,
  height = 'h-44',
  yWidth = 'w-14',
}: {
  bars: Bar[]
  format: (v: number) => string
  ticks?: number
  height?: string
  yWidth?: string
}) {
  const rawMax = Math.max(1, ...bars.map((b) => b.segments.reduce((s, x) => s + x.value, 0)))
  const max = niceCeil(rawMax)
  const lines = Array.from({ length: ticks + 1 }, (_, i) => (max / ticks) * i)

  const Grid = ({ withLabels }: { withLabels?: boolean }): ReactNode =>
    lines.map((v, i) => (
      <div key={i} className="absolute inset-x-0 flex items-center" style={{ bottom: `${(v / max) * 100}%` }}>
        <div className="h-px w-full bg-gray-100" />
        {withLabels && <span className="absolute -translate-y-1/2 pl-1 text-[10px] tabular-nums text-gray-400">{format(v)}</span>}
      </div>
    ))

  return (
    <div>
      <div className="flex gap-2">
        {/* Y-axis labels */}
        <div className={`relative ${height} ${yWidth} shrink-0`}>{Grid({ withLabels: true })}</div>
        {/* Plot: gridlines behind, bars in front */}
        <div className={`relative ${height} flex-1`}>
          {Grid({})}
          <div className="absolute inset-0 flex items-stretch gap-1.5">
            {bars.map((b, i) => (
              <div key={i} className="flex flex-1 flex-col" title={b.title}>
                <div className="flex flex-1 flex-col justify-end">
                  {b.segments.map((seg, j) => (
                    <div
                      key={j}
                      className={j === 0 ? 'w-full rounded-t-sm' : 'w-full'}
                      style={{ height: `${(seg.value / max) * 100}%`, background: seg.color }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* X-axis labels aligned under the bars */}
      <div className="mt-1 flex gap-2">
        <div className={`${yWidth} shrink-0`} />
        <div className="flex flex-1 gap-1.5">
          {bars.map((b, i) => (
            <span key={i} className={`flex-1 text-center text-[10px] ${b.highlight ? 'font-semibold text-gray-600' : 'text-gray-400'}`}>{b.label}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
