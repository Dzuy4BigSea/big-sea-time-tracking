/**
 * Billing-chain provider self-checks (OPS.md "Billing chain: trace, checks, tests").
 *
 * Every provider call here is a READ-ONLY GET with a 10 s timeout. Each check returns a
 * CheckResult; nothing in this file touches the database, so it is unit-tested with a mocked fetch.
 * Secrets are passed in, used only in the Authorization header, and never copied into a result.
 * The runner (healthRunner.ts) loads credentials, records one InvoiceEvent per result and alerts.
 */

export type HealthProvider = 'sendgrid' | 'stripe' | 'xero' | 'internal'
export type HealthLevel = 'info' | 'warn' | 'error'

export interface CheckResult {
  provider: HealthProvider
  /** Stable check name, e.g. "stripe.webhook". */
  check: string
  /** Business entity the connection belongs to (null = shared / account-wide). */
  entityId: string | null
  entity: string | null
  ok: boolean
  level: HealthLevel
  message: string
  details?: Record<string, unknown>
}

/** Dedupe/alert key for one check on one connection. */
export const checkKey = (r: Pick<CheckResult, 'check' | 'entityId'>) => `${r.check}:${r.entityId ?? 'shared'}`

export const TIMEOUT_MS = 10_000

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface HttpOutcome {
  status: number | null
  json: unknown
  error: 'timeout' | 'network' | null
  durationMs: number
}

/** GET `url` as JSON with a hard timeout. Never throws. */
export async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>, timeoutMs = TIMEOUT_MS): Promise<HttpOutcome> {
  const t0 = Date.now()
  const ctl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      ctl.abort()
      resolve('timeout')
    }, timeoutMs)
  })
  try {
    const res = await Promise.race([fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json', ...headers }, signal: ctl.signal, cache: 'no-store' }), timeout])
    if (res === 'timeout') return { status: null, json: null, error: 'timeout', durationMs: Date.now() - t0 }
    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    return { status: res.status, json, error: null, durationMs: Date.now() - t0 }
  } catch (e) {
    const aborted = (e as { name?: string })?.name === 'AbortError'
    return { status: null, json: null, error: aborted ? 'timeout' : 'network', durationMs: Date.now() - t0 }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

interface Ctx {
  entityId: string | null
  entity: string | null
}

const mk = (provider: HealthProvider, check: string, ctx: Ctx, level: HealthLevel, message: string, details?: Record<string, unknown>): CheckResult => ({
  provider,
  check,
  entityId: ctx.entityId,
  entity: ctx.entity,
  ok: level === 'info',
  level,
  message,
  ...(details ? { details } : {}),
})

/** Uniform mapping for transport failures and auth errors; null when the response is a 2xx. */
function httpProblem(provider: HealthProvider, check: string, ctx: Ctx, what: string, r: HttpOutcome): CheckResult | null {
  const base = { httpStatus: r.status, durationMs: r.durationMs }
  if (r.error === 'timeout') return mk(provider, check, ctx, 'error', `${what}: no response within ${TIMEOUT_MS / 1000}s`, base)
  if (r.error === 'network') return mk(provider, check, ctx, 'error', `${what}: network error`, base)
  const s = r.status ?? 0
  if (s === 401) return mk(provider, check, ctx, 'error', `${what}: credentials rejected (401)`, base)
  if (s === 403) return mk(provider, check, ctx, 'error', `${what}: credentials lack permission (403)`, base)
  if (s === 429) return mk(provider, check, ctx, 'warn', `${what}: rate limited (429), try again later`, base)
  if (s < 200 || s >= 300) return mk(provider, check, ctx, s >= 500 ? 'warn' : 'error', `${what}: unexpected HTTP ${s}`, base)
  return null
}

// ---------------------------------------------------------------------------------------------
// SendGrid
// ---------------------------------------------------------------------------------------------

const SENDGRID = 'https://api.sendgrid.com/v3'
/** Event types the email trace depends on (OPS.md stage table). */
export const SENDGRID_REQUIRED_EVENTS = ['delivered', 'bounce', 'dropped', 'spam_report'] as const

export async function checkSendgrid(
  fetchImpl: FetchLike,
  input: { apiKey: string; appUrl: string; senderEmails: string[] } & Ctx,
  timeoutMs = TIMEOUT_MS,
): Promise<CheckResult[]> {
  const ctx: Ctx = { entityId: input.entityId, entity: input.entity }
  const auth = { Authorization: `Bearer ${input.apiKey}` }
  const out: CheckResult[] = []

  // 1. Key valid + can send mail.
  const scopesRes = await getJson(fetchImpl, `${SENDGRID}/scopes`, auth, timeoutMs)
  const p1 = httpProblem('sendgrid', 'sendgrid.api_key', ctx, 'SendGrid API key', scopesRes)
  if (p1) return [p1] // nothing else will work with a bad key
  const scopes = ((scopesRes.json as { scopes?: unknown })?.scopes as string[] | undefined) ?? []
  out.push(
    scopes.includes('mail.send')
      ? mk('sendgrid', 'sendgrid.api_key', ctx, 'info', 'API key valid and has mail.send', { scopeCount: scopes.length, durationMs: scopesRes.durationMs })
      : mk('sendgrid', 'sendgrid.api_key', ctx, 'error', 'API key is valid but lacks the mail.send scope', { scopeCount: scopes.length }),
  )

  // 2. Event webhook enabled and pointed at us, with the events the trace needs.
  const expectedUrl = `${input.appUrl}/api/email/events`
  const whRes = await getJson(fetchImpl, `${SENDGRID}/user/webhooks/event/settings`, auth, timeoutMs)
  const p2 = httpProblem('sendgrid', 'sendgrid.event_webhook', ctx, 'SendGrid event webhook settings', whRes)
  if (p2) {
    if (whRes.status === 403) p2.message += ' — give the key read access to Mail Settings → Event Webhook, or verify it by hand'
    out.push(p2)
  } else {
    const wh = (whRes.json ?? {}) as Record<string, unknown>
    const url = String(wh.url ?? '')
    const missing = SENDGRID_REQUIRED_EVENTS.filter((e) => wh[e] !== true)
    const details = { url, enabled: wh.enabled === true, expectedUrl, missingEvents: missing, opens: wh.open === true }
    if (wh.enabled !== true) out.push(mk('sendgrid', 'sendgrid.event_webhook', ctx, 'error', 'Event webhook is disabled: delivery, bounce and spam events will not reach Track2', details))
    else if (!url.startsWith(expectedUrl)) out.push(mk('sendgrid', 'sendgrid.event_webhook', ctx, 'error', `Event webhook points at ${url || '(no URL)'}, expected ${expectedUrl}`, details))
    else if (missing.length) out.push(mk('sendgrid', 'sendgrid.event_webhook', ctx, 'warn', `Event webhook is not sending: ${missing.join(', ')}`, details))
    else if (wh.open !== true) out.push(mk('sendgrid', 'sendgrid.event_webhook', ctx, 'warn', 'Event webhook is not sending "open" events, so "Opened by client" relies on the invoice link only', details))
    else out.push(mk('sendgrid', 'sendgrid.event_webhook', ctx, 'info', 'Event webhook enabled and pointed at Track2', details))
  }

  // 3. Sending domain(s) authenticated.
  const domRes = await getJson(fetchImpl, `${SENDGRID}/whitelabel/domains`, auth, timeoutMs)
  const p3 = httpProblem('sendgrid', 'sendgrid.domain', ctx, 'SendGrid sender authentication', domRes)
  if (p3) {
    if (domRes.status === 403) p3.message += ' — give the key read access to Sender Authentication, or verify it by hand'
    out.push(p3)
  } else {
    const domains = (Array.isArray(domRes.json) ? domRes.json : []) as Array<{ domain?: string; subdomain?: string; valid?: boolean }>
    const senderDomains = [...new Set(input.senderEmails.map((e) => e.split('@')[1]?.toLowerCase()).filter((d): d is string => !!d))]
    if (!senderDomains.length) {
      out.push(mk('sendgrid', 'sendgrid.domain', ctx, 'warn', 'No from-address configured, so the sending domain cannot be checked'))
    } else {
      const rows = senderDomains.map((d) => {
        const hit = domains.filter((x) => x.domain && (d === x.domain.toLowerCase() || d.endsWith(`.${x.domain.toLowerCase()}`)))
        return { domain: d, authenticated: hit.some((x) => x.valid === true), found: hit.length > 0 }
      })
      const bad = rows.filter((r) => !r.authenticated)
      out.push(
        bad.length
          ? mk('sendgrid', 'sendgrid.domain', ctx, 'error', `Sending domain not authenticated in SendGrid: ${bad.map((b) => `${b.domain}${b.found ? ' (DNS not valid)' : ' (not set up)'}`).join(', ')}`, { domains: rows })
          : mk('sendgrid', 'sendgrid.domain', ctx, 'info', `Sending domain authenticated: ${rows.map((r) => r.domain).join(', ')}`, { domains: rows }),
      )
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------------------------

const STRIPE = 'https://api.stripe.com/v1'
/** Webhook events the payment trace needs. */
export const STRIPE_REQUIRED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
] as const
/** Without these, online payments are never recorded. */
const STRIPE_CRITICAL_EVENTS = new Set(['checkout.session.completed'])

/** Webhook paths Track2 accepts Stripe events on (current route + the /api/stripe/* family). */
export function isTrack2StripeWebhookUrl(url: string, appUrl: string, accountId: string): boolean {
  if (!url.startsWith(`${appUrl}/`)) return false
  const path = url.slice(appUrl.length)
  return path.startsWith(`/api/integrations/stripe/webhook/${accountId}`) || path.startsWith('/api/stripe/')
}

export async function checkStripe(
  fetchImpl: FetchLike,
  input: { secretKey: string; appUrl: string; accountId: string; expectLive: boolean } & Ctx,
  timeoutMs = TIMEOUT_MS,
): Promise<CheckResult[]> {
  const ctx: Ctx = { entityId: input.entityId, entity: input.entity }
  const auth = { Authorization: `Bearer ${input.secretKey}` }
  const out: CheckResult[] = []
  const keyLive = /^(sk|rk)_live_/.test(input.secretKey)

  const accRes = await getJson(fetchImpl, `${STRIPE}/account`, auth, timeoutMs)
  const p1 = httpProblem('stripe', 'stripe.account', ctx, 'Stripe account', accRes)
  if (p1) return [p1]
  const acc = (accRes.json ?? {}) as { id?: string; charges_enabled?: boolean; payouts_enabled?: boolean; details_submitted?: boolean; livemode?: boolean }
  const livemode = typeof acc.livemode === 'boolean' ? acc.livemode : keyLive
  const accDetails = { stripeAccount: acc.id ?? null, chargesEnabled: acc.charges_enabled === true, payoutsEnabled: acc.payouts_enabled === true, livemode, durationMs: accRes.durationMs }
  if (acc.charges_enabled !== true) out.push(mk('stripe', 'stripe.account', ctx, 'error', 'Stripe account cannot accept charges (charges_enabled is false)', accDetails))
  else if (input.expectLive && !livemode) out.push(mk('stripe', 'stripe.account', ctx, 'warn', 'Stripe is connected with a TEST key in production: clients cannot really pay', accDetails))
  else out.push(mk('stripe', 'stripe.account', ctx, 'info', `Stripe account active (${livemode ? 'live' : 'test'} mode)`, accDetails))

  const whRes = await getJson(fetchImpl, `${STRIPE}/webhook_endpoints?limit=100`, auth, timeoutMs)
  const p2 = httpProblem('stripe', 'stripe.webhook', ctx, 'Stripe webhook endpoints', whRes)
  if (p2) {
    out.push(p2)
    return out
  }
  const endpoints = (((whRes.json as { data?: unknown })?.data as Array<{ id?: string; url?: string; status?: string; enabled_events?: string[] }>) ?? [])
  const ours = endpoints.filter((e) => e.url && isTrack2StripeWebhookUrl(e.url, input.appUrl, input.accountId))
  if (!ours.length) {
    out.push(mk('stripe', 'stripe.webhook', ctx, 'error', `No Stripe webhook endpoint points at ${input.appUrl}: paid invoices will not be recorded`, { endpointCount: endpoints.length, endpointUrls: endpoints.map((e) => e.url).slice(0, 10) }))
    return out
  }
  const enabled = ours.filter((e) => e.status === 'enabled')
  if (!enabled.length) {
    out.push(mk('stripe', 'stripe.webhook', ctx, 'error', 'The Track2 Stripe webhook endpoint is disabled', { endpoints: ours.map((e) => ({ id: e.id, url: e.url, status: e.status })) }))
    return out
  }
  const subscribed = new Set(enabled.flatMap((e) => e.enabled_events ?? []))
  const missing = subscribed.has('*') ? [] : STRIPE_REQUIRED_EVENTS.filter((e) => !subscribed.has(e))
  const details = { endpoints: enabled.map((e) => ({ id: e.id, url: e.url })), missingEvents: missing }
  if (missing.some((m) => STRIPE_CRITICAL_EVENTS.has(m))) out.push(mk('stripe', 'stripe.webhook', ctx, 'error', `Stripe webhook is not subscribed to: ${missing.join(', ')}`, details))
  else if (missing.length) out.push(mk('stripe', 'stripe.webhook', ctx, 'warn', `Stripe webhook is not subscribed to: ${missing.join(', ')}`, details))
  else out.push(mk('stripe', 'stripe.webhook', ctx, 'info', 'Stripe webhook enabled with every required event', details))
  return out
}

// ---------------------------------------------------------------------------------------------
// Xero
// ---------------------------------------------------------------------------------------------

export async function checkXero(
  fetchImpl: FetchLike,
  input: { accessToken: string; tenantId: string; hasRefreshToken: boolean } & Ctx,
  timeoutMs = TIMEOUT_MS,
): Promise<CheckResult[]> {
  const ctx: Ctx = { entityId: input.entityId, entity: input.entity }
  const auth = { Authorization: `Bearer ${input.accessToken}` }
  const conRes = await getJson(fetchImpl, 'https://api.xero.com/connections', auth, timeoutMs)
  const p1 = httpProblem('xero', 'xero.connection', ctx, 'Xero connection', conRes)
  if (p1) {
    if (conRes.status === 401) p1.message += input.hasRefreshToken ? ' — the access token has expired; reconnect Xero in Settings → Integrations' : ' — the access token has expired and no refresh token is stored; reconnect Xero'
    return [p1]
  }
  const tenants = (Array.isArray(conRes.json) ? conRes.json : []) as Array<{ tenantId?: string; tenantName?: string }>
  const tenant = tenants.find((t) => t.tenantId === input.tenantId)
  if (!tenant) {
    return [mk('xero', 'xero.connection', ctx, 'error', 'The configured Xero tenant is not among this token\'s connections (organisation disconnected?)', { tenantCount: tenants.length })]
  }
  const out = [mk('xero', 'xero.connection', ctx, 'info', `Connected to Xero tenant ${tenant.tenantName ?? input.tenantId}`, { durationMs: conRes.durationMs })]

  const orgRes = await getJson(fetchImpl, 'https://api.xero.com/api.xro/2.0/Organisation', { ...auth, 'xero-tenant-id': input.tenantId }, timeoutMs)
  const p2 = httpProblem('xero', 'xero.organisation', ctx, 'Xero organisation', orgRes)
  if (p2) out.push(p2)
  else {
    const org = ((orgRes.json as { Organisations?: Array<{ Name?: string; OrganisationStatus?: string }> })?.Organisations ?? [])[0]
    if (!org) out.push(mk('xero', 'xero.organisation', ctx, 'error', 'Xero returned no organisation for the tenant'))
    else if (org.OrganisationStatus && org.OrganisationStatus !== 'ACTIVE') out.push(mk('xero', 'xero.organisation', ctx, 'error', `Xero organisation status is ${org.OrganisationStatus}`, { name: org.Name }))
    else out.push(mk('xero', 'xero.organisation', ctx, 'info', `Xero organisation "${org.Name ?? '?'}" reachable`, { name: org.Name ?? null }))
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Internal (our own trace)
// ---------------------------------------------------------------------------------------------

export interface InternalStats {
  errors24h: number
  /** Invoices emailed >24h ago (last 14 days) with no email.delivered since. */
  undelivered: Array<{ invoiceId: string; number: string | null; sentAt: Date }>
  /** Payments recorded >1h ago (last 14 days) with no xero.payment_synced. Null when Xero isn't set to copy payments. */
  unsyncedPayments: Array<{ invoiceId: string | null; paymentId: string | null; number: string | null }> | null
}

export function internalChecks(s: InternalStats, now: Date = new Date()): CheckResult[] {
  const ctx: Ctx = { entityId: null, entity: null }
  const out: CheckResult[] = []
  out.push(
    s.errors24h === 0
      ? mk('internal', 'internal.errors_24h', ctx, 'info', 'No billing-chain errors in the last 24h')
      : mk('internal', 'internal.errors_24h', ctx, s.errors24h >= 10 ? 'error' : 'warn', `${s.errors24h} billing-chain error event${s.errors24h === 1 ? '' : 's'} in the last 24h`, { count: s.errors24h }),
  )
  if (!s.undelivered.length) out.push(mk('internal', 'internal.undelivered', ctx, 'info', 'Every invoice emailed more than 24h ago has a delivery confirmation'))
  else {
    const oldest = Math.max(...s.undelivered.map((u) => now.getTime() - u.sentAt.getTime()))
    out.push(
      mk('internal', 'internal.undelivered', ctx, oldest > 72 * 3_600_000 ? 'error' : 'warn',
        `${s.undelivered.length} invoice email${s.undelivered.length === 1 ? '' : 's'} sent over 24h ago with no delivery confirmation`,
        { invoices: s.undelivered.slice(0, 20).map((u) => ({ invoiceId: u.invoiceId, number: u.number, sentAt: u.sentAt.toISOString() })) }),
    )
  }
  if (s.unsyncedPayments === null) out.push(mk('internal', 'internal.xero_payments', ctx, 'info', 'Xero payment copy is off; nothing to reconcile'))
  else if (!s.unsyncedPayments.length) out.push(mk('internal', 'internal.xero_payments', ctx, 'info', 'Every recorded payment reached Xero'))
  else out.push(
    mk('internal', 'internal.xero_payments', ctx, 'error', `${s.unsyncedPayments.length} recorded payment${s.unsyncedPayments.length === 1 ? '' : 's'} not copied to Xero`, { payments: s.unsyncedPayments.slice(0, 20) }),
  )
  return out
}

// ---------------------------------------------------------------------------------------------
// Alerting
// ---------------------------------------------------------------------------------------------

export const ALERT_WINDOW_MS = 24 * 3_600_000

/** The error results that should alert now: at most once per 24h per check key. */
export function alertsDue(results: CheckResult[], lastAlertAt: Map<string, Date>, now: Date = new Date()): CheckResult[] {
  return results.filter((r) => {
    if (r.level !== 'error') return false
    const last = lastAlertAt.get(checkKey(r))
    return !last || now.getTime() - last.getTime() >= ALERT_WINDOW_MS
  })
}

export function summarizeResults(results: CheckResult[]): { total: number; ok: number; warn: number; error: number } {
  return {
    total: results.length,
    ok: results.filter((r) => r.level === 'info').length,
    warn: results.filter((r) => r.level === 'warn').length,
    error: results.filter((r) => r.level === 'error').length,
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

export function alertEmail(accountName: string, due: CheckResult[], logUrl: string): { subject: string; html: string } {
  const items = due.map((r) => `<li><strong>${esc(r.check)}</strong>${r.entity ? ` (${esc(r.entity)})` : ''}: ${esc(r.message)}</li>`).join('')
  return {
    subject: `Track2 billing check failed: ${due.length} problem${due.length === 1 ? '' : 's'}${accountName ? ` (${accountName})` : ''}`,
    html: `<p>The billing-chain health check found ${due.length} problem${due.length === 1 ? '' : 's'}:</p><ul>${items}</ul><p>Details and history: <a href="${esc(logUrl)}">${esc(logUrl)}</a></p><p>You will get this email at most once a day per problem while it persists.</p>`,
  }
}
