'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'

/**
 * App shell (spec 20). Desktop: static sidebar + main, as before. Mobile (< lg): the sidebar becomes
 * an off-canvas drawer opened by a hamburger in a slim top bar, dismissed by a backdrop, and closed
 * on navigation. `sidebar`, `topbar`, and `footer` are server-rendered nodes passed through.
 */
export function Shell({
  sidebar,
  topbar,
  footer,
  children,
}: {
  sidebar: ReactNode
  topbar: ReactNode
  footer: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  useEffect(() => setOpen(false), [pathname]) // close drawer on navigation

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Backdrop (mobile only, when open) */}
      {open && <div onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-black/40 lg:hidden" aria-hidden />}

      {/* Sidebar: drawer under lg, static at lg+ */}
      <div
        className={`fixed inset-y-0 left-0 z-40 transform transition-transform duration-200 lg:static lg:z-auto lg:transform-none ${
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {sidebar}
      </div>

      <main className="flex min-h-screen min-w-0 flex-1 flex-col overflow-x-auto">
        {/* Mobile top bar with hamburger */}
        <div className="flex items-center gap-3 border-b border-gray-200 bg-brand-ink px-4 py-2.5 lg:hidden">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded text-brand-lime hover:bg-white/10"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <span className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-lime">Track2</span>
        </div>

        {topbar}
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8">{children}</div>
        {footer}
      </main>
    </div>
  )
}
