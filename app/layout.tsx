import type { Metadata } from 'next'
import './globals.css'
import { Sidebar } from '@/components/Sidebar'

export const metadata: Metadata = {
  title: 'Big Sea — Time Tracking',
  description: 'Harvest clone (time tracking + invoicing)',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen bg-gray-50">
          <Sidebar />
          <main className="flex-1 overflow-x-auto">
            <div className="mx-auto max-w-6xl px-8 py-6">{children}</div>
          </main>
        </div>
      </body>
    </html>
  )
}
