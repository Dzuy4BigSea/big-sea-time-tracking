'use client'

import { useState, type ReactNode } from 'react'
import {
  budgetSeries, chartScale, fmtAmount, fmtHours, fmtTick, remainingText, type BudgetUnit, type SeriesPoint,
} from '@/modules/projects/budgetChart'

export type ChartBudget = {
  unit: BudgetUnit
  /** Minutes (hours budgets) or cents (fee budgets). */
  value: number
  /** Resets each month: every month is measured on its own against `value`. */
  monthly: boolean
  /** Spend before the first bucket (all-time budgets only). */
  priorMinutes: number
  priorCents: number
}

type View = 'progress' | 'bars'

/**
 * Project analysis chart (Harvest parity, BugHerd #25). With an all-time budget it opens on
 * "Project progress": the cumulative spent line against a grey "Budget: X" line; "Hours per
 * month" switches to the per-month bars. Every bucket has a hover / keyboard-focus tooltip with
 * the period's spend, the running total and what's left (or how far over). Spend past the budget
 * turns red. SVG/CSS only; all numbers arrive pre-aggregated from the DB.
 */
export function ProjectBudgetChart({
  year, labels, highlight, minutes, cents, budget, lastIndex, nav,
}: {
  year: number
  labels: string[]
  highlight: boolean[]
  /** Tracked minutes per bucket. */
  minutes: number[]
  /** Billable cents per bucket (used for fee budgets). */
  cents: number[]
  budget: ChartBudget | null
  /** Last bucket that isn't in the future (−1 when the whole year is ahead). */
  lastIndex: number
  nav?: ReactNode
}) {
  const hasProgress = Boolean(budget && !budget.monthly)
  const [view, setView] = useState<View>(hasProgress ? 'progress' : 'bars')
  const [active, setActive] = useState<number | null>(null)
  const n = labels.length

  const unit: BudgetUnit = budget?.unit ?? 'hours'
  const spent = unit === 'money' ? cents : minutes
  const series: SeriesPoint[] | null = budget
    ? budgetSeries(spent, {
        budget: budget.value,
        prior: unit === 'money' ? budget.priorCents : budget.priorMinutes,
        resetsEachPeriod: budget.monthly,
        lastIndex,
      })
    : null
  // The progress line runs through the current month (or the last month with time, if later).
  const lastPlot = Math.max(lastIndex, ...spent.map((v, i) => (v > 0 ? i : -1)))
  const prior = budget && !budget.monthly ? (unit === 'money' ? budget.priorCents : budget.priorMinutes) : 0

  const isProgress = view === 'progress' && series != null
  // Bars plot hours, except for a monthly fee budget (each month vs. the fee in dollars).
  const barUnit: BudgetUnit = budget?.monthly ? unit : 'hours'
  const barValues = barUnit === 'money' ? cents : minutes
  const showBudgetLine = budget != null && (isProgress || budget.monthly)
  const plotted = isProgress ? [prior, ...series!.slice(0, lastPlot + 1).map((p) => p.cumulative)] : barValues
  const axisUnit = isProgress ? unit : barUnit
  const { max, ticks } = chartScale(plotted, showBudgetLine ? budget!.value : null, axisUnit)
  const pct = (v: number) => Math.min(100, Math.max(0, (v / max) * 100))
  const gridValues = Array.from({ length: ticks + 1 }, (_, i) => (max / ticks) * i)

  const tooltipLines = (i: number): { text: string; tone?: 'over' | 'ok' }[] => {
    const lines: { text: string; tone?: 'over' | 'ok' }[] = [{ text: `Spent: ${fmtHours(minutes[i])} hours` }]
    if (unit === 'money' && budget) lines.push({ text: `Billable: ${fmtAmount(cents[i], 'money')}` })
    const p = series?.[i]
    if (p && budget && !(isProgress && p.future && p.spent === 0)) {
      if (!budget.monthly) lines.push({ text: `Total spent: ${fmtAmount(p.cumulative, unit)}` })
      lines.push({ text: remainingText(p.remaining!, unit), tone: p.over ? 'over' : 'ok' })
    }
    return lines
  }
  const periodLabel = (i: number) => `${labels[i]} ${year}`

  const budgetLabel = budget ? `${budget.monthly ? 'Monthly budget' : 'Budget'}: ${fmtAmount(budget.value, unit)}` : ''
  const title = isProgress ? 'Project progress' : barUnit === 'money' ? 'Billable amount per month' : 'Hours per month'

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {nav}
        <h2 className="text-sm font-semibold text-gray-700">{title} — {year}</h2>
        {hasProgress && (
          <div role="group" aria-label="Chart view" className="ml-auto inline-flex overflow-hidden rounded border border-gray-300 text-xs">
            {([['progress', '↗ Project progress'], ['bars', 'ılı Hours per month']] as const).map(([v, l]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => { setView(v); setActive(null) }}
                className={`px-2.5 py-1 ${view === v ? 'bg-orange-50 font-medium text-brand-orange' : 'bg-white text-gray-600 hover:bg-gray-50'} ${v === 'bars' ? 'border-l border-gray-300' : ''}`}
              >
                {l}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {/* Y-axis labels */}
        <div className="relative h-44 w-14 shrink-0" aria-hidden>
          {gridValues.map((v, i) => (
            <span key={i} className="absolute translate-y-1/2 pl-1 text-[10px] leading-none tabular-nums text-gray-400" style={{ bottom: `${pct(v)}%` }}>
              {fmtTick(v, axisUnit)}
            </span>
          ))}
        </div>

        {/* Plot */}
        <div className="relative h-44 flex-1" onMouseLeave={() => setActive(null)}>
          {gridValues.map((v, i) => (
            <div key={i} aria-hidden className="absolute inset-x-0 h-px bg-gray-100" style={{ bottom: `${pct(v)}%` }} />
          ))}

          {/* Current-timeframe shading (Harvest shades "This week") */}
          <div aria-hidden className="absolute inset-0 flex">
            {labels.map((_, i) => <div key={i} className={`flex-1 ${isProgress && highlight[i] ? 'bg-blue-50' : ''}`} />)}
          </div>

          {!isProgress && (
            <div aria-hidden className="absolute inset-0 flex items-stretch gap-1.5">
              {barValues.map((v, i) => {
                const over = series?.[i]?.over ?? false
                const color = over ? (highlight[i] ? '#ef4444' : '#f87171') : highlight[i] ? '#9ca3af' : '#c7ccd1'
                return (
                  <div key={i} className="flex flex-1 flex-col justify-end">
                    <div className={`w-full rounded-t-sm ${active === i ? 'opacity-80' : ''}`} style={{ height: `${pct(v)}%`, background: color }} />
                  </div>
                )
              })}
            </div>
          )}

          {isProgress && (
            <>
              <svg aria-hidden className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1000 100" preserveAspectRatio="none">
                {(() => {
                  const pts = [{ x: 0, y: 100 - pct(prior), over: false }].concat(
                    series!.slice(0, lastPlot + 1).map((p, i) => ({ x: ((i + 0.5) / n) * 1000, y: 100 - pct(p.cumulative), over: p.over })),
                  )
                  const area = `M0,100 ${pts.map((p) => `L${p.x},${p.y}`).join(' ')} L${pts[pts.length - 1].x},100 Z`
                  return (
                    <>
                      <path d={area} fill="#3b82f6" fillOpacity={0.08} />
                      {pts.slice(1).map((p, i) => (
                        <line
                          key={i}
                          x1={pts[i].x} y1={pts[i].y} x2={p.x} y2={p.y}
                          stroke={p.over ? '#ef4444' : '#3b82f6'} strokeWidth={2} vectorEffect="non-scaling-stroke"
                        />
                      ))}
                    </>
                  )
                })()}
              </svg>
              {series!.slice(0, lastPlot + 1).map((p, i) => (
                <span
                  key={i}
                  aria-hidden
                  className={`absolute -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-white ${p.over ? 'bg-red-500' : 'bg-blue-500'} ${active === i ? 'h-3 w-3' : 'h-2 w-2'}`}
                  style={{ left: `${((i + 0.5) / n) * 100}%`, bottom: `${pct(p.cumulative)}%` }}
                />
              ))}
            </>
          )}

          {showBudgetLine && (
            <div aria-hidden className="pointer-events-none absolute inset-x-0" style={{ bottom: `${pct(budget!.value)}%` }}>
              <div className="border-t-2 border-dashed border-gray-400" />
              <span className="absolute bottom-0.5 left-1 rounded bg-white/85 px-1 text-[10px] font-medium text-gray-500">{budgetLabel}</span>
            </div>
          )}

          {/* Hover / focus targets, one per bucket */}
          <div className="absolute inset-0 flex">
            {labels.map((_, i) => {
              const lines = tooltipLines(i)
              return (
                <button
                  key={i}
                  type="button"
                  className="h-full flex-1 cursor-default rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/50"
                  aria-label={[periodLabel(i), ...lines.map((l) => l.text)].join('. ')}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive((a) => (a === i ? null : a))}
                />
              )
            })}
          </div>

          {active != null && (
            <div
              role="tooltip"
              className={`pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg ${
                active < 2 ? '' : active > n - 3 ? '-translate-x-full' : '-translate-x-1/2'
              }`}
              style={{ left: `${((active + (active < 2 ? 0 : active > n - 3 ? 1 : 0.5)) / n) * 100}%` }}
            >
              <div className="mb-1 font-semibold text-gray-900">{periodLabel(active)}</div>
              {tooltipLines(active).map((l, j) => (
                <div key={j} className={`tabular-nums ${l.tone === 'over' ? 'font-medium text-red-600' : l.tone === 'ok' ? 'font-medium text-gray-900' : 'text-gray-600'}`}>
                  {l.text}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* X-axis labels aligned under the buckets */}
      <div aria-hidden className="mt-1 flex gap-2">
        <div className="w-14 shrink-0" />
        <div className="flex flex-1 gap-1.5">
          {labels.map((l, i) => (
            <span key={i} className={`flex-1 text-center text-[10px] ${highlight[i] ? 'font-semibold text-gray-600' : 'text-gray-400'}`}>{l}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
