import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { authConfig } from './auth.config'
import { prisma } from '@/lib/prisma'
import {
  createMemoryLimiter,
  failureDelayMs,
  isLockedOut,
  LOGIN_FAILURE_ENTITY,
  LOGIN_WINDOW_MS,
} from '@/modules/shared/loginThrottle'

// Best-effort, per-instance limiter (also covers unknown emails); the durable per-user lockout
// is the AuditLog count below. See modules/shared/loginThrottle.ts.
const memoryLimiter = createMemoryLimiter()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function fail(email: string): Promise<null> {
  memoryLimiter.recordFailure(email)
  await sleep(failureDelayMs())
  return null
}

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
        if (memoryLimiter.isBlocked(email)) return fail(email)

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
        if (!user) return fail(email)

        // Durable lockout: too many recent failures for this user → refuse without checking the
        // password (same generic error, so it doesn't reveal the lock or the account's existence).
        const recentFailures = await prisma.auditLog
          .count({
            where: {
              entityType: LOGIN_FAILURE_ENTITY,
              entityId: user.id,
              createdAt: { gte: new Date(Date.now() - LOGIN_WINDOW_MS) },
            },
          })
          .catch(() => 0)
        if (isLockedOut(recentFailures)) return fail(email)

        // Async compare (doesn't block the event loop). Imported/no-login users have a non-bcrypt
        // sentinel hash, which compare() safely rejects.
        const ok = await bcrypt.compare(password, user.passwordHash).catch(() => false)
        if (!ok) {
          await prisma.auditLog
            .create({
              data: {
                accountId: user.accountId,
                actorUserId: null,
                entityType: LOGIN_FAILURE_ENTITY,
                entityId: user.id,
                action: 'update',
                after: { summary: 'Failed sign-in' },
              },
            })
            .catch(() => {})
          return fail(email)
        }
        memoryLimiter.reset(email)

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
