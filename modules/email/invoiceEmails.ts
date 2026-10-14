import 'server-only'
import { prisma } from '@/lib/prisma'
import { formatCents, formatDate } from '@/lib/format'
import { writeAudit } from '@/lib/audit'
import { sendEmail } from '@/modules/email/send'
import { renderInvoiceSentEmail, renderPaymentReceiptEmail, renderOverdueReminderEmail, DEFAULT_EMAIL_THEME, type RenderedEmail } from '@/modules/email/templates'
import { getMessageTemplate, fillTemplate, DEFAULT_MESSAGES } from '@/lib/messageTemplates'
import { resolveEmailTheme } from '@/modules/entities/resolveEntity'
import { daysPastDue } from '@/modules/invoicing/invoiceState'
import { todayIn } from '@/lib/tz'
import { invoiceRecipients, recipientSummary, reminderMessage } from '@/modules/email/compose'
import { claimInvoiceEmail } from '@/modules/email/sendGuard'
import { publicLinkProblem, type TraceKind } from '@/modules/email/sendgrid'
import { recordInvoiceEvent } from '@/modules/observability/invoiceTrace'

async function load(accountId: string, invoiceId: string) {
  return prisma.invoice.findFirst({
    where: { id: invoiceId, accountId },
    select: {
      id: true, accountId: true, entityId: true, number: true, status: true, currency: true, totalCents: true, paidCents: true,
      issueDate: true, dueDate: true, publicToken: true,
      account: { select: { name: true, timezone: true } },
      entity: { select: { name: true, emailBrandColor: true, emailAccentColor: true, brandColor: true, accentColor: true } },
      client: { select: { name: true, contacts: { select: { email: true, isInvoiceRecipient: true }, orderBy: { id: 'asc' } } } },
    },
  })
}
type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>

export interface ClientEmailResult {
  ok: boolean
  /** A matching email went out moments ago; nothing was sent (double click). */
  duplicate?: boolean
  /** Activity-log line. */
  summary: string
  /** User-facing problem when not emailed, else null. */
  problem: string | null
}

/** Trace a refusal that happened before the provider was called (no recipient, bad APP_URL…). */
async function traceNotSent(inv: { accountId: string; id: string }, kind: TraceKind, reason: string) {
  await recordInvoiceEvent({
    accountId: inv.accountId,
    invoiceId: inv.id,
    stage: 'email.rejected',
    source: 'app',
    level: 'warn',
    message: `${kind} email not sent: ${reason}`,
    detail: { traceKind: kind, skipped: true, error: reason },
  })
}

/**
 * Guarded send of one client email: recipients → link check → double-send claim → SendGrid →
 * trace (email.send_requested, then email.accepted | email.rejected).
 */
async function dispatch(
  inv: Loaded,
  kind: TraceKind,
  baseUrl: string | null,
  render: () => RenderedEmail,
  actorUserId: string | null,
): Promise<ClientEmailResult> {
  const label = kind === 'reminder' ? 'Reminder' : kind === 'receipt' ? 'Receipt' : 'Invoice'
  const to = invoiceRecipients(inv.client.contacts)
  if (to.length === 0) {
    await traceNotSent(inv, kind, 'no invoice-recipient contact with an email address')
    return { ok: false, summary: `${label} not emailed — no invoice-recipient contact on file`, problem: 'no invoice-recipient contact with an email address on file' }
  }
  const linkProblem = baseUrl ? publicLinkProblem(baseUrl) : null
  if (linkProblem) {
    await traceNotSent(inv, kind, linkProblem)
    return { ok: false, summary: `${label} not emailed — ${linkProblem}`, problem: `${linkProblem} (set APP_URL in Vercel and redeploy)` }
  }
  const claim = await claimInvoiceEmail(prisma, { accountId: inv.accountId, invoiceId: inv.id, kind, recipients: to, actorUserId })
  if (!claim.ok) {
    return {
      ok: false,
      duplicate: true,
      summary: `${label} email not repeated — already sent ${claim.secondsAgo}s ago`,
      problem: `this email already went out ${claim.secondsAgo} seconds ago, so it was not sent twice`,
    }
  }
  const { subject, html, text } = render()
  const r = await sendEmail(inv.accountId, { to, subject, html, text, entityId: inv.entityId, trace: { invoiceId: inv.id, kind, sendId: claim.sendId } })
  const who = recipientSummary(to)
  if (r.ok) return { ok: true, summary: `${label} emailed to ${who}`, problem: null }
  return {
    ok: false,
    summary: r.skipped ? `${label} not emailed — ${r.message}` : `${label} email failed — ${r.message}`,
    problem: r.message ?? 'email failed',
  }
}

const fromNameOf = (inv: Loaded) => inv.entity?.name ?? inv.account.name

/**
 * Email a sent invoice to the client's invoice recipient(s) (specs/15/16): `invoice` on first send,
 * `resend` from "Resend invoice". Writes the activity-log line. The from-address is the invoice
 * entity's sender (Cordelia vs Big Sea), resolved inside sendEmail; the link is APP_URL-based.
 */
export async function emailInvoiceToClient(args: {
  accountId: string
  invoiceId: string
  actorUserId: string | null
  kind: 'invoice' | 'resend'
  baseUrl: string
}): Promise<ClientEmailResult> {
  const inv = await load(args.accountId, args.invoiceId)
  if (!inv || !inv.publicToken) return { ok: false, summary: 'Not emailed — invoice has no public link', problem: 'invoice has no public link' }
  const link = `${args.baseUrl}/i/${inv.publicToken}`
  const due = inv.totalCents - inv.paidCents
  const fromName = fromNameOf(inv)
  const tpl = await getMessageTemplate(args.accountId, 'invoice', inv.entityId)
  const theme = resolveEmailTheme(inv.entity, DEFAULT_EMAIL_THEME)
  const vars = { client: inv.client.name, number: inv.number ?? '', from: fromName, amount: formatCents(due, inv.currency), due: formatDate(inv.dueDate) }
  const res = await dispatch(inv, args.kind, args.baseUrl, () =>
    renderInvoiceSentEmail({
      fromName,
      clientName: inv.client.name,
      invoiceNumber: inv.number ?? '',
      amountDue: formatCents(due, inv.currency),
      issueDate: formatDate(inv.issueDate),
      dueDate: formatDate(inv.dueDate),
      payUrl: due > 0 && inv.status === 'open' ? link : null,
      invoiceUrl: link,
      msg: { subject: fillTemplate(tpl.subject, vars), intro: fillTemplate(tpl.body, vars) },
      theme,
    }),
    args.actorUserId,
  )
  await writeAudit({ accountId: args.accountId, actorUserId: args.actorUserId, entityType: 'invoice', entityId: args.invoiceId, action: 'update', summary: res.summary })
  return res
}

/** Email a payment receipt to the client. Returns a summary line for the activity log. */
export async function sendReceipt(accountId: string, invoiceId: string, amountCents: number, method: string, paidOn: Date): Promise<string> {
  const inv = await load(accountId, invoiceId)
  if (!inv) return 'Receipt not sent — invoice not found'
  const to = invoiceRecipients(inv.client.contacts)
  if (to.length === 0) return 'Receipt not sent — no recipient contact'
  const fromName = fromNameOf(inv)
  const tpl = await getMessageTemplate(accountId, 'thank_you', inv.entityId)
  const theme = resolveEmailTheme(inv.entity, DEFAULT_EMAIL_THEME)
  const vars = { client: inv.client.name, number: inv.number ?? '', from: fromName, amount: formatCents(amountCents, inv.currency), method: method.replace('_', ' ') }
  const { subject, html, text } = renderPaymentReceiptEmail({
    fromName,
    clientName: inv.client.name,
    invoiceNumber: inv.number ?? '',
    amountPaid: formatCents(amountCents, inv.currency),
    paidDate: formatDate(paidOn),
    method: method.replace('_', ' '),
    msg: { subject: fillTemplate(tpl.subject, vars), intro: fillTemplate(tpl.body, vars) },
    theme,
  })
  // Receipts are not de-duplicated: two payments recorded a minute apart each deserve a receipt.
  const r = await sendEmail(accountId, { to, subject, html, text, entityId: inv.entityId, trace: { invoiceId, kind: 'receipt' } })
  const who = recipientSummary(to)
  return r.ok ? `Receipt emailed to ${who}` : r.skipped ? `Receipt not sent — ${r.message}` : `Receipt email failed — ${r.message}`
}

/**
 * Email a payment reminder for an open invoice with a balance (spec 15 E3; Harvest also allows it
 * before the due date). Never for drafts, paid, closed or written-off invoices (AC-EMAIL-002).
 */
export async function sendReminder(
  accountId: string,
  invoiceId: string,
  baseUrl: string,
  now: Date = new Date(),
  actorUserId: string | null = null,
): Promise<ClientEmailResult> {
  const inv = await load(accountId, invoiceId)
  if (!inv || !inv.publicToken) return { ok: false, summary: 'Reminder not sent — not a sent invoice', problem: 'not a sent invoice' }
  const due = inv.totalCents - inv.paidCents
  if (inv.status !== 'open' || due <= 0) {
    return { ok: false, summary: 'Reminder not sent — invoice has no balance due', problem: 'only open invoices with a balance due get reminders' }
  }
  // Calendar days past due on the account's day (specs/27 AC-STAT-001), not elapsed UTC time.
  const daysOverdue = daysPastDue(inv.dueDate, todayIn(inv.account.timezone, now))
  const link = `${baseUrl}/i/${inv.publicToken}`
  const fromName = fromNameOf(inv)
  const tpl = await getMessageTemplate(accountId, 'reminder', inv.entityId)
  const theme = resolveEmailTheme(inv.entity, DEFAULT_EMAIL_THEME)
  const vars = { client: inv.client.name, number: inv.number ?? '', from: fromName, amount: formatCents(due, inv.currency), due: formatDate(inv.dueDate), days: String(daysOverdue) }
  const msg = reminderMessage(tpl, DEFAULT_MESSAGES.reminder, daysOverdue > 0)
  return dispatch(inv, 'reminder', baseUrl, () =>
    renderOverdueReminderEmail({
      fromName,
      clientName: inv.client.name,
      invoiceNumber: inv.number ?? '',
      amountDue: formatCents(due, inv.currency),
      dueDate: formatDate(inv.dueDate),
      daysOverdue,
      payUrl: link,
      invoiceUrl: link,
      msg: { subject: msg.subject && fillTemplate(msg.subject, vars), intro: msg.intro && fillTemplate(msg.intro, vars) },
      theme,
    }),
    actorUserId,
  )
}
