/**
 * Pure derivation of the "Delivery & payment trail" summary chips from an invoice's trace events
 * (OPS.md "Billing chain: trace, checks, tests"). No I/O: the page loads the events and passes them in.
 *
 * Each chip answers one question about the chain, based on the most recent relevant event:
 *   Email      Delivered / Bounced / Spam report / Not yet delivered / Not sent
 *   Opened     Yes (first open) / No
 *   Stripe     Paid / Refunded / Disputed / Failed / Checkout started / No
 *   Xero       Synced / Error / Not synced
 */

export interface TraceEventLike {
  stage: string
  source: string
  level: string
  occurredAt: Date
  message?: string | null
}

export type ChipTone = 'ok' | 'warn' | 'error' | 'neutral'

export interface SummaryChip {
  key: 'email' | 'opened' | 'stripe' | 'xero'
  label: string
  value: string
  tone: ChipTone
  at: Date | null
}

const byTimeAsc = (a: TraceEventLike, b: TraceEventLike) => a.occurredAt.getTime() - b.occurredAt.getTime()

function latest(events: TraceEventLike[], pred: (e: TraceEventLike) => boolean): TraceEventLike | null {
  let out: TraceEventLike | null = null
  for (const e of events) if (pred(e) && (!out || e.occurredAt.getTime() >= out.occurredAt.getTime())) out = e
  return out
}

function earliest(events: TraceEventLike[], pred: (e: TraceEventLike) => boolean): TraceEventLike | null {
  const hits = events.filter(pred).sort(byTimeAsc)
  return hits[0] ?? null
}

const EMAIL_OUTCOMES = new Set(['email.delivered', 'email.bounced', 'email.dropped', 'email.spam_report'])

export function emailChip(events: TraceEventLike[]): SummaryChip {
  const base = { key: 'email' as const, label: 'Email' }
  // A spam report is sticky: it means the client's mailbox flagged us, whatever happened after.
  const spam = latest(events, (e) => e.stage === 'email.spam_report')
  if (spam) return { ...base, value: 'Spam report', tone: 'error', at: spam.occurredAt }
  const outcome = latest(events, (e) => EMAIL_OUTCOMES.has(e.stage))
  if (outcome?.stage === 'email.delivered') return { ...base, value: 'Delivered', tone: 'ok', at: outcome.occurredAt }
  if (outcome) return { ...base, value: outcome.stage === 'email.dropped' ? 'Bounced (dropped)' : 'Bounced', tone: 'error', at: outcome.occurredAt }
  const sendFailed = latest(events, (e) => (e.stage === 'email.failed' || e.stage === 'email.send_failed') || (e.stage.startsWith('email.') && e.level === 'error'))
  if (sendFailed) return { ...base, value: 'Send failed', tone: 'error', at: sendFailed.occurredAt }
  const sent = latest(events, (e) => e.stage === 'invoice.sent' || e.stage === 'email.accepted' || e.stage === 'email.sent')
  if (sent) return { ...base, value: 'Not yet delivered', tone: 'warn', at: sent.occurredAt }
  return { ...base, value: 'Not sent', tone: 'neutral', at: null }
}

export function openedChip(events: TraceEventLike[]): SummaryChip {
  const first = earliest(events, (e) => e.stage === 'email.opened' || e.stage === 'invoice.viewed')
  return first
    ? { key: 'opened', label: 'Opened by client', value: 'Yes', tone: 'ok', at: first.occurredAt }
    : { key: 'opened', label: 'Opened by client', value: 'No', tone: 'neutral', at: null }
}

export function stripeChip(events: TraceEventLike[]): SummaryChip {
  const base = { key: 'stripe' as const, label: 'Paid via Stripe' }
  const pay = events.filter((e) => e.stage.startsWith('payment.') && (e.source === 'stripe' || e.stage === 'payment.checkout_started'))
  const dispute = latest(pay, (e) => e.stage === 'payment.disputed' || e.stage === 'payment.dispute_created')
  if (dispute) return { ...base, value: 'Disputed', tone: 'error', at: dispute.occurredAt }
  const refund = latest(pay, (e) => e.stage === 'payment.refunded')
  const paid = latest(pay, (e) => e.stage === 'payment.recorded')
  if (refund && (!paid || refund.occurredAt >= paid.occurredAt)) return { ...base, value: 'Refunded', tone: 'warn', at: refund.occurredAt }
  if (paid) return { ...base, value: 'Paid', tone: 'ok', at: paid.occurredAt }
  const failed = latest(pay, (e) => e.stage === 'payment.failed' || e.level === 'error')
  const started = latest(pay, (e) => e.stage === 'payment.checkout_started' || e.stage === 'payment.webhook_received' || e.stage === 'payment.processing')
  if (failed && (!started || failed.occurredAt >= started.occurredAt)) return { ...base, value: 'Failed', tone: 'error', at: failed.occurredAt }
  if (started) return { ...base, value: started.stage === 'payment.checkout_started' ? 'Checkout started' : 'Processing', tone: 'warn', at: started.occurredAt }
  return { ...base, value: 'No', tone: 'neutral', at: null }
}

export function xeroChip(events: TraceEventLike[]): SummaryChip {
  const base = { key: 'xero' as const, label: 'Xero' }
  const last = latest(events, (e) => e.stage.startsWith('xero.') && (e.stage.endsWith('_synced') || e.stage === 'xero.error' || e.level === 'error'))
  if (!last) return { ...base, value: 'Not synced', tone: 'neutral', at: null }
  if (last.stage === 'xero.error' || last.level === 'error') return { ...base, value: 'Error', tone: 'error', at: last.occurredAt }
  return { ...base, value: last.stage === 'xero.payment_synced' ? 'Synced (payment)' : 'Synced', tone: 'ok', at: last.occurredAt }
}

export function summarizeInvoiceTrace(events: TraceEventLike[]): SummaryChip[] {
  return [emailChip(events), openedChip(events), stripeChip(events), xeroChip(events)]
}

/** UI label for an event source. */
export const SOURCE_LABEL: Record<string, string> = {
  app: 'App',
  email: 'Email',
  client: 'Client',
  stripe: 'Stripe',
  xero: 'Xero',
  cron: 'Cron',
}

/** Middle-truncate an external id for display ("pi_3Pq…Xy9z"). */
export function truncateId(id: string, max = 18): string {
  if (id.length <= max) return id
  const keep = Math.max(2, Math.floor((max - 1) / 2))
  return `${id.slice(0, keep)}…${id.slice(-keep)}`
}
