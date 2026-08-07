import { prisma } from '@/lib/prisma'
import type { MessageKind } from '@prisma/client'

/**
 * Editable email messages (Harvest "Configure → Messages"). Each `MessageKind` has a subject
 * and an intro body; the send pipeline (modules/email) uses these when present and falls back
 * to these defaults otherwise. `{placeholders}` are substituted at send time.
 */
export interface MessageTemplate {
  subject: string
  body: string
}

export const MESSAGE_KINDS: { kind: MessageKind; label: string; description: string; placeholders: string[] }[] = [
  { kind: 'invoice', label: 'Invoice email', description: 'Sent when you send an invoice to a client.', placeholders: ['{client}', '{number}', '{from}', '{amount}', '{due}'] },
  { kind: 'reminder', label: 'Overdue reminder', description: 'Sent when a past-due invoice is nudged.', placeholders: ['{client}', '{number}', '{amount}', '{due}', '{days}'] },
  { kind: 'thank_you', label: 'Payment receipt', description: 'Sent when a payment is recorded.', placeholders: ['{client}', '{number}', '{amount}', '{method}'] },
]

export const DEFAULT_MESSAGES: Record<MessageKind, MessageTemplate> = {
  invoice: {
    subject: 'Invoice {number} from {from}',
    body: "Hi {client} — here's your invoice from {from}. The amount due is {amount}, due {due}.",
  },
  reminder: {
    subject: 'Reminder: invoice {number} is {days} days past due',
    body: 'Hi {client} — a friendly nudge that invoice {number} ({amount}) was due on {due}. If it\'s already in your payment run, thank you — please ignore.',
  },
  thank_you: {
    subject: 'Payment received — invoice {number}',
    body: 'Thanks, {client} — invoice {number} is settled. Nothing further needed.',
  },
}

export async function getMessageTemplate(accountId: string, kind: MessageKind): Promise<MessageTemplate> {
  const row = await prisma.invoiceMessageTemplate.findUnique({ where: { accountId_kind: { accountId, kind } } })
  if (!row) return DEFAULT_MESSAGES[kind]
  return { subject: row.subject || DEFAULT_MESSAGES[kind].subject, body: row.body || DEFAULT_MESSAGES[kind].body }
}

/** Substitute `{placeholder}` tokens. Unknown tokens are left as-is. */
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? vars[key] : m))
}
