/**
 * Normalize a user-supplied link (e.g. an expense receipt URL) to an absolute http(s) URL, or null.
 * Anything else — javascript:, data:, relative paths, garbage — is rejected so it can never be
 * rendered as a clickable href.
 */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  if (!s || s.length > 2048) return null
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (!u.hostname) return null
  return u.toString()
}
