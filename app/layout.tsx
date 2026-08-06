import type { Metadata } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import { Sidebar } from '@/components/Sidebar'
import { TopBar } from '@/components/TopBar'
import { auth } from '@/auth'
import { getTopBarData } from '@/lib/topbar'
import { can, type PermissionProfile } from '@/modules/shared/permissions'

export const metadata: Metadata = {
  title: 'Track2',
  description: 'Track2 — time tracking + invoicing',
}

// Routes that render bare (no sidebar / no session chrome) — e.g. the public invoice view.
const BARE_PREFIXES = ['/i/']

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
  const today = new Date().toISOString().slice(0, 10)

  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen bg-gray-50">
          <Sidebar
            userName={session?.user?.name ?? undefined}
            showSettings={can({ permissionProfile: profile }, 'edit_account_settings')}
          />
          <main className="flex-1 overflow-x-auto">
            <TopBar
              projects={topBar.projects}
              running={topBar.running}
              canManageInvoices={can({ permissionProfile: profile }, 'manage_invoices')}
              today={today}
            />
            <div className="mx-auto max-w-6xl px-8 py-6">{children}</div>
          </main>
        </div>
      </body>
    </html>
  )
}
