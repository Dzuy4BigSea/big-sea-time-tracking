import type { Metadata } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import { Sidebar } from '@/components/Sidebar'
import { auth } from '@/auth'

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
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen bg-gray-50">
          <Sidebar userName={session?.user?.name ?? undefined} />
          <main className="flex-1 overflow-x-auto">
            <div className="mx-auto max-w-6xl px-8 py-6">{children}</div>
          </main>
        </div>
      </body>
    </html>
  )
}
