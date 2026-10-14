/**
 * SendGrid Event Webhook: signature verification + event → invoice-trace mapping (pure, unit-tested).
 *
 * Signed Event Webhook: SendGrid signs `timestamp + rawBody` with ECDSA P-256 / SHA-256. The public
 * key (SendGrid → Settings → Mail Settings → Event Webhook → Signature verification) is a base64
 * DER SubjectPublicKeyInfo; the signature header is a base64 DER ECDSA signature.
 */
import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import type { InvoiceTraceEvent, TraceLevel } from '@/modules/observability/invoiceTrace'
import { baseMessageId } from '@/modules/email/sendgrid'

export const SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature'
export const TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp'
export const REPLAY_WINDOW_SECONDS = 600

/** Accepts the dashboard's bare base64 key or a PEM block. Null when it can't be parsed. */
export function parsePublicKey(raw: string | undefined | null): KeyObject | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  try {
    if (s.includes('BEGIN PUBLIC KEY')) return createPublicKey(s)
    return createPublicKey({ key: Buffer.from(s.replace(/\s+/g, ''), 'base64'), format: 'der', type: 'spki' })
  } catch {
    return null
  }
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'missing_signature' | 'stale_timestamp' | 'bad_signature' }

export function verifySendGridSignature(args: {
  publicKey: KeyObject
  rawBody: string
  signature: string | null
  timestamp: string | null
  nowSeconds?: number
}): VerifyResult {
  const { signature, timestamp } = args
  if (!signature || !timestamp) return { ok: false, reason: 'missing_signature' }
  const ts = Number(timestamp)
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (!/^\d+$/.test(timestamp) || !Number.isFinite(ts) || Math.abs(now - ts) > REPLAY_WINDOW_SECONDS) return { ok: false, reason: 'stale_timestamp' }
  try {
    const ok = verify('sha256', Buffer.from(timestamp + args.rawBody, 'utf8'), { key: args.publicKey, dsaEncoding: 'der' }, Buffer.from(signature, 'base64'))
    return ok ? { ok: true } : { ok: false, reason: 'bad_signature' }
  } catch {
    return { ok: false, reason: 'bad_signature' }
  }
}

/** One SendGrid event. custom_args are flattened onto the event object by SendGrid. */
export interface SendGridEvent {
  event?: string
  email?: string
  timestamp?: number
  sg_event_id?: string
  sg_message_id?: string
  reason?: string
  status?: string
  response?: string
  type?: string
  attempt?: string | number
  url?: string
  useragent?: string
  bounce_classification?: string
  invoiceId?: unknown
  accountId?: unknown
  traceKind?: unknown
  [k: string]: unknown
}

const STAGE: Record<string, { stage: string; level: TraceLevel; label: string }> = {
  processed: { stage: 'email.processed', level: 'info', label: 'SendGrid processed the email' },
  delivered: { stage: 'email.delivered', level: 'info', label: 'Delivered to the recipient’s mail server' },
  deferred: { stage: 'email.deferred', level: 'info', label: 'Delivery deferred (receiving server asked to retry)' },
  bounce: { stage: 'email.bounced', level: 'error', label: 'Bounced' },
  dropped: { stage: 'email.dropped', level: 'error', label: 'Dropped by SendGrid (not sent)' },
  spamreport: { stage: 'email.spam_report', level: 'error', label: 'Recipient marked the email as spam' },
  unsubscribe: { stage: 'email.unsubscribed', level: 'warn', label: 'Recipient unsubscribed' },
  group_unsubscribe: { stage: 'email.unsubscribed', level: 'warn', label: 'Recipient unsubscribed (group)' },
  open: { stage: 'email.opened', level: 'info', label: 'Email opened' },
  click: { stage: 'email.clicked', level: 'info', label: 'Link clicked' },
}

/** Coarse user-agent family for opens/clicks/views: never the raw string, never an IP. */
export function userAgentFamily(ua: string | null | undefined): string {
  const s = ua ?? ''
  if (!s) return 'unknown'
  const device = /iphone|ipad|android|mobile/i.test(s) ? 'mobile' : 'desktop'
  let browser = 'other'
  if (/GoogleImageProxy|ggpht\.com/i.test(s)) return 'Gmail image proxy'
  if (/YahooMailProxy/i.test(s)) return 'Yahoo image proxy'
  if (/Microsoft Outlook|ms-office|Outlook-iOS|Outlook-Android/i.test(s)) browser = 'Outlook'
  else if (/Edg\//.test(s)) browser = 'Edge'
  else if (/Firefox\//.test(s)) browser = 'Firefox'
  else if (/Chrome\/|CriOS\//.test(s)) browser = 'Chrome'
  else if (/Safari\//.test(s)) browser = 'Safari'
  else if (/AppleWebKit/.test(s)) browser = 'Apple Mail'
  return `${browser} (${device})`
}

const QUIET = new Set(['processed', 'delivered', 'open', 'click'])
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * Map one SendGrid event to an invoice trace event. Null (ignored) for event types we don't track
 * or events without our custom_args (mail not sent by an invoice flow, e.g. team invites).
 */
export function mapSendGridEvent(e: SendGridEvent): InvoiceTraceEvent | null {
  const invoiceId = str(e.invoiceId)
  const accountId = str(e.accountId)
  if (!invoiceId || !accountId) return null
  const m = STAGE[String(e.event ?? '')]
  if (!m) return null
  const attempt = Number(e.attempt ?? 0) || 0
  const level: TraceLevel = e.event === 'deferred' && attempt > 3 ? 'warn' : m.level
  const why = [e.type === 'blocked' ? 'blocked' : null, e.reason, e.response].map(str).filter(Boolean)[0]
  const detail: Record<string, unknown> = {
    event: e.event,
    email: e.email ?? null,
    traceKind: str(e.traceKind),
    sgMessageId: e.sg_message_id ?? null,
  }
  if (e.reason) detail.reason = e.reason
  if (e.response) detail.response = e.response
  if (e.status) detail.smtpStatus = e.status
  if (e.type) detail.bounceType = e.type
  if (e.bounce_classification) detail.bounceClassification = e.bounce_classification
  if (attempt) detail.attempt = attempt
  if (e.event === 'click' && e.url) detail.url = e.url
  if (e.event === 'open' || e.event === 'click') detail.userAgent = userAgentFamily(e.useragent)
  const ts = Number(e.timestamp)
  return {
    accountId,
    invoiceId,
    stage: m.stage,
    source: 'email',
    level,
    message: `${m.label}${e.email ? ` (${e.email})` : ''}${why && !QUIET.has(String(e.event)) ? `: ${why}` : ''}${e.event === 'deferred' && attempt ? ` — attempt ${attempt}` : ''}`,
    externalId: baseMessageId(e.sg_message_id),
    externalEventId: str(e.sg_event_id),
    detail,
    occurredAt: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : undefined,
  }
}

export interface WebhookDeps {
  /** True when the invoice exists in that account (INV-5: custom_args must agree with the DB). */
  invoiceInAccount(invoiceId: string, accountId: string): Promise<boolean>
  record(e: InvoiceTraceEvent): Promise<'recorded' | 'duplicate' | 'failed'>
}

export interface WebhookResponse {
  status: number
  body: Record<string, unknown>
}

/**
 * The whole webhook request, minus HTTP plumbing: 503 when no public key is configured (do nothing),
 * 401 for unsigned / invalid / stale requests, 400 for a malformed body, else 200 with counts.
 */
export async function handleSendGridWebhook(
  req: { rawBody: string; signature: string | null; timestamp: string | null },
  publicKeyRaw: string | undefined,
  deps: WebhookDeps,
  nowSeconds?: number,
): Promise<WebhookResponse> {
  if (!(publicKeyRaw ?? '').trim()) return { status: 503, body: { error: 'SENDGRID_WEBHOOK_PUBLIC_KEY is not configured' } }
  const key = parsePublicKey(publicKeyRaw)
  if (!key) return { status: 503, body: { error: 'SENDGRID_WEBHOOK_PUBLIC_KEY could not be parsed' } }
  const v = verifySendGridSignature({ publicKey: key, rawBody: req.rawBody, signature: req.signature, timestamp: req.timestamp, nowSeconds })
  if (!v.ok) return { status: 401, body: { error: v.reason } }

  let events: unknown
  try {
    events = JSON.parse(req.rawBody)
  } catch {
    return { status: 400, body: { error: 'invalid JSON' } }
  }
  if (!Array.isArray(events)) return { status: 400, body: { error: 'expected an array of events' } }

  const counts = { recorded: 0, duplicate: 0, ignored: 0, failed: 0 }
  const known = new Map<string, boolean>()
  for (const raw of events.slice(0, 5000)) {
    const mapped = raw && typeof raw === 'object' ? mapSendGridEvent(raw as SendGridEvent) : null
    if (!mapped) {
      counts.ignored++
      continue
    }
    const k = `${mapped.accountId}:${mapped.invoiceId}`
    if (!known.has(k)) known.set(k, await deps.invoiceInAccount(mapped.invoiceId!, mapped.accountId))
    if (!known.get(k)) {
      counts.ignored++
      continue
    }
    counts[await deps.record(mapped)]++
  }
  // 200 even when a row failed to store: SendGrid retries non-2xx batches for up to 72h (the
  // de-dup absorbs those), but a persistent DB error must not wedge the queue. Failures are logged.
  return { status: 200, body: counts }
}
