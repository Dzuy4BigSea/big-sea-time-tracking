import NextAuth, { type NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
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
import {
  checkGoogleProfile,
  googleRefusalPath,
  isGoogleConfigured,
  matchGoogleUser,
  parseAllowedDomains,
} from '@/modules/shared/googleSignIn'

// Best-effort, per-instance limiter (also covers unknown emails); the durable per-user lockout
// is the AuditLog count below. See modules/shared/loginThrottle.ts.
const memoryLimiter = createMemoryLimiter()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function fail(email: string): Promise<null> {
  memoryLimiter.recordFailure(email)
  await sleep(failureDelayMs())
  return null
}

// ── Optional "Sign in with Google" (OPS.md → Google sign-in) ────────────────────────────────────
// Off unless AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET are set; without them the app behaves exactly as
// before. Scopes are sign-in only (openid email profile) — Drive export will ask for more later via
// incremental consent. No adapter: Google only proves the Workspace email; the signIn callback maps
// it to an existing active User row (never creates one), and lib/session.ts re-checks isActive /
// profile on every request just as for password logins. Successful password logins aren't audited
// (only failures, for the lockout), so successful Google logins aren't either.
const googleEnabled = isGoogleConfigured({
  AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
  AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
})
const googleDomains = parseAllowedDomains(process.env.AUTH_GOOGLE_ALLOWED_DOMAINS)

const googleProviders = googleEnabled
  ? [
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
        authorization: {
          params: {
            scope: 'openid email profile',
            // `hd` only pre-filters Google's account chooser (a hint the user can edit); the
            // enforced check is the ID token's `hd` claim in the signIn callback below.
            hd: googleDomains.length === 1 ? googleDomains[0] : '*',
            prompt: 'select_account',
          },
        },
      }),
    ]
  : []

const signInCallback: NonNullable<NextAuthConfig['callbacks']>['signIn'] = async ({ user, account, profile }) => {
  // Credentials already did its own checks in authorize().
  if (account?.provider !== 'google') return true

  const checked = checkGoogleProfile(profile, googleDomains)
  if (!checked.ok) return googleRefusalPath(checked.reason)

  let candidates
  try {
    candidates = await prisma.user.findMany({
      where: { email: { equals: checked.email, mode: 'insensitive' } },
      select: {
        id: true,
        accountId: true,
        isActive: true,
        email: true,
        firstName: true,
        lastName: true,
        permissionProfile: true,
      },
      take: 10,
    })
  } catch {
    return googleRefusalPath('unavailable')
  }
  const match = matchGoogleUser(candidates)
  if (!match.ok) return googleRefusalPath(match.reason)

  // No adapter → Auth.js passes this same `user` object on to the jwt callback. Replace the Google
  // profile (id = Google `sub`) with the Track2 user so the token carries the same claims as a
  // password login (see the shared jwt callback in auth.config.ts).
  const u = match.user
  user.id = u.id
  user.email = u.email
  user.name = `${u.firstName} ${u.lastName}`
  user.accountId = u.accountId
  user.permissionProfile = u.permissionProfile
  return true
}

const jwtCallback: NonNullable<NextAuthConfig['callbacks']>['jwt'] = (params) => {
  // Belt and braces: a Google login that somehow wasn't mapped to a Track2 user gets no session.
  if (params.account?.provider === 'google' && params.user && !params.user.accountId) return null
  return authConfig.callbacks.jwt(params)
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: { ...authConfig.callbacks, signIn: signInCallback, jwt: jwtCallback },
  providers: [
    ...googleProviders,
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
