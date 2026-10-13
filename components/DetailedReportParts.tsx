import Link from 'next/link'
import { DropdownMenu } from '@/components/DropdownMenu'
import { GROUPS, type DetailedFilters, type DetailedKind } from '@/modules/reports/detailed'
import type { Timeframe } from '@/modules/shared/timeframe'

/** MM/DD/YYYY from a UTC-midnight date (time-zone safe, unlike Intl in a non-UTC runtime). */
export const usDate = (d: Date) => {
  const s = new Date(d).toISOString()
  return `${s.slice(5, 7)}/${s.slice(8, 10)}/${s.slice(0, 4)}`
}

/** "10/12/2026 – 10/18/2026", "Since 01/01/2026", "All time". */
export function rangeTitle(tf: Timeframe): string {
  if (tf.from && tf.till) return `${usDate(tf.from)} – ${usDate(tf.till)}`
  if (tf.from) return `Since ${usDate(tf.from)}`
  if (tf.till) return `Through ${usDate(tf.till)}`
  return 'All time'
}

/** Toolbar choices the filter form must carry through (it only edits the timeframe + pickers). */
export function toolbarKeep(q: Record<string, string>, savedId?: string): Record<string, string> {
  const keep: Record<string, string> = {}
  for (const k of ['billable', 'invoiced', 'group', 'active']) if (q[k]) keep[k] = q[k]
  if (savedId) keep.saved = savedId
  return keep
}

/** "All clients" or the chosen names ("Acme, Globex +2 more"). */
export function filterNames(ids: string[], options: { value: string; label: string }[], all: string): string {
  if (!ids.length) return all
  const labels = ids.map((id) => options.find((o) => o.value === id)?.label ?? 'Unknown')
  return labels.length > 3 ? `${labels.slice(0, 3).join(', ')} +${labels.length - 3} more` : labels.join(', ')
}

/** Summary card: totals on the left, the active filters on the right (Harvest). */
export function DetailedSummary({ left, filters }: { left: React.ReactNode; filters: [string, string][] }) {
  return (
    <div className="mb-4 grid gap-6 rounded-lg border border-gray-200 bg-white p-6 md:grid-cols-2">
      <div className="min-w-0">{left}</div>
      <dl className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-x-6 gap-y-1 text-sm">
        {filters.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-gray-600">{k}</dt>
            <dd className="truncate font-semibold text-gray-900" title={v}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

const chevron = (
  <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

function Pick({ label, options, href }: { label: string; options: { key: string; label: string; active: boolean; q: Record<string, string | null> }[]; href: (q: Record<string, string | null>) => string }) {
  return (
    <DropdownMenu
      label={<span className="flex items-center gap-1.5 whitespace-nowrap">{label} {chevron}</span>}
      className="relative inline-block text-left"
      summaryClassName="cursor-pointer list-none rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm text-gray-800 shadow-sm hover:bg-gray-50"
      menuClassName="absolute left-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg"
    >
      {options.map((o) => (
        <Link
          key={o.key}
          href={href(o.q)}
          scroll={false}
          aria-current={o.active ? 'true' : undefined}
          className={`block px-3 py-1.5 text-sm hover:bg-gray-50 ${o.active ? 'font-medium text-brand-teal' : 'text-gray-700'}`}
        >
          {o.label}
        </Link>
      ))}
    </DropdownMenu>
  )
}

/** "Show: Billable · Non-billable ⌄", "Show: Invoiced · Uninvoiced ⌄", "Group by: Date ⌄", Active projects only, Export. */
export function DetailedToolbar({
  kind,
  f,
  href,
  exportHref,
  exportMenu,
}: {
  kind: DetailedKind
  f: DetailedFilters
  href: (q: Record<string, string | null>) => string
  exportHref: string
  /** Replaces the plain "Export CSV" button (e.g. an Export ▾ menu with Google Drive). */
  exportMenu?: React.ReactNode
}) {
  const billableLabel = { all: 'Billable · Non-billable', billable: 'Billable', nonbillable: 'Non-billable' }[f.billable]
  const invoicedLabel = { all: 'Invoiced · Uninvoiced', invoiced: 'Invoiced', uninvoiced: 'Uninvoiced' }[f.invoiced]
  const groupLabel = GROUPS[kind].find((g) => g.key === f.group)?.label ?? 'Date'
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Pick
        label={`Show: ${billableLabel}`}
        href={href}
        options={[
          { key: 'all', label: 'Billable and non-billable', active: f.billable === 'all', q: { billable: null } },
          { key: 'billable', label: 'Billable only', active: f.billable === 'billable', q: { billable: 'billable' } },
          { key: 'nonbillable', label: 'Non-billable only', active: f.billable === 'nonbillable', q: { billable: 'nonbillable' } },
        ]}
      />
      <Pick
        label={`Show: ${invoicedLabel}`}
        href={href}
        options={[
          { key: 'all', label: 'Invoiced and uninvoiced', active: f.invoiced === 'all', q: { invoiced: null } },
          { key: 'invoiced', label: 'Invoiced only', active: f.invoiced === 'invoiced', q: { invoiced: 'invoiced' } },
          { key: 'uninvoiced', label: 'Uninvoiced only', active: f.invoiced === 'uninvoiced', q: { invoiced: 'uninvoiced' } },
        ]}
      />
      <Pick
        label={`Group by: ${groupLabel}`}
        href={href}
        options={GROUPS[kind].map((g) => ({ key: g.key, label: g.label, active: f.group === g.key, q: { group: g.key === 'date' ? null : g.key } }))}
      />
      <Link
        href={href({ active: f.activeOnly ? null : '1' })}
        scroll={false}
        role="checkbox"
        aria-checked={f.activeOnly}
        className="ml-1 flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
      >
        <span
          aria-hidden
          className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] leading-none ${f.activeOnly ? 'border-brand-teal bg-brand-teal text-white' : 'border-gray-300 bg-white'}`}
        >
          {f.activeOnly ? '✓' : ''}
        </span>
        Active projects only
      </Link>
      {exportMenu ? (
        <div className="ml-auto">{exportMenu}</div>
      ) : (
        <a href={exportHref} className="ml-auto rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-800 shadow-sm hover:bg-gray-50">
          Export CSV
        </a>
      )}
    </div>
  )
}
