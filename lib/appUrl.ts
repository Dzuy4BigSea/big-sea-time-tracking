/**
 * The app's public origin for links we hand to third parties (Stripe success/cancel URLs, emails).
 * Comes from configuration, never from request headers: x-forwarded-host / host are client-
 * influenced, so building redirect targets from them enables open-redirect / phishing links.
 *
 * Order: APP_URL → AUTH_URL → NEXTAUTH_URL → Vercel's production domain → localhost (dev only).
 */
export function resolveAppUrl(env: Record<string, string | undefined> = process.env): string {
  const candidates = [env.APP_URL, env.AUTH_URL, env.NEXTAUTH_URL]
  for (const c of candidates) {
    const origin = originOf(c)
    if (origin) return origin
  }
  const vercelProd = env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercelProd) {
    const origin = originOf(/^https?:\/\//.test(vercelProd) ? vercelProd : `https://${vercelProd}`)
    if (origin) return origin
  }
  return 'http://localhost:3000'
}

function originOf(raw: string | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.origin
  } catch {
    return null
  }
}
