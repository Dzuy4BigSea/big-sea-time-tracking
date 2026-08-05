import type { NextAuthConfig } from 'next-auth'

/**
 * Edge-safe auth config (no Prisma) — used by middleware for route protection and by the
 * full config in auth.ts. The Credentials provider (which needs Prisma) is added there.
 */
export const authConfig = {
  pages: { signIn: '/login' },
  providers: [], // real provider added in auth.ts (Node runtime)
  session: { strategy: 'jwt' },
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
