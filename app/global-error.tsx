'use client'

import { useEffect } from 'react'

/**
 * Last-resort boundary: the root layout itself failed (it loads the session, top bar and modules from
 * the database on every page, so a cold or unreachable database lands here). Replaces the whole
 * document, so it brings its own <html>/<body> and inline styles rather than relying on the app shell.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[track2] layout error', error.digest ?? '', error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f9fafb', color: '#1a1a1a', fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>
        <div style={{ maxWidth: 420, margin: '96px auto', padding: 24, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#004348', marginBottom: 12 }}>Track2</div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>Track2 couldn’t load</h1>
          <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 20px' }}>
            Something went wrong on our side. It’s usually temporary (the database may still be waking up), so
            trying again in a few seconds often works.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={() => reset()}
              style={{ background: '#3aa76d', color: '#fff', border: 0, borderRadius: 4, padding: '6px 16px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
            >
              Try again
            </button>
            {/* A full page load, not client navigation: the app shell itself is what failed. */}
            <a href="/" style={{ border: '1px solid #d1d5db', color: '#374151', borderRadius: 4, padding: '6px 16px', fontSize: 14, fontWeight: 500, textDecoration: 'none' }}>
              Go to dashboard
            </a>
          </div>
          {error.digest && <p style={{ marginTop: 20, fontSize: 12, color: '#9ca3af' }}>Reference: {error.digest}</p>}
        </div>
      </body>
    </html>
  )
}
