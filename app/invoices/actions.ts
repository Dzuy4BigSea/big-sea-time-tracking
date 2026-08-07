'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { PaymentMethod } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordPayment } from '@/modules/invoicing/recordPayment'
import { generateInvoice } from '@/modules/invoicing/generateInvoice'
import { sendInvoice, markInvoiceDraft, deleteInvoice, writeOffInvoice } from '@/modules/invoicing/invoiceLifecycle'
import { Prisma } from '@prisma/client'
import { copyInvoiceToXero, copyPaymentToXero } from '@/modules/integrations/xeroSync'
import { parseYmd } from '@/lib/week'
import { requireUser } from '@/lib/session'
import { writeAudit } from '@/lib/audit'
import { formatCents, formatDate } from '@/lib/format'
import { headers } from 'next/headers'
import { sendEmail } from '@/modules/email/send'
import { renderInvoiceSentEmail } from '@/modules/email/templates'

export type PaymentState = { error?: string; ok?: boolean }

const METHODS: PaymentMethod[] = ['cash', 'check', 'bank_transfer', 'card', 'other']

/** Tenant guard — the invoice must belong to the actor's account (INV-5). */
async function ownsInvoice(invoiceId: string, accountId: string): Promise<boolean> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { accountId: true } })
  return !!inv && inv.accountId === accountId
}

function baseUrl(): string {
  const h = headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  return `${proto}://${host}`
}

/**
 * Email a sent invoice to the client's invoice recipient via SendGrid (specs/15/16). Best-effort:
 * records the outcome to the activity log and never throws into the caller. From-address is the
 * invoice entity's sender (Cordelia vs Big Sea), resolved inside sendEmail.
 */
async function emailInvoice(accountId: string, invoiceId: string, actorUserId: string): Promise<void> {
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId },
    include: { client: { include: { contacts: true } }, account: { select: { name: true } }, entity: { select: { name: true } } },
  })
  if (!inv || !inv.publicToken) return
  const recipient =
    inv.client.contacts.find((c) => c.isInvoiceRecipient && c.email)?.email ??
    inv.client.contacts.find((c) => c.email)?.email ??
    null
  if (!recipient) {
    await writeAudit({ accountId, actorUserId, entityType: 'invoice', entityId: invoiceId, action: 'update', summary: 'Not emailed — no invoice-recipient contact on file' })
    return
  }
  const link = `${baseUrl()}/i/${inv.publicToken}`
  const due = inv.totalCents - inv.paidCents
  const { subject, html } = renderInvoiceSentEmail({
    fromName: inv.entity?.name ?? inv.account.name,
    clientName: inv.client.name,
    invoiceNumber: inv.number ?? '',
    amountDue: formatCents(due, inv.currency),
    issueDate: formatDate(inv.issueDate),
    dueDate: formatDate(inv.dueDate),
    payUrl: due > 0 ? link : null,
    invoiceUrl: link,
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
}

export async function recordPaymentAction(_prev: PaymentState, formData: FormData): Promise<PaymentState> {
  const { accountId, userId } = await requireUser()
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
  await copyPaymentToXero(accountId, invoiceId).catch(() => {}) // best-effort accounting sync
  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/invoices')
  return { ok: true }
}

export async function generateInvoiceAction(formData: FormData): Promise<void> {
  const { accountId, userId } = await requireUser()
  const clientId = String(formData.get('clientId') ?? '')
  if (!clientId) return
  // Guard: the client must belong to the actor's account.
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { accountId: true, entityId: true } })
  if (!client || client.accountId !== accountId) return
  const invoice = await generateInvoice(prisma, { accountId, clientId })
  // Stamp the business entity from the client so routing (sender/branding/Stripe/Xero) is fixed (specs/16).
  if (invoice && client.entityId) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { entityId: client.entityId } }).catch(() => {})
  }
  if (invoice) await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoice.id, action: 'create', summary: 'Draft generated from tracked time' })
  revalidatePath('/invoices')
  // redirect() throws NEXT_REDIRECT — keep it outside any try/catch.
  redirect(invoice ? `/invoices/${invoice.id}` : '/invoices?nothing=1')
}

export async function sendInvoiceAction(formData: FormData): Promise<void> {
  const { accountId, userId } = await requireUser()
  const invoiceId = String(formData.get('invoiceId') ?? '')
  if (!invoiceId || !(await ownsInvoice(invoiceId, accountId))) return
  const wasSent = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { sentAt: true } })
  try {
    await sendInvoice(prisma, invoiceId)
  } catch {
    return
  }
  await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'state_change', summary: wasSent?.sentAt ? 'Invoice resent' : 'Invoice sent' })
  await emailInvoice(accountId, invoiceId, userId).catch(() => {}) // email the client (best-effort)
  const xeroId = await copyInvoiceToXero(accountId, invoiceId).catch(() => null) // auto-copy to Xero on send (best-effort)
  if (xeroId) await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'update', summary: 'Copied to Xero' })
  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/invoices')
}

export async function markDraftAction(formData: FormData): Promise<void> {
  const { accountId, userId } = await requireUser()
  const invoiceId = String(formData.get('invoiceId') ?? '')
  if (!invoiceId || !(await ownsInvoice(invoiceId, accountId))) return
  try {
    await markInvoiceDraft(prisma, invoiceId)
  } catch {
    return
  }
  await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'state_change', summary: 'Reverted to draft' })
  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/invoices')
}

export async function writeOffInvoiceAction(formData: FormData): Promise<void> {
  const { accountId, userId } = await requireUser()
  const invoiceId = String(formData.get('invoiceId') ?? '')
  if (!invoiceId || !(await ownsInvoice(invoiceId, accountId))) return
  try {
    await writeOffInvoice(prisma, invoiceId)
  } catch {
    return
  }
  await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'state_change', summary: 'Invoice written off' })
  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/invoices')
}

/** Manually (re)copy an invoice to Xero — the Actions-menu counterpart to the auto-copy on send. */
export async function copyToXeroAction(formData: FormData): Promise<void> {
  const { accountId, userId } = await requireUser()
  const invoiceId = String(formData.get('invoiceId') ?? '')
  if (!invoiceId || !(await ownsInvoice(invoiceId, accountId))) return
  const xeroId = await copyInvoiceToXero(accountId, invoiceId).catch(() => null)
  await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'update', summary: xeroId ? 'Copied to Xero' : 'Xero copy failed (not connected?)' })
  revalidatePath(`/invoices/${invoiceId}`)
}

/** Re-mark a sent invoice as sent (re-share). No state change; records activity + re-syncs Xero. */
export async function resendInvoiceAction(formData: FormData): Promise<void> {
  const { accountId, userId } = await requireUser()
  const invoiceId = String(formData.get('invoiceId') ?? '')
  if (!invoiceId || !(await ownsInvoice(invoiceId, accountId))) return
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { status: true } })
  if (!inv || (inv.status !== 'open' && inv.status !== 'paid')) return
  await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'state_change', summary: 'Invoice resent' })
  await emailInvoice(accountId, invoiceId, userId).catch(() => {}) // re-email the client (best-effort)
  await copyInvoiceToXero(accountId, invoiceId).catch(() => {})
  revalidatePath(`/invoices/${invoiceId}`)
}

/** Duplicate an invoice as a new draft (copies header + line items; new number/token, unpaid). */
export async function duplicateInvoiceAction(formData: FormData): Promise<void> {
  const { accountId, userId } = await requireUser()
  const invoiceId = String(formData.get('invoiceId') ?? '')
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
  const { accountId, userId } = await requireUser()
  const invoiceId = String(formData.get('invoiceId') ?? '')
  if (!invoiceId || !(await ownsInvoice(invoiceId, accountId))) return
  const before = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { number: true } })
  let deleted = false
  try {
    await deleteInvoice(prisma, invoiceId)
    deleted = true
  } catch {
    deleted = false
  }
  if (deleted) {
    await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'delete', summary: before?.number ? `Invoice ${before.number} deleted` : 'Draft deleted' })
  }
  revalidatePath('/invoices')
  if (deleted) redirect('/invoices')
}
