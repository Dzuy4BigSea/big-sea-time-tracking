import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { authConfig } from './auth.config'
import { prisma } from '@/lib/prisma'

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const email = String(creds?.email ?? '')
          .toLowerCase()
          .trim()
        const password = String(creds?.password ?? '')
        if (!email || !password) return null

        // NOTE: email is unique per account in the schema; for demo login we match the
        // first active user with this email. Real multi-account login should disambiguate.
        const user = await prisma.user.findFirst({ where: { email, isActive: true } })
        if (!user) return null
        if (!bcrypt.compareSync(password, user.passwordHash)) return null

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          accountId: user.accountId,
          permissionProfile: user.permissionProfile,
        }
      },
    }),
  ],
})
