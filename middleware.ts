import { NextResponse } from 'next/server'
import NextAuth from 'next-auth'
import { authConfig } from './auth.config'

// Edge middleware uses the Prisma-free config to read the JWT session.
export const { auth } = NextAuth(authConfig)

// Routes reachable without a session. `/i/` is the public (client-facing) invoice view.
const PUBLIC_PREFIXES = ['/login', '/i/']

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
  return NextResponse.next({ request: { headers } })
})

export const config = {
  // Run on everything except API routes, Next internals, and static files.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
