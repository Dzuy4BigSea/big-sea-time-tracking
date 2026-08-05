import NextAuth from 'next-auth'
import { authConfig } from './auth.config'

// Edge middleware uses the Prisma-free config to gate routes via the JWT session.
export default NextAuth(authConfig).auth

export const config = {
  // Run on everything except API routes, Next internals, and static files.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
