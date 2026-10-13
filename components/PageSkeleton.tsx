/**
 * Loading placeholders for route `loading.tsx` files: shown instantly on navigation while the server
 * renders the page, so a slow query (or a cold start) reads as "loading" instead of a frozen click.
 * Server component, no JS. Follows DESIGN-SYSTEM.md (gray-200 bordered white cards/tables).
 */

function Bar({ className = '' }: { className?: string }) {
  return <span className={`block animate-pulse rounded bg-gray-100 ${className}`} />
}

function Title({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <Bar className="h-7 w-40 bg-gray-200" />
      {withAction && <Bar className="h-8 w-28" />}
    </div>
  )
}

function Filters({ count = 3 }: { count?: number }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {Array.from({ length: count }, (_, i) => (
        <Bar key={i} className="h-8 w-40" />
      ))}
    </div>
  )
}

function TableSkeleton({ rows = 10, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex gap-6 border-b border-gray-200 px-4 py-3">
        {Array.from({ length: cols }, (_, c) => (
          <Bar key={c} className={`h-3 ${c === 0 ? 'w-48' : 'w-16'} ${c > 0 ? 'ml-auto' : ''}`} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-6 border-b border-gray-100 px-4 py-3 last:border-0">
          {Array.from({ length: cols }, (_, c) => (
            <Bar key={c} className={`h-4 ${c === 0 ? 'w-64' : 'w-16'} ${c > 0 ? 'ml-auto' : ''}`} />
          ))}
        </div>
      ))}
    </div>
  )
}

function Cards({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-white p-5">
          <Bar className="mb-3 h-3 w-20" />
          <Bar className="h-6 w-28 bg-gray-200" />
        </div>
      ))}
    </div>
  )
}

export type PageSkeletonVariant = 'table' | 'detail' | 'report' | 'timesheet'

/** A whole-page placeholder; pick the variant closest to the page's real layout. */
export function PageSkeleton({ variant = 'table', rows = 10 }: { variant?: PageSkeletonVariant; rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {variant === 'table' && (
        <>
          <Title withAction />
          <Filters />
          <TableSkeleton rows={rows} />
        </>
      )}
      {variant === 'detail' && (
        <>
          <Title withAction />
          <Cards />
          <TableSkeleton rows={rows} />
        </>
      )}
      {variant === 'report' && (
        <>
          <Title />
          <Filters count={4} />
          <Cards />
          <TableSkeleton rows={rows} />
        </>
      )}
      {variant === 'timesheet' && (
        <>
          <Title withAction />
          <Filters count={2} />
          <TableSkeleton rows={rows} cols={9} />
        </>
      )}
    </div>
  )
}
