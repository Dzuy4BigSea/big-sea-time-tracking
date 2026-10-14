import type { Metadata } from 'next'
import { Suspense } from 'react'
import { headers } from 'next/headers'
import './globals.css'
import { Sidebar } from '@/components/Sidebar'
import { TopBar } from '@/components/TopBar'
import { SiteFooter } from '@/components/SiteFooter'
import { Shell } from '@/components/Shell'
import { DriveExportNotice } from '@/components/DriveExportNotice'
import { auth } from '@/auth'
import { getCurrentUser, userCan } from '@/lib/session'
import { getTopBarData } from '@/lib/topbar'
import { getModules, DEFAULT_MODULES } from '@/lib/modules'
import { getAccountClock } from '@/lib/accountClock'
import { DEFAULT_TIMEZONE } from '@/lib/tz'
import { can, type PermissionProfile } from '@/modules/shared/permissions'

export const metadata: Metadata = {
  title: 'Track2',
  description: 'Track2 — time tracking + invoicing',
}

// Routes that render bare (no sidebar / no session chrome) — the public invoice view + print views,
// and the OAuth consent screen MCP clients (claude.ai connectors) open in a popup.
const BARE_PREFIXES = ['/i/', '/print/', '/oauth/']

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = headers().get('x-pathname') ?? ''
  const bare = BARE_PREFIXES.some((p) => pathname.startsWith(p))

  if (bare) {
    return (
      <html lang="en">
        <body>
          <div className="min-h-screen bg-gray-100">{children}</div>
        </body>
      </html>
    )
  }

  const session = await auth()
  const userId = session?.user?.id
  const profile = (session?.user?.profile ?? 'member') as PermissionProfile
  const accountId = session?.user?.accountId
  // Independent per-request reads, in parallel. The timezone drives the top bar's default dates.
  const [topBar, modules, clock, showInvoices] = await Promise.all([
    userId ? getTopBarData(userId) : Promise.resolve({ projects: [], running: null }),
    accountId ? getModules(accountId) : Promise.resolve(DEFAULT_MODULES),
    accountId ? getAccountClock(accountId) : Promise.resolve({ timezone: DEFAULT_TIMEZONE }),
    getCurrentUser().then((me) => !!me && userCan(me, 'manage_invoices')),
  ])

  return (
    <html lang="en">
      <body>
        <Shell
          sidebar={
            <Sidebar
              userName={session?.user?.name ?? undefined}
              showSettings={can({ permissionProfile: profile }, 'edit_account_settings')}
              showInvoices={showInvoices}
              modules={modules}
            />
          }
          topbar={
            <TopBar
              projects={topBar.projects}
              running={topBar.running}
              canManageInvoices={can({ permissionProfile: profile }, 'manage_invoices')}
              timezone={clock.timezone}
            />
          }
          footer={<SiteFooter />}
        >
          {/* "Saved to your Google Drive · Open spreadsheet" after an export (reads ?driveFile= etc.). */}
          <Suspense fallback={null}>
            <DriveExportNotice />
          </Suspense>
          {children}
        </Shell>
      </body>
    </html>
  )
}
