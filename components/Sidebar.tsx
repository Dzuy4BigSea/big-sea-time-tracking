'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Item = { label: string; href: string; ready?: boolean }
type Section = { heading?: string; items: Item[] }

const NAV: Section[] = [
  { items: [{ label: 'Home', href: '/' }] },
  {
    heading: 'Track',
    items: [
      { label: 'Timesheet', href: '/timesheet' },
      { label: 'Expenses', href: '/expenses' },
    ],
  },
  {
    heading: 'Organize',
    items: [
      { label: 'Team', href: '/team' },
      { label: 'Clients', href: '/clients', ready: true },
      { label: 'Projects', href: '/projects', ready: true },
      { label: 'Tasks', href: '/tasks' },
    ],
  },
  { heading: 'Bill', items: [{ label: 'Invoices', href: '/invoices', ready: true }] },
  { heading: 'Review', items: [{ label: 'Reports', href: '/reports' }] },
]

export function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="w-56 shrink-0 border-r border-gray-200 bg-white px-3 py-4">
      <div className="mb-6 flex items-center gap-2 px-2">
        <span className="inline-block h-5 w-5 rounded bg-brand-orange" />
        <span className="text-lg font-semibold tracking-tight">harvest</span>
      </div>
      <nav className="space-y-5">
        {NAV.map((section, i) => (
          <div key={i}>
            {section.heading && (
              <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                {section.heading}
              </div>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`block rounded px-2 py-1.5 text-sm ${
                        active ? 'bg-orange-50 font-medium text-brand-orange' : 'text-gray-700 hover:bg-gray-50'
                      } ${item.ready ? '' : 'text-gray-400'}`}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}
