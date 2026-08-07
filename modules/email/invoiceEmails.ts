import 'server-only'
import { prisma } from '@/lib/prisma'
import { formatCents, formatDate } from '@/lib/format'
import { sendEmail } from '@/modules/email/send'
import { renderPaymentReceiptEmail, renderOverdueReminderEmail } from '@/modules/email/templates'
import { getMessageTemplate, fillTemplate } from '@/lib/messageTemplates'

type InvoiceForEmail = {
  id: string
  accountId: string
  entityId: string | null
  number: string | null
  currency: string
  totalCents: number
  paidCents: number
  dueDate: Date | null
  publicToken: string | null
  account: { name: string }
  entity: { name: string } | null
  client: { name: string; contacts: { email: string | null; isInvoiceRecipient: boolean }[] }
}

async function load(accountId: string, invoiceId: string): Promise<InvoiceForEmail | null> {
  return prisma.invoice.findFirst({
    where: { id: invoiceId, accountId },
    select: {
      id: true, accountId: true, entityId: true, number: true, currency: true, totalCents: true, paidCents: true,
      dueDate: true, publicToken: true,
      account: { select: { name: true } },
      entity: { select: { name: true } },
      client: { select: { name: true, contacts: { select: { email: true, isInvoiceRecipient: true } } } },
    },
  })
}

function recipientOf(inv: InvoiceForEmail): string | null {
  return inv.client.contacts.find((c) => c.isInvoiceRecipient && c.email)?.email ?? inv.client.contacts.find((c) => c.email)?.email ?? null
}

/** Email a payment receipt to the client. Returns a summary line for the activity log. */
export async function sendReceipt(accountId: string, invoiceId: string, amountCents: number, method: string, paidOn: Date): Promise<string> {
  const inv = await load(accountId, invoiceId)
  if (!inv) return 'Receipt not sent — invoice not found'
  const to = recipientOf(inv)
  if (!to) return 'Receipt not sent — no recipient contact'
  const fromName = inv.entity?.name ?? inv.account.name
  const tpl = await getMessageTemplate(accountId, 'thank_you')
  const vars = { client: inv.client.name, number: inv.number ?? '', from: fromName, amount: formatCents(amountCents, inv.currency), method: method.replace('_', ' ') }
  const { subject, html } = renderPaymentReceiptEmail({
    fromName,
    clientName: inv.client.name,
    invoiceNumber: inv.number ?? '',
    amountPaid: formatCents(amountCents, inv.currency),
    paidDate: formatDate(paidOn),
    method: method.replace('_', ' '),
    msg: { subject: fillTemplate(tpl.subject, vars), intro: fillTemplate(tpl.body, vars) },
  })
  const r = await sendEmail(accountId, { to, subject, html, entityId: inv.entityId })
  return r.ok ? `Receipt emailed to ${to}` : r.skipped ? `Receipt not sent — ${r.message}` : `Receipt email failed — ${r.message}`
}

/** Email an overdue reminder for an open, past-due invoice. Returns a summary line. */
export async function sendReminder(accountId: string, invoiceId: string, baseUrl: string, now: Date = new Date()): Promise<string> {
  const inv = await load(accountId, invoiceId)
  if (!inv || !inv.publicToken) return 'Reminder not sent — not a sent invoice'
  const to = recipientOf(inv)
  if (!to) return 'Reminder not sent — no recipient contact'
  const due = inv.totalCents - inv.paidCents
  const daysOverdue = inv.dueDate ? Math.max(0, Math.round((now.getTime() - inv.dueDate.getTime()) / 86_400_000)) : 0
  const link = `${baseUrl}/i/${inv.publicToken}`
  const fromName = inv.entity?.name ?? inv.account.name
  const tpl = await getMessageTemplate(accountId, 'reminder')
  const vars = { client: inv.client.name, number: inv.number ?? '', from: fromName, amount: formatCents(due, inv.currency), due: formatDate(inv.dueDate), days: String(daysOverdue) }
  const { subject, html } = renderOverdueReminderEmail({
    fromName,
    clientName: inv.client.name,
    invoiceNumber: inv.number ?? '',
    amountDue: formatCents(due, inv.currency),
    dueDate: formatDate(inv.dueDate),
    daysOverdue,
    payUrl: due > 0 ? link : null,
    invoiceUrl: link,
    msg: { subject: fillTemplate(tpl.subject, vars), intro: fillTemplate(tpl.body, vars) },
  })
  const r = await sendEmail(accountId, { to, subject, html, entityId: inv.entityId })
  return r.ok ? `Reminder emailed to ${to}` : r.skipped ? `Reminder not sent — ${r.message}` : `Reminder email failed — ${r.message}`
}
