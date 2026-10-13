'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { MultiCombobox } from '@/components/MultiCombobox'
import type { ComboOption } from '@/lib/combobox'

export type FilterOption = ComboOption & { archived: boolean }

/**
 * Detailed report builder (Harvest's peach filter panel): timeframe, "Include archived items in filters",
 * Clients / Projects / Tasks|Categories / Teammates pickers, Run report. A plain GET form to the report's
 * own URL; `keep` carries the toolbar choices (billable / invoiced / group / active / saved) through.
 */
export function DetailedReportFilters({
  path,
  itemsName,
  itemsLabel,
  itemsPlaceholder,
  rangeOptions,
  range,
  from,
  to,
  archived,
  selected,
  options,
  keep,
  submitLabel,
  cancelHref,
}: {
  path: string
  itemsName: 'tasks' | 'categories'
  itemsLabel: string
  itemsPlaceholder: string
  rangeOptions: { value: string; label: string }[]
  range: string
  from: string | null
  to: string | null
  archived: boolean
  selected: { clients: string[]; projects: string[]; items: string[]; users: string[] }
  options: { clients: FilterOption[]; projects: FilterOption[]; items: FilterOption[]; users: FilterOption[] }
  keep: Record<string, string>
  submitLabel: string
  cancelHref?: string
}) {
  const [rangeValue, setRangeValue] = useState(range)
  const [showArchived, setShowArchived] = useState(archived)

  // Hide archived items unless asked, but never hide something already chosen.
  const visible = useMemo(() => {
    const pick = (xs: FilterOption[], chosen: string[]) => xs.filter((o) => showArchived || !o.archived || chosen.includes(o.value))
    return {
      clients: pick(options.clients, selected.clients),
      projects: pick(options.projects, selected.projects),
      items: pick(options.items, selected.items),
      users: pick(options.users, selected.users),
    }
  }, [options, selected, showArchived])

  const row = 'grid items-start gap-2 sm:grid-cols-[10rem_minmax(0,32rem)] sm:gap-6'
  const label = 'pt-1.5 text-sm font-semibold text-gray-800'

  return (
    <form
      action={path}
      method="get"
      onSubmit={(e) => {
        // Keep the URL tidy: drop empty fields ("All clients") instead of sending `clients=`.
        for (const el of Array.from(e.currentTarget.elements)) {
          if (el instanceof HTMLInputElement && el.name && el.value === '' && el.type !== 'checkbox') el.disabled = true
        }
      }}
      className="mb-6 space-y-3 rounded-lg border border-orange-200 bg-orange-50/60 p-5"
    >
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className={row}>
        <label htmlFor="dr-range" className={label}>Timeframe</label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            id="dr-range"
            name="range"
            value={rangeValue}
            onChange={(e) => setRangeValue(e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
          >
            {rangeOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {rangeValue === 'custom' && (
            <>
              <input type="date" name="from" defaultValue={from ?? ''} aria-label="From" className="rounded border border-gray-300 px-2 py-1 text-sm" />
              <span className="text-sm text-gray-500">to</span>
              <input type="date" name="to" defaultValue={to ?? ''} aria-label="To" className="rounded border border-gray-300 px-2 py-1 text-sm" />
            </>
          )}
        </div>
      </div>
      <div className={row}>
        <span />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" name="archived" value="1" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Include archived items in filters
        </label>
      </div>
      <div className={row}>
        <span className={label}>Clients</span>
        <MultiCombobox name="clients" options={visible.clients} defaultValue={selected.clients} placeholder="All clients" aria-label="Clients" />
      </div>
      <div className={row}>
        <span className={label}>Projects</span>
        <MultiCombobox name="projects" options={visible.projects} defaultValue={selected.projects} placeholder="All projects" aria-label="Projects" />
      </div>
      <div className={row}>
        <span className={label}>{itemsLabel}</span>
        <MultiCombobox name={itemsName} options={visible.items} defaultValue={selected.items} placeholder={itemsPlaceholder} aria-label={itemsLabel} />
      </div>
      <div className={row}>
        <span className={label}>Teammates</span>
        <MultiCombobox name="users" options={visible.users} defaultValue={selected.users} placeholder="Everyone" aria-label="Teammates" />
      </div>
      <div className={row}>
        <span />
        <div className="flex items-center gap-2">
          <button type="submit" className="rounded-md bg-brand-green px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
            {submitLabel}
          </button>
          {cancelHref && (
            <Link href={cancelHref} scroll={false} className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
              Cancel
            </Link>
          )}
        </div>
      </div>
    </form>
  )
}
