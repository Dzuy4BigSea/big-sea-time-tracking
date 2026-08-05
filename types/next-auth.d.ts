import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: { id: string; accountId: string; profile: string } & DefaultSession['user']
  }
  interface User {
    accountId?: string
    permissionProfile?: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string
    accountId?: string
    profile?: string
  }
}
