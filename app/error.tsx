'use client'

import Link from 'next/link'
import { useEffect } from 'react'

/**
 * Route error boundary: a page threw while rendering (most often a database hiccup, e.g. a cold or
 * waking Supabase timing out). Rendered inside the app shell, so the sidebar and top bar stay usable.
 * Next logs the server-side error (stack + digest) to the Vercel function logs; the digest shown here
 * and logged to the browser console lets a user report be matched to that log line.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[track2] page error', error.digest ?? '', error)
  }, [error])

  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center">
      <h1 className="mb-2 text-lg font-semibold text-gray-900">This page didn’t load</h1>
      <p className="mb-5 text-sm text-gray-500">
        Something went wrong on our side. It’s usually temporary (the database may still be waking up), so
        trying again often works.
      </p>
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => reset()}
          className="rounded bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          Try again
        </button>
        <Link href="/" className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Go to dashboard
        </Link>
      </div>
      {error.digest && <p className="mt-5 text-xs text-gray-400">Reference: {error.digest}</p>}
    </div>
  )
}
