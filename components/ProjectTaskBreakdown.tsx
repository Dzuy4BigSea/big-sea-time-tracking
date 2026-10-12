'use client'

import { Fragment, useState } from 'react'
import { formatCents } from '@/lib/format'
import { SortableTh } from '@/components/SortableTh'
import { buildHref } from '@/modules/shared/timeframe'
import type { SortState } from '@/modules/reports/sort'

/** Sortable columns, shared by the Tasks and Team tables. */
export type BreakdownSortKey = 'name' | 'hours' | 'billable' | 'costs'

export type BreakdownChild = { id: string; name: string; minutes: number; billableCents: number; costCents: number; pills?: string[] }
export type BreakdownRow = BreakdownChild & {
  /** Initials for the avatar circle (Team table); omitted on the Tasks table. */
  avatar?: string
  /** True when a $0 billable amount is likely wrong (billable time on a project missing rates). */
  rateWarning?: boolean
  children: BreakdownChild[]
}
export type BreakdownSection = { title: string; rows: BreakdownRow[] }

const hrs = (m: number) => (m / 60).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const PILL: Record<string, string> = {
  Manager: 'bg-brand-teal-50 text-brand-teal',
  Archived: 'bg-gray-100 text-gray-500',
}

/**
 * Harvest-style project analysis table (Tasks or Team tab): a sortable header named after the
 * first section ("Billable tasks" / "Team"), further sections ("Non-billable tasks") as sub-headers,
 * and a bold Total row. Rows with children expand (chevron) to show the other axis — people under
 * a task, tasks under a person. Rows arrive sorted (server-side, URL-driven); headers are sort
 * links built from `basePath` + `query` (the page's other params: tab, timeframe). The Costs column
 * shows only when the account tracks cost rates.
 */
export function ProjectTaskBreakdown({
  sections,
  showCosts,
  sort,
  basePath,
  query,
  emptyText = 'No time tracked in this timeframe.',
  fixRatesHref,
}: {
  sections: BreakdownSection[]
  showCosts: boolean
  sort: SortState<BreakdownSortKey>
  basePath: string
  query: Record<string, string | null | undefined>
  emptyText?: string
  fixRatesHref?: string
}) {
  const hrefFor = (s: SortState<BreakdownSortKey>) => buildHref(basePath, { ...query, sort: s.key, dir: s.dir })
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const visible = sections.filter((s, i) => i === 0 || s.rows.length > 0)
  const all = visible.flatMap((s) => s.rows)
  const total = all.reduce(
    (a, t) => ({ minutes: a.minutes + t.minutes, billableCents: a.billableCents + t.billableCents, costCents: a.costCents + t.costCents }),
    { minutes: 0, billableCents: 0, costCents: 0 },
  )
  const cols = showCosts ? 4 : 3
  // With only non-billable rows, title the header after that section instead of an empty first one.
  const headSection = visible[0]?.rows.length ? visible[0] : visible.find((s) => s.rows.length) ?? visible[0]

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
            <SortableTh label={headSection?.title ?? 'Name'} col="name" sort={sort} hrefFor={hrefFor} />
            <SortableTh label="Hours" col="hours" sort={sort} hrefFor={hrefFor} firstDir="desc" align="right" />
            <SortableTh label="Billable amount" col="billable" sort={sort} hrefFor={hrefFor} firstDir="desc" align="right" />
            {showCosts && <SortableTh label="Costs" col="costs" sort={sort} hrefFor={hrefFor} firstDir="desc" align="right" />}
          </tr>
        </thead>
        {visible.map((section) =>
          section.rows.length === 0 ? null : (
            <tbody key={section.title}>
              {section !== headSection && (
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th colSpan={cols} className="px-4 py-2 font-medium">{section.title}</th>
                </tr>
              )}
              {section.rows.map((r) => (
                <ExpandableRow
                  key={r.id}
                  row={r}
                  isOpen={!!open[r.id]}
                  showCosts={showCosts}
                  fixRatesHref={fixRatesHref}
                  onToggle={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))}
                />
              ))}
            </tbody>
          ),
        )}
        {all.length === 0 && (
          <tbody>
            <tr><td colSpan={cols} className="px-4 py-8 text-center text-gray-400">{emptyText}</td></tr>
          </tbody>
        )}
        {all.length > 0 && (
          <tfoot>
            <tr className="border-t border-gray-200 font-semibold">
              <td className="px-4 py-3">Total</td>
              <td className="px-4 py-3 text-right tabular-nums">{hrs(total.minutes)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatCents(total.billableCents)}</td>
              {showCosts && <td className="px-4 py-3 text-right tabular-nums">{formatCents(total.costCents)}</td>}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

function Pills({ pills }: { pills?: string[] }) {
  if (!pills?.length) return null
  return (
    <>
      {pills.map((p) => (
        <span key={p} className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${PILL[p] ?? 'bg-gray-100 text-gray-600'}`}>{p}</span>
      ))}
    </>
  )
}

function ExpandableRow({
  row, isOpen, showCosts, fixRatesHref, onToggle,
}: {
  row: BreakdownRow; isOpen: boolean; showCosts: boolean; fixRatesHref?: string; onToggle: () => void
}) {
  const expandable = row.children.length > 0
  return (
    <Fragment>
      <tr
        className={`border-b border-gray-100 ${expandable ? 'cursor-pointer hover:bg-gray-50' : ''} ${isOpen ? 'bg-blue-50 hover:bg-blue-50' : ''}`}
        onClick={expandable ? onToggle : undefined}
        aria-expanded={expandable ? isOpen : undefined}
      >
        <td className="px-4 py-2.5 text-gray-800">
          <span className="flex items-center">
            <span className="mr-1.5 inline-block w-3 shrink-0 text-gray-400" aria-hidden>{expandable ? (isOpen ? '▾' : '▸') : ''}</span>
            {row.avatar && (
              <span className="mr-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-teal-50 text-xs font-semibold text-brand-teal" aria-hidden>
                {row.avatar}
              </span>
            )}
            <span>{row.name}</span>
            <Pills pills={row.pills} />
          </span>
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{hrs(row.minutes)}</td>
        <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
          {formatCents(row.billableCents)}
          {row.rateWarning && (
            fixRatesHref ? (
              <a
                href={fixRatesHref}
                onClick={(e) => e.stopPropagation()}
                className="ml-1 text-amber-500"
                title="This amount might be wrong because your project is missing billable rates. Fix those rates"
              >
                ⚠
              </a>
            ) : (
              <span className="ml-1 text-amber-500" title="This amount might be wrong because your project is missing billable rates.">⚠</span>
            )
          )}
        </td>
        {showCosts && <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{formatCents(row.costCents)}</td>}
      </tr>
      {isOpen &&
        row.children.map((c) => (
          <tr key={c.id} className="border-b border-gray-100 bg-blue-50/40 text-xs">
            <td className="py-1.5 pl-11 pr-4 text-gray-600">
              {c.name}
              <Pills pills={c.pills} />
            </td>
            <td className="px-4 py-1.5 text-right tabular-nums text-gray-500">{hrs(c.minutes)}</td>
            <td className="px-4 py-1.5 text-right tabular-nums text-gray-500">{formatCents(c.billableCents)}</td>
            {showCosts && <td className="px-4 py-1.5 text-right tabular-nums text-gray-400">{formatCents(c.costCents)}</td>}
          </tr>
        ))}
    </Fragment>
  )
}
