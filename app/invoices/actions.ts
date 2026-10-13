'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { PaymentMethod } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordPayment, deletePayment } from '@/modules/invoicing/recordPayment'
import { generateInvoice, GenerateInvoiceError } from '@/modules/invoicing/generateInvoice'
import { transitionErrorMessage, InvalidTransitionError } from '@/modules/invoicing/invoiceState'
import { sendInvoice, markInvoiceDraft, deleteInvoice, writeOffInvoice } from '@/modules/invoicing/invoiceLifecycle'
import { Prisma } from '@prisma/client'
import { copyInvoiceToXero, copyPaymentToXero } from '@/modules/integrations/xeroSync'
import { parseYmd } from '@/lib/week'
import { requireUser, type CurrentUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { writeAudit } from '@/lib/audit'
import { formatCents, formatDate } from '@/lib/format'
import { resolveAppUrl } from '@/lib/appUrl'
import { sendEmail } from '@/modules/email/send'
import { renderInvoiceSentEmail, DEFAULT_EMAIL_THEME } from '@/modules/email/templates'
import { sendReceipt, sendReminder } from '@/modules/email/invoiceEmails'
import { getMessageTemplate, fillTemplate } from '@/lib/messageTemplates'
import { resolveEmailTheme } from '@/modules/entities/resolveEntity'

export type PaymentState = { error?: string; ok?: boolean }

const METHODS: PaymentMethod[] = ['cash', 'check', 'bank_transfer', 'card', 'other']

/** Tenant guard — the invoice must belong to the actor's account (INV-5). */
async function ownsInvoice(invoiceId: string, accountId: string): Promise<boolean> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { accountId: true } })
  return !!inv && inv.accountId === accountId
}

// Client-facing links in invoice emails come from configured APP_URL, never request headers.
function baseUrl(): string {
  return resolveAppUrl()
}

/**
 * Email a sent invoice to the client's invoice recipient via SendGrid (specs/15/16). Records the
 * outcome to the activity log and returns a user-facing problem string (null when emailed) so the
 * caller can surface a failure instead of silently succeeding. From-address is the
 * invoice entity's sender (Cordelia vs Big Sea), resolved inside sendEmail.
 */
async function emailInvoice(accountId: string, invoiceId: string, actorUserId: string): Promise<string | null> {
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId },
    include: {
      client: { include: { contacts: true } },
      account: { select: { name: true } },
      entity: { select: { name: true, emailBrandColor: true, emailAccentColor: true, brandColor: true, accentColor: true } },
    },
  })
  if (!inv || !inv.publicToken) return 'invoice has no public link'
  const recipient =
    inv.client.contacts.find((c) => c.isInvoiceRecipient && c.email)?.email ??
    inv.client.contacts.find((c) => c.email)?.email ??
    null
  if (!recipient) {
    await writeAudit({ accountId, actorUserId, entityType: 'invoice', entityId: invoiceId, action: 'update', summary: 'Not emailed — no invoice-recipient contact on file' })
    return 'no invoice-recipient contact with an email address on file'
  }
  const link = `${baseUrl()}/i/${inv.publicToken}`
  const due = inv.totalCents - inv.paidCents
  const fromName = inv.entity?.name ?? inv.account.name
  const tpl = await getMessageTemplate(accountId, 'invoice', inv.entityId)
  const theme = resolveEmailTheme(inv.entity, DEFAULT_EMAIL_THEME)
  const vars = { client: inv.client.name, number: inv.number ?? '', from: fromName, amount: formatCents(due, inv.currency), due: formatDate(inv.dueDate) }
  const { subject, html } = renderInvoiceSentEmail({
    fromName,
    clientName: inv.client.name,
    invoiceNumber: inv.number ?? '',
    amountDue: formatCents(due, inv.currency),
    issueDate: formatDate(inv.issueDate),
    dueDate: formatDate(inv.dueDate),
    payUrl: due > 0 ? link : null,
    invoiceUrl: link,
    msg: { subject: fillTemplate(tpl.subject, vars), intro: fillTemplate(tpl.body, vars) },
    theme,
  })
  const r = await sendEmail(accountId, { to: recipient, subject, html, entityId: inv.entityId })
  await writeAudit({
    accountId,
    actorUserId,
    entityType: 'invoice',
    entityId: invoiceId,
    action: 'update',
    summary: r.ok ? `Emailed to ${recipient}` : r.skipped ? `Email not sent — ${r.message}` : `Email failed — ${r.message}`,
  })
  return r.ok ? null : (r.message ?? 'email failed')
}

/**
 * Permission guard shared by every mutating invoice action: the actor must hold
 * `manage_invoices` (enforced server-side, not just hidden in the UI). Returns null when refused.
 */
async function requireInvoiceManager(): Promise<CurrentUser | null> {
  const actor = await requireUser()
  if (!can({ permissionProfile: actor.permissionProfile as PermissionProfile, permissionOverrides: actor.permissionOverrides }, 'manage_invoices')) return null
  return actor
}

const NOT_PERMITTED = 'You do not have permission to manage invoices.'

/** Redirect back to `path` with a user-visible error (?error=…). Throws NEXT_REDIRECT — call outside try/catch. */
function failTo(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message.slice(0, 300))}`)
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'

export async function recordPaymentAction(_prev: PaymentState, formData: FormData): Promise<PaymentState> {
  const actor = await requireInvoiceManager()
  if (!actor) return { error: NOT_PERMITTED }
  const { accountId, userId } = actor
  const invoiceId = String(formData.get('invoiceId') ?? '')
  const amountStr = String(formData.get('amount') ?? '').replace(/[$,\s]/g, '')
  const paidOn = parseYmd(String(formData.get('paidOn') ?? ''))
  const method = String(formData.get('method') ?? 'other') as PaymentMethod

  if (!invoiceId || !(await ownsInvoice(invoiceId, accountId))) return { error: 'Invoice not found.' }
  const amount = Number(amountStr)
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter a payment amount greater than 0.' }
  if (!paidOn) return { error: 'Pick a payment date.' }
  const amountCents = Math.round(amount * 100)
  const safeMethod = METHODS.includes(method) ? method : 'other'

  try {
    await recordPayment(prisma, { invoiceId, amountCents, paidOn, method: safeMethod })
  } catch (e) {
    const msg =
      e instanceof Error && /overpayment/i.test(e.message)
        ? 'Payment exceeds the amount due.'
        : 'Could not record payment (invoice may not be open).'
    return { error: msg }
  }

  await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'update', summary: `Payment recorded — ${formatCents(amountCents)} (${safeMethod.replace('_', ' ')})` })
  const receiptSummary = await sendReceipt(accountId, invoiceId, amountCents, safeMethod, paidOn).catch(() => null)
  if (receiptSummary) await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'update', summary: receiptSummary })
  await copyPaymentToXero(accountId, invoiceId).catch(() => {}) // best-effort accounting sync
  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/invoices')
  return { ok: true }
}

/** Remove a recorded payment and re-derive the invoice status (paid → open) — AC-INV-011. */
export async function deletePaymentAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceManager()
  if (!actor) return
  const { accountId, userId } = actor
  const paymentId = String(formData.get('paymentId') ?? '')
  if (!paymentId) return
  const owner = await prisma.payment.findFirst({ where: { id: paymentId, accountId }, select: { invoiceId: true } })
  if (!owner) return
  let removed: Awaited<ReturnType<typeof deletePayment>> = null
  let error: string | null = null
  try {
    removed = await deletePayment(prisma, accountId, paymentId)
  } catch (e) {
    error = transitionErrorMessage(e, 'Could not remove the payment.')
    if (e instanceof InvalidTransitionError) error = 'Payments on a written-off or closed invoice cannot be removed.'
  }
  if (error) failTo(`/invoices/${owner.invoiceId}`, error)
  if (removed) {
    await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: removed.invoiceId, action: 'update', summary: `Payment removed — ${formatCents(removed.amountCents)}` })
  }
  revalidatePath(`/invoices/${owner.invoiceId}`)
  revalidatePath('/invoices')
}

export async function generateInvoiceAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceManager()
  if (!actor) failTo('/invoices', NOT_PERMITTED)
  const { accountId, userId } = actor
  const clientId = String(formData.get('clientId') ?? '')
  if (!clientId) return
  // Guard: the client must belong to the actor's account.
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { accountId: true } })
  if (!client || client.accountId !== accountId) return
  let invoice: Awaited<ReturnType<typeof generateInvoice>> = null
  let error: string | null = null
  try {
    // Stamps the client's business entity inside the same transaction (specs/16).
    invoice = await generateInvoice(prisma, { accountId, clientId })
  } catch (e) {
    error = e instanceof GenerateInvoiceError ? e.message : 'Could not generate the invoice. Please try again.'
  }
  if (error) failTo('/invoices', error)
  if (invoice) await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoice.id, action: 'create', summary: 'Draft generated from tracked time' })
  revalidatePath('/invoices')
  // redirect() throws NEXT_REDIRECT — keep it outside any try/catch.
  redirect(invoice ? `/invoices/${invoice.id}` : '/invoices?nothing=1')
}

export async function sendInvoiceAction(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get('invoiceId') ?? '')
  const actor = await requireInvoiceManager()
  if (!actor) failTo(`/invoices/${invoiceId}`, NOT_PERMITTED)
  const { accountId, userId } = actor
  if (!invoiceId || !(await ownsInvoice(invoiceId, accountId))) return
  const wasSent = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { sentAt: true } })
  let error: string | null = null
  try {
    await sendInvoice(prisma, invoiceId)
  } catch (e) {
    // Never swallow: a number collision or a failed guard must reach the user (INV-6/INV-7).
    error = isUniqueViolation(e)
      ? 'Could not assign an invoice number (it is already in use). Please try sending again.'
      : transitionErrorMessage(e, `Could not send the invoice${e instanceof Error ? `: ${e.message.slice(0, 160)}` : '.'}`)
    await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'update', summary: `Send failed — ${error}` }).catch(() => {})
  }
  if (error) failTo(`/invoices/${invoiceId}`, error)
  await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'state_change', summary: wasSent?.sentAt ? 'Invoice resent' : 'Invoice sent' })
  // The invoice stays sent (its number is never rolled back, INV-6); a failed email is surfaced so
  // the user can fix the contact / SendGrid and use "Resend invoice".
  const emailProblem = await emailInvoice(accountId, invoiceId, userId).catch((e) => `Email failed — ${(e as Error).message}`)
  const xeroId = await copyInvoiceToXero(accountId, invoiceId).catch(() => null) // auto-copy to Xero on send (best-effort)
  if (xeroId) await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'update', summary: 'Copied to Xero' })
  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/invoices')
  if (emailProblem) failTo(`/invoices/${invoiceId}`, `Invoice marked as sent, but the client was not emailed: ${emailProblem}. Fix it, then use "Resend invoice".`)
}

export async function markDraftAction(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get('invoiceId') ?? '')
  const actor = await requireInvoiceManager()
  if (!actor) failTo(`/invoices/${invoiceId}`, NOT_PERMITTED)
  const { accountId, userId } = actor
  if (!invoiceId || !(await ownsInvoice(invoiceId, accountId))) return
  let error: string | null = null
  try {
    await markInvoiceDraft(prisma, invoiceId)
  } catch (e) {
    error = transitionErrorMessage(e, 'Could not revert the invoice to draft.')
  }
  if (error) failTo(`/invoices/${invoiceId}`, error)
  await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'state_change', summary: 'Reverted to draft' })
  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/invoices')
}

export async function writeOffInvoiceAction(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get('invoiceId') ?? '')
  const actor = await requireInvoiceManager()
  if (!actor) failTo(`/invoices/${invoiceId}`, NOT_PERMITTED)
  const { accountId, userId } = actor
  if (!invoiceId || !(await ownsInvoice(invoiceId, accountId))) return
  let error: string | null = null
  try {
    await writeOffInvoice(prisma, invoiceId)
  } catch (e) {
    error = transitionErrorMessage(e, 'Could not write off the invoice.')
  }
  if (error) failTo(`/invoices/${invoiceId}`, error)
  await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'state_change', summary: 'Invoice written off' })
  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/invoices')
}

/** Manually (re)copy an invoice to Xero — the Actions-menu counterpart to the auto-copy on send. */
export async function copyToXeroAction(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get('invoiceId') ?? '')
  const actor = await requireInvoiceManager()
  if (!actor) failTo(`/invoices/${invoiceId}`, NOT_PERMITTED)
  const { accountId, userId } = actor
  if (!invoiceId || !(await ownsInvoice(invoiceId, accountId))) return
  const xeroId = await copyInvoiceToXero(accountId, invoiceId).catch(() => null)
  await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'update', summary: xeroId ? 'Copied to Xero' : 'Xero copy failed (not connected?)' })
  revalidatePath(`/invoices/${invoiceId}`)
}

/** Re-mark a sent invoice as sent (re-share). No state change; records activity + re-syncs Xero. */
export async function resendInvoiceAction(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get('invoiceId') ?? '')
  const actor = await requireInvoiceManager()
  if (!actor) failTo(`/invoices/${invoiceId}`, NOT_PERMITTED)
  const { accountId, userId } = actor
  if (!invoiceId || !(await ownsInvoice(invoiceId, accountId))) return
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { status: true } })
  if (!inv || (inv.status !== 'open' && inv.status !== 'paid')) return
  await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'state_change', summary: 'Invoice resent' })
  const emailProblem = await emailInvoice(accountId, invoiceId, userId).catch((e) => `Email failed — ${(e as Error).message}`)
  await copyInvoiceToXero(accountId, invoiceId).catch(() => {})
  revalidatePath(`/invoices/${invoiceId}`)
  if (emailProblem) failTo(`/invoices/${invoiceId}`, `The client was not emailed: ${emailProblem}.`)
}

/** Manually send an overdue-payment reminder to the client (spec 15 E3). */
export async function sendReminderAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceManager()
  if (!actor) return
  const { accountId, userId } = actor
  const invoiceId = String(formData.get('invoiceId') ?? '')
  if (!invoiceId || !(await ownsInvoice(invoiceId, accountId))) return
  const summary = await sendReminder(accountId, invoiceId, baseUrl()).catch(() => 'Reminder failed')
  await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'update', summary })
  revalidatePath(`/invoices/${invoiceId}`)
}

/** Duplicate an invoice as a new draft (copies header + line items; new number/token, unpaid). */
export async function duplicateInvoiceAction(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get('invoiceId') ?? '')
  const actor = await requireInvoiceManager()
  if (!actor) failTo(`/invoices/${invoiceId}`, NOT_PERMITTED)
  const { accountId, userId } = actor
  if (!invoiceId || !(await ownsInvoice(invoiceId, accountId))) return
  const src = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId },
    include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!src) return
  const copy = await prisma.invoice.create({
    data: {
      accountId,
      clientId: src.clientId,
      entityId: src.entityId,
      status: 'draft',
      currency: src.currency,
      paymentTerm: src.paymentTerm,
      subject: src.subject,
      poNumber: src.poNumber,
      notes: src.notes,
      terms: src.terms,
      subtotalCents: src.subtotalCents,
      discountPercent: src.discountPercent,
      discountCents: src.discountCents,
      tax1Name: src.tax1Name,
      tax1Percent: src.tax1Percent,
      tax2Name: src.tax2Name,
      tax2Percent: src.tax2Percent,
      taxCents: src.taxCents,
      totalCents: src.totalCents,
      lineItems: {
        create: src.lineItems.map((li) => ({
          accountId,
          kind: li.kind,
          description: li.description,
          quantity: li.quantity as unknown as Prisma.Decimal,
          unitPriceCents: li.unitPriceCents,
          amountCents: li.amountCents,
          taxable: li.taxable,
          sortOrder: li.sortOrder,
        })),
      },
    },
  })
  await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: copy.id, action: 'create', summary: `Duplicated from ${src.number ?? 'draft'}` })
  revalidatePath('/invoices')
  redirect(`/invoices/${copy.id}`)
}

export async function deleteInvoiceAction(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get('invoiceId') ?? '')
  const actor = await requireInvoiceManager()
  if (!actor) failTo(`/invoices/${invoiceId}`, NOT_PERMITTED)
  const { accountId, userId } = actor
  if (!invoiceId || !(await ownsInvoice(invoiceId, accountId))) return
  const before = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { number: true } })
  let error: string | null = null
  try {
    await deleteInvoice(prisma, invoiceId)
  } catch (e) {
    error = transitionErrorMessage(e, 'Could not delete the invoice.')
  }
  if (error) failTo(`/invoices/${invoiceId}`, error)
  await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'delete', summary: before?.number ? `Invoice ${before.number} deleted` : 'Draft deleted' })
  revalidatePath('/invoices')
  redirect('/invoices')
}
