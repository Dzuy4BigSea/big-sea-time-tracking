import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { getConnectionWithSecrets } from '@/lib/integrations'
import { resolveSender, canSendAs } from '@/modules/entities/resolveEntity'
import { recordInvoiceEvent } from '@/modules/observability/invoiceTrace'
import { buildSendGridPayload, normalizeRecipients, parseSendGridResponse, type TraceKind } from '@/modules/email/sendgrid'

const SENDGRID_API = 'https://api.sendgrid.com/v3/mail/send'
const SEND_TIMEOUT_MS = 15_000

export type SendResult = {
  ok: boolean
  skipped?: boolean
  message?: string
  /** SendGrid X-Message-Id when accepted. */
  messageId?: string | null
  httpStatus?: number | null
}

export interface SendTrace {
  invoiceId: string
  kind: TraceKind
  /** Pairs the outcome with its email.send_requested claim (sendGuard). Generated when absent. */
  sendId?: string
}

/**
 * Send one transactional email via the account's SendGrid connection (specs/15). The from-identity
 * is resolved per business entity (specs/16): the entity's sender fields win, then the SendGrid
 * connection's defaults, then the account's default Sender address (Invoices → Configure) for the
 * from-name and reply-to. No-ops (skipped) when SendGrid isn't connected or there's no from-address.
 *
 * With `trace`, the outcome is written to the invoice trace: `email.accepted` (externalId = SendGrid
 * X-Message-Id) or `email.rejected` (HTTP status + provider error), and custom_args carry
 * { invoiceId, accountId, traceKind } so webhook events correlate (app/api/email/events).
 */
export async function sendEmail(
  accountId: string,
  input: { to: string | string[]; subject: string; html: string; text: string; entityId?: string | null; trace?: SendTrace },
): Promise<SendResult> {
  const trace = input.trace ? { ...input.trace, sendId: input.trace.sendId ?? randomUUID() } : null
  const t0 = Date.now()
  const result = await deliver(accountId, input)
  if (trace) {
    const durationMs = Date.now() - t0
    const base = { accountId, invoiceId: trace.invoiceId, source: 'app' as const, durationMs }
    const detail = { sendId: trace.sendId, traceKind: trace.kind, skipped: !!result.skipped }
    await recordInvoiceEvent(
      result.ok
        ? { ...base, stage: 'email.accepted', level: 'info', message: `SendGrid accepted the ${trace.kind} email`, externalId: result.messageId ?? null, httpStatus: result.httpStatus ?? null, detail }
        : {
            ...base,
            stage: 'email.rejected',
            level: result.skipped ? 'warn' : 'error',
            message: `${trace.kind} email not sent: ${result.message ?? 'unknown error'}`,
            httpStatus: result.httpStatus ?? null,
            detail: { ...detail, error: result.message ?? null },
          },
    )
  }
  return result
}

async function deliver(
  accountId: string,
  input: { to: string | string[]; subject: string; html: string; text: string; entityId?: string | null; trace?: SendTrace },
): Promise<SendResult> {
  const conn = await getConnectionWithSecrets(accountId, 'sendgrid')
  const apiKey = conn?.secrets.apiKey
  if (!conn || conn.status !== 'connected' || !apiKey) return { ok: false, skipped: true, message: 'SendGrid not connected' }
  const to = normalizeRecipients(Array.isArray(input.to) ? input.to : [input.to])
  if (to.length === 0) return { ok: false, skipped: true, message: 'No recipient' }

  const [entity, defaultSender] = await Promise.all([
    input.entityId
      ? prisma.businessEntity.findFirst({ where: { id: input.entityId, accountId }, select: { senderName: true, senderEmail: true, replyToEmail: true } })
      : null,
    prisma.senderAddress.findFirst({ where: { accountId, isDefault: true }, select: { name: true, email: true } }),
  ])
  const from = resolveSender(entity, {
    senderName: String(conn.config.fromName ?? '') || defaultSender?.name || null,
    senderEmail: String(conn.config.fromEmail ?? '') || null,
    replyToEmail: String(conn.config.replyTo ?? '') || defaultSender?.email || null,
  })
  if (!canSendAs(from)) return { ok: false, skipped: true, message: 'No verified from-address configured' }

  const payload = buildSendGridPayload({
    to,
    from: { email: from.senderEmail!, name: from.senderName },
    replyTo: from.replyToEmail,
    subject: input.subject,
    html: input.html,
    text: input.text,
    customArgs: input.trace ? { invoiceId: input.trace.invoiceId, accountId, traceKind: input.trace.kind } : undefined,
    categories: input.trace ? ['track2', `invoice-${input.trace.kind}`] : ['track2'],
  })
  try {
    const res = await fetch(SENDGRID_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
    const out = parseSendGridResponse(res.status, res.headers, res.ok ? '' : await res.text().catch(() => ''))
    if (out.ok) return { ok: true, messageId: out.messageId, httpStatus: out.httpStatus }
    return { ok: false, message: `SendGrid ${out.httpStatus}: ${out.error}`, httpStatus: out.httpStatus }
  } catch (e) {
    // Network error or timeout. A timeout is ambiguous (SendGrid may still have accepted it); the
    // trace says so and Resend is allowed, since a missing invoice is worse than a duplicate.
    const timedOut = (e as Error)?.name === 'TimeoutError'
    return { ok: false, message: timedOut ? 'SendGrid did not answer in time (it may still deliver)' : ((e as Error).message ?? 'network error').slice(0, 200) }
  }
}
