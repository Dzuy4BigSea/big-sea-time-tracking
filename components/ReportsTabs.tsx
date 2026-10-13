import Link from 'next/link'
import { DropdownMenu } from '@/components/DropdownMenu'
import { buildHref } from '@/modules/shared/timeframe'
import { getCurrentUser, userCan } from '@/lib/session'

// `timed` tabs share the timeframe picker, so switching between them keeps the selected period.
const TABS = [
  { label: 'Time', href: '/reports', timed: true },
  { label: 'Expenses', href: '/reports/expenses', timed: true },
  { label: 'Profitability', href: '/reports/profitability', timed: true, accountReport: true },
  { label: 'Receivables', href: '/reports/receivables', timed: false, accountReport: true },
  { label: 'Saved reports', href: '/reports/saved', timed: false },
]

/** Report-screen tabs, with Harvest's "+ New report ⌄" menu (Custom report / Detailed time / Detailed expense) on the right. */
export async function ReportsTabs({ active, timeframe }: { active: string; timeframe?: Record<string, string> }) {
  // Money reports are gated on run_account_reports; don't link people to pages that will 404.
  const me = await getCurrentUser()
  const canAccountReports = !!me && userCan(me, 'run_account_reports')
  const tabs = TABS.filter((t) => !('accountReport' in t && t.accountReport) || canAccountReports)
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200">
      <nav className="flex flex-wrap gap-1">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.timed && timeframe ? buildHref(t.href, timeframe) : t.href}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              t.label === active ? 'border-brand-teal font-medium text-brand-teal' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="pb-2">
        <NewReportMenu />
      </div>
    </div>
  )
}

export function NewReportMenu() {
  const item = 'block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50'
  return (
    <DropdownMenu
      label={
        <span className="flex items-center gap-1.5 font-semibold">
          <span aria-hidden>+</span> New report
          <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      }
      summaryClassName="cursor-pointer list-none rounded-md bg-brand-green px-3 py-1.5 text-sm text-white shadow-sm hover:opacity-90"
      menuClassName="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg"
    >
      <Link href="/reports" className={item}>Custom report</Link>
      <Link href="/reports/detailed?edit=1" className={item}>Detailed time</Link>
      <Link href="/reports/detailed/expenses?edit=1" className={item}>Detailed expense</Link>
    </DropdownMenu>
  )
}
