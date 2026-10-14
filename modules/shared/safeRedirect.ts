/**
 * Same-origin redirect targets from user-controlled input (e.g. /login?callbackUrl=…). Only a local
 * path survives: absolute URLs, protocol-relative `//host`, backslash tricks (`/\host`), and control
 * characters fall back to `fallback`. The result is path + query + hash, never an origin.
 */
export function safeCallbackPath(raw: string | null | undefined, fallback = '/'): string {
  if (typeof raw !== 'string' || !raw) return fallback
  if (raw.length > 4096) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback
  try {
    const base = 'http://track2.invalid'
    const u = new URL(raw, base)
    if (u.origin !== base) return fallback
    // Never bounce back to the login page itself.
    if (u.pathname === '/login' || u.pathname.startsWith('/login/')) return fallback
    return `${u.pathname}${u.search}${u.hash}`
  } catch {
    return fallback
  }
}
