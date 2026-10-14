import { NextResponse } from 'next/server'
import NextAuth from 'next-auth'
import { authConfig } from './auth.config'

// Edge middleware uses the Prisma-free config to read the JWT session.
export const { auth } = NextAuth(authConfig)

// Routes reachable without a session. `/i/` is the public (client-facing) invoice view.
// `/.well-known/` serves the OAuth discovery documents for MCP clients (specs/22 §OAuth).
// `/oauth/` (the connector consent screen) checks the session itself and sends signed-out people to
// /login?callbackUrl=… so they come back to the consent screen; its POST answers on its own too.
const PUBLIC_PREFIXES = ['/login', '/i/', '/.well-known/', '/oauth/']

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))
  const isLoggedIn = !!req.auth?.user

  if (!isPublic && !isLoggedIn) {
    return NextResponse.redirect(new URL('/login', req.nextUrl))
  }

  // Surface the path to server components (root layout decides whether to show the app chrome).
  const headers = new Headers(req.headers)
  headers.set('x-pathname', pathname)
  // Server components can't see the HTTP method; /i/[token] uses it to ignore HEAD link checks.
  headers.set('x-request-method', req.method)
  return NextResponse.next({ request: { headers } })
})

export const config = {
  // Run on everything except API routes, Next internals, and static files.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
