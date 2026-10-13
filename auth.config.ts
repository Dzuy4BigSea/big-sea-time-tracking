import type { NextAuthConfig } from 'next-auth'

/**
 * Edge-safe auth config (no Prisma) — used by middleware for route protection and by the
 * full config in auth.ts. The Credentials provider (which needs Prisma) is added there.
 */
export const authConfig = {
  pages: { signIn: '/login' },
  providers: [], // real provider added in auth.ts (Node runtime)
  // 14-day sliding sessions (re-issued at most daily while in use), so people who track time every
  // day aren't asked to sign in each morning (Dzuy, 2026-10-13). Access itself (active flag,
  // profile, overrides) is re-checked from the DB per request in lib/session.ts, so deactivation
  // still takes effect at once; this only bounds how long a forgotten cookie stays valid.
  session: { strategy: 'jwt', maxAge: 14 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  callbacks: {
    // Route protection: allow the login page; require a session everywhere else.
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      if (nextUrl.pathname.startsWith('/login')) return true
      return isLoggedIn
    },
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id
        token.accountId = user.accountId
        token.profile = user.permissionProfile
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.userId ?? '')
        session.user.accountId = String(token.accountId ?? '')
        session.user.profile = String(token.profile ?? 'member')
      }
      return session
    },
  },
} satisfies NextAuthConfig
