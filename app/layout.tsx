import type { Metadata } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import { Sidebar } from '@/components/Sidebar'
import { TopBar } from '@/components/TopBar'
import { SiteFooter } from '@/components/SiteFooter'
import { Shell } from '@/components/Shell'
import { auth } from '@/auth'
import { getTopBarData } from '@/lib/topbar'
import { getModules, DEFAULT_MODULES } from '@/lib/modules'
import { can, type PermissionProfile } from '@/modules/shared/permissions'

export const metadata: Metadata = {
  title: 'Track2',
  description: 'Track2 — time tracking + invoicing',
}

// Routes that render bare (no sidebar / no session chrome) — the public invoice view + print views.
const BARE_PREFIXES = ['/i/', '/print/']

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
  const topBar = userId ? await getTopBarData(userId) : { projects: [], running: null }
  const accountId = session?.user?.accountId
  const modules = accountId ? await getModules(accountId) : DEFAULT_MODULES
  const today = new Date().toISOString().slice(0, 10)

  return (
    <html lang="en">
      <body>
        <Shell
          sidebar={
            <Sidebar
              userName={session?.user?.name ?? undefined}
              showSettings={can({ permissionProfile: profile }, 'edit_account_settings')}
              modules={modules}
            />
          }
          topbar={
            <TopBar
              projects={topBar.projects}
              running={topBar.running}
              canManageInvoices={can({ permissionProfile: profile }, 'manage_invoices')}
              today={today}
            />
          }
          footer={<SiteFooter />}
        >
          {children}
        </Shell>
      </body>
    </html>
  )
}
