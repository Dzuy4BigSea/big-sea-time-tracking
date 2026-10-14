/**
 * Redirect URI rules for MCP OAuth clients (specs/22 §OAuth, OAuth 2.1 §2.3 / RFC 8252).
 *
 * Registration accepts only `https://` URIs, plus `http://` on a loopback host (localhost, 127.0.0.1,
 * [::1]) for desktop clients. No fragments, no userinfo, no custom schemes. At authorization time the
 * requested URI must equal a registered one exactly (string comparison), except that a loopback URI
 * may use any port (RFC 8252 §7.3: native apps pick an ephemeral port).
 */

export const MAX_REDIRECT_URI_LENGTH = 2000
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export type RedirectUriCheck = { ok: true; uri: string } | { ok: false; error: string }

export function validateRedirectUri(raw: unknown): RedirectUriCheck {
  if (typeof raw !== 'string' || !raw) return { ok: false, error: 'redirect_uri must be a non-empty string' }
  if (raw.length > MAX_REDIRECT_URI_LENGTH) return { ok: false, error: 'redirect_uri is too long' }
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { ok: false, error: 'redirect_uri must be an absolute URL' }
  }
  if (raw.includes('#') || u.hash) return { ok: false, error: 'redirect_uri must not contain a fragment' }
  if (u.username || u.password) return { ok: false, error: 'redirect_uri must not contain credentials' }
  if (u.protocol === 'https:') return { ok: true, uri: raw }
  if (u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname)) return { ok: true, uri: raw }
  return { ok: false, error: 'redirect_uri must use https (http is allowed only for localhost / 127.0.0.1)' }
}

function isLoopback(u: URL): boolean {
  return u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname)
}

/** Is `requested` one of the client's registered redirect URIs (exact, or loopback with another port)? */
export function redirectUriMatches(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true
  let req: URL
  try {
    req = new URL(requested)
  } catch {
    return false
  }
  if (!isLoopback(req) || req.hash || req.username || req.password) return false
  return registered.some((r) => {
    try {
      const reg = new URL(r)
      return isLoopback(reg) && reg.hostname === req.hostname && reg.pathname === req.pathname && reg.search === req.search
    } catch {
      return false
    }
  })
}

/** Append OAuth response parameters to a redirect URI, keeping any query it already has. */
export function withParams(redirectUri: string, params: Record<string, string | undefined>): string {
  const u = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v)
  return u.toString()
}
