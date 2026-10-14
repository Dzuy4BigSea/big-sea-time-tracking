/**
 * SendGrid v3 Mail Send: pure payload builder + response parser (no I/O, unit-tested).
 *
 * Deliverability choices for client-facing invoice mail (OPS.md "Email deliverability"):
 * - multipart: a text/plain part always accompanies text/html (SendGrid requires text/plain first);
 * - click tracking OFF: SendGrid would otherwise rewrite every link through its own tracking domain
 *   (sendgrid.net / em123.<domain>), so the invoice link would no longer point at Track2. Mismatched,
 *   redirecting links in a payment email look like phishing to filters and to careful clients;
 * - open tracking stays on (a 1×1 pixel, no link rewriting) so "email opened" reaches the trace;
 * - subscription tracking OFF and no List-Unsubscribe header: invoices, reminders and receipts are
 *   transactional mail the client needs; an unsubscribe link would let a client silently opt out of
 *   their own invoices (and SendGrid would then suppress them). Gmail/Yahoo's one-click-unsubscribe
 *   rule applies to bulk/marketing mail, not to transactional invoices;
 * - custom_args { invoiceId, accountId, traceKind } ride on the message so every provider event
 *   (delivered, bounce, open…) posted to /api/email/events maps back to the invoice trace.
 */

export type TraceKind = 'invoice' | 'resend' | 'reminder' | 'receipt'

export interface MailInput {
  to: string[]
  from: { email: string; name?: string | null }
  replyTo?: string | null
  subject: string
  html: string
  text: string
  /** Correlation for provider events. All values must be strings (SendGrid rule). */
  customArgs?: Record<string, string>
  categories?: string[]
}

/** Strip CR/LF (header injection) and collapse whitespace in a subject line. */
export function cleanSubject(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 250)
}

/** Lower-cased, de-duplicated, syntactically plausible addresses, in input order. */
export function normalizeRecipients(list: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const e = (raw ?? '').trim()
    if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(e)) continue
    const key = e.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

export function buildSendGridPayload(m: MailInput): Record<string, unknown> {
  const customArgs = m.customArgs && Object.keys(m.customArgs).length ? m.customArgs : undefined
  return {
    personalizations: [{ to: m.to.map((email) => ({ email })), ...(customArgs ? { custom_args: customArgs } : {}) }],
    from: { email: m.from.email, ...(m.from.name ? { name: m.from.name } : {}) },
    ...(m.replyTo ? { reply_to: { email: m.replyTo } } : {}),
    subject: cleanSubject(m.subject),
    // text/plain must come before text/html.
    content: [
      { type: 'text/plain', value: m.text },
      { type: 'text/html', value: m.html },
    ],
    ...(m.categories?.length ? { categories: m.categories.slice(0, 10) } : {}),
    tracking_settings: {
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: true },
      subscription_tracking: { enable: false },
    },
  }
}

export interface SendOutcome {
  ok: boolean
  httpStatus: number
  /** SendGrid's X-Message-Id (prefix of sg_message_id on every webhook event). */
  messageId: string | null
  /** Provider error body, trimmed (it never contains our API key). */
  error: string | null
}

export function parseSendGridResponse(status: number, headers: { get(name: string): string | null }, body: string): SendOutcome {
  const ok = status >= 200 && status < 300
  return {
    ok,
    httpStatus: status,
    messageId: ok ? headers.get('x-message-id') : null,
    error: ok ? null : summarizeError(body),
  }
}

/** SendGrid errors are `{ errors: [{ message, field }] }`; fall back to the raw (trimmed) body. */
function summarizeError(body: string): string {
  try {
    const j = JSON.parse(body) as { errors?: { message?: string; field?: string | null }[] }
    if (Array.isArray(j.errors) && j.errors.length) {
      return j.errors.map((e) => [e.field, e.message].filter(Boolean).join(': ')).join('; ').slice(0, 500)
    }
  } catch {
    /* not JSON */
  }
  return body.slice(0, 500)
}

/** The X-Message-Id part of a webhook `sg_message_id` ("<id>.filterdrecv-…" → "<id>"). */
export function baseMessageId(sgMessageId: string | null | undefined): string | null {
  if (!sgMessageId) return null
  return sgMessageId.split('.')[0] || null
}

/** Hosts of every http(s) link in `html` that are not in `allowedHosts` (deliverability guard). */
export function foreignLinkHosts(html: string, allowedHosts: string[]): string[] {
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()))
  const out = new Set<string>()
  for (const m of html.matchAll(/href\s*=\s*"(https?:\/\/[^"]+)"/gi)) {
    try {
      const host = new URL(m[1]).hostname.toLowerCase()
      if (!allowed.has(host)) out.add(host)
    } catch {
      out.add('(invalid url)')
    }
  }
  return [...out]
}

/**
 * Is `baseUrl` fit to put in a client email? A localhost / non-https origin in production means
 * APP_URL is missing: the client would get a dead link, so the send is refused instead.
 */
export function publicLinkProblem(baseUrl: string, env: Record<string, string | undefined> = process.env): string | null {
  const production = env.VERCEL_ENV === 'production' || (env.NODE_ENV === 'production' && !!env.VERCEL)
  if (!production) return null
  let u: URL
  try {
    u = new URL(baseUrl)
  } catch {
    return 'APP_URL is not a valid URL'
  }
  if (u.protocol !== 'https:') return 'APP_URL must be https in production'
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname)) return 'APP_URL points at localhost'
  return null
}
