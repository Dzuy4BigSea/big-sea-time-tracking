import Link from 'next/link'
import { buildHref } from '@/modules/reports/timeframe'

// `timed` tabs share the timeframe picker, so switching between them keeps the selected period.
const TABS = [
  { label: 'Time', href: '/reports', timed: true },
  { label: 'Expenses', href: '/reports/expenses', timed: true },
  { label: 'Profitability', href: '/reports/profitability', timed: true },
  { label: 'Receivables', href: '/reports/receivables', timed: false },
]

export function ReportsTabs({ active, timeframe }: { active: string; timeframe?: Record<string, string> }) {
  return (
    <nav className="mb-6 flex gap-1 border-b border-gray-200">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.timed && timeframe ? buildHref(t.href, timeframe) : t.href}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${
            t.label === active
              ? 'border-brand-teal font-medium text-brand-teal'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
