import Link from 'next/link'

const TABS = [
  { label: 'Time', href: '/reports' },
  { label: 'Expenses', href: '/reports/expenses' },
  { label: 'Profitability', href: '/reports/profitability' },
  { label: 'Receivables', href: '/reports/receivables' },
]

export function ReportsTabs({ active }: { active: string }) {
  return (
    <nav className="mb-6 flex gap-1 border-b border-gray-200">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
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
