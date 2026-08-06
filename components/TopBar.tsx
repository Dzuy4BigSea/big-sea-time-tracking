'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

// Map a path prefix to the section title shown on the left of the bar.
const TITLES: { prefix: string; title: string }[] = [
  { prefix: '/timesheet', title: 'Timesheet' },
  { prefix: '/expenses', title: 'Expenses' },
  { prefix: '/team', title: 'Team' },
  { prefix: '/clients', title: 'Clients' },
  { prefix: '/projects', title: 'Projects' },
  { prefix: '/tasks', title: 'Tasks' },
  { prefix: '/invoices', title: 'Invoices' },
  { prefix: '/reports', title: 'Reports' },
]

const QUICK_CREATE = [
  { label: 'Time entry', href: '/timesheet' },
  { label: 'Expense', href: '/expenses' },
  { label: 'Client', href: '/clients' },
  { label: 'Project', href: '/projects' },
  { label: 'Task', href: '/tasks' },
  { label: 'Invoice', href: '/invoices' },
]

function titleFor(pathname: string): string {
  if (pathname === '/') return 'Home'
  return TITLES.find((t) => pathname.startsWith(t.prefix))?.title ?? 'Track2'
}

export function TopBar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close the quick-create menu on outside click / route change.
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white/90 px-8 py-3 backdrop-blur">
      <h2 className="text-sm font-semibold text-gray-700">{titleFor(pathname)}</h2>

      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded bg-brand-orange px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          + New
        </button>
        {open && (
          <div
            role="menu"
            className="absolute right-0 mt-1 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          >
            {QUICK_CREATE.map((q) => (
              <Link
                key={q.label}
                href={q.href}
                role="menuitem"
                className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                {q.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
