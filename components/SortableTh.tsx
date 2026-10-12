import Link from 'next/link'
import { nextSort, type SortDir, type SortState } from '@/modules/reports/sort'

/**
 * Clickable, URL-driven table header for sortable report tables. `hrefFor` turns the target sort
 * into a link (the page keeps its other params). Text columns start A→Z; numeric columns start
 * largest-first (`firstDir`), matching Harvest.
 */
export function SortableTh<K extends string>({
  label,
  col,
  sort,
  hrefFor,
  firstDir = 'asc',
  align = 'left',
}: {
  label: string
  col: K
  sort: SortState<K>
  hrefFor: (s: SortState<K>) => string
  firstDir?: SortDir
  align?: 'left' | 'right'
}) {
  const active = sort.key === col
  const target = nextSort(sort, col, firstDir)
  return (
    <th
      className={`px-4 py-3 font-medium ${align === 'right' ? 'text-right' : ''}`}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <Link
        href={hrefFor(target)}
        scroll={false}
        className={`inline-flex items-center gap-1 hover:text-gray-700 ${active ? 'text-gray-700' : ''}`}
        title={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <span aria-hidden className={active ? '' : 'text-gray-300'}>
          {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </Link>
    </th>
  )
}
