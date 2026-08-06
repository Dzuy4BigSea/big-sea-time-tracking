'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import type { ModuleFlags } from '@/lib/modules'
import { DEFAULT_MODULES } from '@/lib/modules'

type Item = { label: string; href: string; ready?: boolean; moduleKey?: keyof ModuleFlags }
type Section = { heading?: string; items: Item[] }

const NAV: Section[] = [
  { items: [{ label: 'Home', href: '/', ready: true }] },
  {
    heading: 'Track',
    items: [
      { label: 'Timesheet', href: '/timesheet', ready: true, moduleKey: 'timeTracking' },
      { label: 'Expenses', href: '/expenses', ready: true, moduleKey: 'expenseTracking' },
    ],
  },
  {
    heading: 'Organize',
    items: [
      { label: 'Team', href: '/team', ready: true, moduleKey: 'team' },
      { label: 'Clients', href: '/clients', ready: true },
      { label: 'Projects', href: '/projects', ready: true },
      { label: 'Tasks', href: '/tasks', ready: true },
    ],
  },
  {
    heading: 'Bill',
    items: [
      { label: 'Invoices', href: '/invoices', ready: true, moduleKey: 'invoices' },
      { label: 'Estimates', href: '/estimates', ready: true, moduleKey: 'estimates' },
      { label: 'Recurring', href: '/recurring', ready: true, moduleKey: 'invoices' },
      { label: 'Retainers', href: '/retainers', ready: true, moduleKey: 'invoices' },
    ],
  },
  { heading: 'Review', items: [{ label: 'Reports', href: '/reports', ready: true }] },
]

// The Big Sea "rope" motif — a lime hatch strip pinned to the left edge (contained width, 14px).
const ROPE = 'repeating-linear-gradient(45deg,#bbfd50 0 7px,#ffffff 7px 14px)'

export function Sidebar({
  userName,
  showSettings,
  modules = DEFAULT_MODULES,
}: {
  userName?: string
  showSettings?: boolean
  modules?: ModuleFlags
}) {
  const pathname = usePathname()
  const visibleNav = NAV.map((section) => ({
    ...section,
    items: section.items.filter((i) => !i.moduleKey || modules[i.moduleKey]),
  })).filter((section) => section.items.length > 0)

  const navLink = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] ${
        active ? 'bg-brand-lime/15 font-semibold text-brand-lime' : 'text-white/75 hover:bg-white/5 hover:text-white'
      }`}
    >
      <span className={`h-1.5 w-1.5 flex-none rounded-full ${active ? 'bg-brand-lime' : 'bg-white/30'}`} />
      {label}
    </Link>
  )

  const settingsActive = pathname === '/settings'
  const migrateActive = pathname.startsWith('/settings/migrate')
  const integrationsActive = pathname.startsWith('/settings/integrations')

  return (
    <aside className="flex w-[238px] shrink-0">
      <div className="w-3.5 flex-none" style={{ background: ROPE }} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col bg-brand-ink px-3 py-4">
        {/* Brand lockup */}
        <div className="px-2 pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logotype-white.svg" alt="Big Sea" className="block h-auto w-[86px]" />
          <div className="my-2.5 h-0.5 w-8 bg-brand-lime" />
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-lime">Track2</div>
        </div>

        <nav className="flex-1 space-y-4">
          {visibleNav.map((section, i) => (
            <div key={i}>
              {section.heading && (
                <div className="mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-white/55">
                  {section.heading}
                </div>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
                  return <li key={item.href}>{navLink(item.href, item.label, active)}</li>
                })}
              </ul>
            </div>
          ))}
        </nav>

        {showSettings && (
          <div className="mt-4 space-y-0.5 border-t border-white/10 pt-3">
            <div className="mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-white/55">Admin</div>
            {navLink('/settings/integrations', 'Integrations', integrationsActive)}
            {navLink('/settings/migrate', 'Migrate', migrateActive)}
            {navLink('/settings', 'Settings', settingsActive)}
          </div>
        )}

        {userName && (
          <div className="mt-4 flex items-center gap-2.5 border-t border-white/10 pt-3">
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-lime/15 text-[11px] font-bold text-brand-lime">
              {userName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-white">{userName}</div>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="text-[11px] text-white/50 hover:text-brand-lime"
              >
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
