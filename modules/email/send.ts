import 'server-only'
import { prisma } from '@/lib/prisma'
import { getConnectionWithSecrets } from '@/lib/integrations'
import { resolveSender, canSendAs } from '@/modules/entities/resolveEntity'

const SENDGRID_API = 'https://api.sendgrid.com/v3/mail/send'

export type SendResult = { ok: boolean; skipped?: boolean; message?: string }

/**
 * Send one transactional email via the account's SendGrid connection (specs/15). The from-identity
 * is resolved per business entity (specs/16): the entity's sender fields win, falling back to the
 * SendGrid connection's account defaults. No-ops (skipped) when SendGrid isn't connected or there's
 * no from-address, so callers can always call it best-effort.
 */
export async function sendEmail(
  accountId: string,
  input: { to: string; subject: string; html: string; entityId?: string | null },
): Promise<SendResult> {
  const conn = await getConnectionWithSecrets(accountId, 'sendgrid')
  const apiKey = conn?.secrets.apiKey
  if (!conn || conn.status !== 'connected' || !apiKey) return { ok: false, skipped: true, message: 'SendGrid not connected' }
  if (!input.to) return { ok: false, skipped: true, message: 'No recipient' }

  const entity = input.entityId
    ? await prisma.businessEntity.findFirst({ where: { id: input.entityId, accountId }, select: { senderName: true, senderEmail: true, replyToEmail: true } })
    : null
  const from = resolveSender(entity, {
    senderName: String(conn.config.fromName ?? '') || null,
    senderEmail: String(conn.config.fromEmail ?? '') || null,
    replyToEmail: String(conn.config.replyTo ?? '') || null,
  })
  if (!canSendAs(from)) return { ok: false, skipped: true, message: 'No verified from-address configured' }

  try {
    const res = await fetch(SENDGRID_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: input.to }] }],
        from: { email: from.senderEmail, name: from.senderName ?? undefined },
        ...(from.replyToEmail ? { reply_to: { email: from.replyToEmail } } : {}),
        subject: input.subject,
        content: [{ type: 'text/html', value: input.html }],
      }),
    })
    if (res.status >= 200 && res.status < 300) return { ok: true }
    return { ok: false, message: `SendGrid ${res.status}: ${(await res.text()).slice(0, 200)}` }
  } catch (e) {
    return { ok: false, message: (e as Error).message?.slice(0, 200) }
  }
}
