/**
 * "Sign in with Google" decision logic (pure, DB-free; wired up in auth.ts).
 *
 * Google is an identity check only: it proves the person controls a verified address in one of the
 * allowed Google Workspace domains. Access still comes from an EXISTING, active Track2 User row with
 * that email — Google sign-in never creates users, and lib/session.ts keeps re-checking isActive /
 * profile on every request exactly as for password logins.
 *
 * No Auth.js adapter is used, so there is no Account-linking table and Auth.js'
 * `allowDangerousEmailAccountLinking` has nothing to act on: the mapping is "verified Workspace email
 * → the single active User with that email", decided here on every Google sign-in.
 */

export const DEFAULT_GOOGLE_DOMAINS = ['bigsea.co']

/** Google is offered only when both OAuth client values are set. */
export function isGoogleConfigured(env: { AUTH_GOOGLE_ID?: string; AUTH_GOOGLE_SECRET?: string }): boolean {
  return !!env.AUTH_GOOGLE_ID?.trim() && !!env.AUTH_GOOGLE_SECRET?.trim()
}

/** AUTH_GOOGLE_ALLOWED_DOMAINS ("bigsea.co, example.com") → normalized list; empty/unset → bigsea.co. */
export function parseAllowedDomains(raw: string | undefined | null): string[] {
  const list = String(raw ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
  return list.length ? Array.from(new Set(list)) : [...DEFAULT_GOOGLE_DOMAINS]
}

export function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at > 0 && at < email.length - 1 ? email.slice(at + 1) : ''
}

export type GoogleRefusal = 'unverified' | 'domain' | 'no_user' | 'inactive' | 'ambiguous'

export type ProfileCheck = { ok: true; email: string } | { ok: false; reason: GoogleRefusal }

/**
 * The Google ID-token profile must be a verified address in a Workspace (`hd` claim present) whose
 * hosted domain AND email domain are both on the allow-list. A personal @gmail.com account has no
 * `hd`, so it is refused even if its address were somehow allowed.
 */
export function checkGoogleProfile(
  profile: { email?: unknown; email_verified?: unknown; hd?: unknown } | null | undefined,
  allowedDomains: string[],
): ProfileCheck {
  const email = normalizeEmail(profile?.email)
  if (!email || profile?.email_verified !== true) return { ok: false, reason: 'unverified' }
  const hd = typeof profile?.hd === 'string' ? profile.hd.trim().toLowerCase() : ''
  const allowed = new Set(allowedDomains.map((d) => d.toLowerCase()))
  if (!hd || !allowed.has(hd) || !allowed.has(emailDomain(email))) return { ok: false, reason: 'domain' }
  return { ok: true, email }
}

export interface UserCandidate {
  id: string
  accountId: string
  isActive: boolean
}

export type UserMatch<U extends UserCandidate> = { ok: true; user: U } | { ok: false; reason: GoogleRefusal }

/**
 * Pick the Track2 user for a Google email from every row whose email matches case-insensitively.
 * The same email in more than one account is refused (we can't tell which tenant is meant), as is
 * an email whose only row is inactive. Nobody is auto-created.
 */
export function matchGoogleUser<U extends UserCandidate>(candidates: U[]): UserMatch<U> {
  if (candidates.length === 0) return { ok: false, reason: 'no_user' }
  if (new Set(candidates.map((c) => c.accountId)).size > 1) return { ok: false, reason: 'ambiguous' }
  const active = candidates.filter((c) => c.isActive)
  if (active.length === 0) return { ok: false, reason: 'inactive' }
  // Email is unique per account, so >1 active row in one account shouldn't happen; refuse if it does.
  if (active.length > 1) return { ok: false, reason: 'ambiguous' }
  return { ok: true, user: active[0] }
}

/** `?error=` codes the sign-in flow sends back to /login. */
export const GOOGLE_ERROR_CODES: Record<GoogleRefusal | 'unavailable', string> = {
  unverified: 'GoogleNotWorkspace',
  domain: 'GoogleNotWorkspace',
  no_user: 'GoogleNoUser',
  inactive: 'GoogleInactive',
  ambiguous: 'GoogleAmbiguous',
  unavailable: 'GoogleUnavailable',
}

export function googleRefusalPath(reason: GoogleRefusal | 'unavailable'): string {
  return `/login?error=${GOOGLE_ERROR_CODES[reason]}`
}

/** Friendly text for a `/login?error=` code (Auth.js codes included); null = show nothing. */
export function loginErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null
  switch (code) {
    case 'GoogleNotWorkspace':
    case 'AccessDenied':
      return 'That Google account can’t be used for Track2. Sign in with your Big Sea Google Workspace account.'
    case 'GoogleNoUser':
      return 'Your Google account checks out, but there’s no Track2 user with that email. Ask an admin to add you.'
    case 'GoogleInactive':
      return 'Your Track2 user is deactivated. Ask an admin to reactivate it.'
    case 'GoogleAmbiguous':
      return 'That email belongs to more than one Track2 account, so Google sign-in can’t pick one. Ask an admin, or use your password.'
    case 'CredentialsSignin':
      return 'Invalid email or password.'
    case 'GoogleUnavailable':
      return 'Sign-in didn’t go through — the app may have been idle and is waking up. Please try again.'
    default:
      return 'Google sign-in didn’t complete. Please try again, or use your email and password.'
  }
}
