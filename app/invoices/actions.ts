'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { PaymentMethod } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordPayment } from '@/modules/invoicing/recordPayment'
import { generateInvoice } from '@/modules/invoicing/generateInvoice'
import { sendInvoice, markInvoiceDraft, deleteInvoice } from '@/modules/invoicing/invoiceLifecycle'
import { copyInvoiceToXero, copyPaymentToXero } from '@/modules/integrations/xeroSync'
import { parseYmd } from '@/lib/week'
import { requireUser } from '@/lib/session'
import { writeAudit } from '@/lib/audit'
import { formatCents } from '@/lib/format'

export type PaymentState = { error?: string; ok?: boolean }

const METHODS: PaymentMethod[] = ['cash', 'check', 'bank_transfer', 'card', 'other']

/** Tenant guard — the invoice must belong to the actor's account (INV-5). */
async function ownsInvoice(invoiceId: string, accountId: string): Promise<boolean> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { accountId: true } })
  return !!inv && inv.accountId === accountId
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

export async function deleteInvoiceAction(formData: FormData): Promise<void> {
  const { accountId, userId } = await requireUser()
  const invoiceId = String(formData.get('invoiceId') ?? '')
  if (!invoiceId || !(await ownsInvoice(invoiceId, accountId))) return
  let deleted = false
  try {
    await deleteInvoice(prisma, invoiceId)
    deleted = true
  } catch {
    deleted = false
  }
  if (deleted) await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoiceId, action: 'delete', summary: 'Draft deleted' })
  revalidatePath('/invoices')
  if (deleted) redirect('/invoices')
}
