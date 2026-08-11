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
        // A DB/connection error here (e.g. a cold serverless→pooler connect) must NOT masquerade as
        // "invalid password" — rethrow a distinct error so the UI can say "try again", not "wrong password".
        let user
        try {
          user = await prisma.user.findFirst({ where: { email, isActive: true } })
        } catch (e) {
          throw new Error('AuthServiceUnavailable')
        }
        if (!user) return null
        // Async compare (doesn't block the event loop). Imported/no-login users have a non-bcrypt
        // sentinel hash, which compare() safely rejects.
        const ok = await bcrypt.compare(password, user.passwordHash).catch(() => false)
        if (!ok) return null

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
