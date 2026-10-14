'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'

/** Client half of /login; page.tsx (server) decides whether Google is offered and maps ?error=. */
export default function LoginForm({
  googleEnabled,
  initialError,
  callbackUrl = '/',
}: {
  googleEnabled: boolean
  initialError: string | null
  /** Same-origin path to land on after sign-in (sanitized by page.tsx via safeCallbackPath). */
  callbackUrl?: string
}) {
  const [error, setError] = useState(initialError ?? '')
  const [pending, setPending] = useState(false)
  const [googlePending, setGooglePending] = useState(false)

  async function onGoogle() {
    setGooglePending(true)
    setError('')
    // A full browser redirect to Google and back (the callback then lands on / with a full page load,
    // so stale prefetched redirects can't bounce the user back here).
    try {
      await signIn('google', { redirectTo: callbackUrl })
    } catch {
      setGooglePending(false)
      setError('Sign-in didn’t go through — the app may have been idle and is waking up. Please try again.')
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError('')
    const form = new FormData(e.currentTarget)
    let res
    try {
      res = await signIn('credentials', {
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        redirect: false,
      })
    } catch {
      res = { error: 'AuthServiceUnavailable' }
    }
    setPending(false)
    if (res && !res.error) {
      // Full page load, not router.push: while signed out, the app shell's links were prefetched and
      // cached as redirects to /login, so a client-side push could bounce straight back here.
      window.location.assign(callbackUrl)
      return
    }
    // A cold serverless/DB connection surfaces as a non-credentials error — don't call it a bad password.
    const err = String(res?.error ?? '')
    if (err.includes('Credentials')) {
      setError('Invalid email or password.')
    } else {
      setError('Sign-in didn’t go through — the app may have been idle and is waking up. Please try again.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="inline-block h-6 w-6 rounded bg-brand-teal" />
          <span className="text-xl font-semibold tracking-tight">Track2</span>
        </div>
        <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
        <p className="mb-6 text-sm text-gray-500">Time tracking + invoicing for Big Sea.</p>

        {googleEnabled && (
          <>
            <button
              type="button"
              onClick={onGoogle}
              disabled={googlePending || pending}
              className="flex w-full items-center justify-center gap-3 rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
            >
              <GoogleG />
              {googlePending ? 'Redirecting to Google…' : 'Sign in with Google'}
            </button>
            <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-gray-400">
              <span className="h-px flex-1 bg-gray-200" />
              or use your password
              <span className="h-px flex-1 bg-gray-200" />
            </div>
          </>
        )}

        {/* method="post": if someone submits before JS loads, credentials must never land in the URL. */}
        <form method="post" action="/login" onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-gray-400">Email</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              placeholder="you@bigsea.co"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-gray-400">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || googlePending}
            className="w-full rounded bg-brand-green px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

/** Google's multicolor "G" mark (brand guidelines: white button, logo at left). */
function GoogleG() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
