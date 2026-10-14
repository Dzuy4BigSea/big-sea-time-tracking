'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { saveInvoiceEdit } from '@/modules/invoicing/saveInvoiceEdit'
import type { SubmittedLine } from '@/modules/invoicing/editInvoice'
import { writeAudit } from '@/lib/audit'

export type EditInvoiceState = { error?: string }

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '')

/**
 * Save the Harvest-style editor in one go (specs/05 §Editing an invoice). Permission check here;
 * every other rule is re-validated in modules/invoicing/saveInvoiceEdit (account-scoped, INV-5).
 */
export async function saveInvoiceAction(_prev: EditInvoiceState, formData: FormData): Promise<EditInvoiceState> {
  const invoiceId = str(formData, 'invoiceId')
  const { accountId, userId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_invoices')) {
    return { error: 'You do not have permission to manage invoices.' }
  }

  let lines: SubmittedLine[]
  try {
    const parsed: unknown = JSON.parse(str(formData, 'lines') || '[]')
    if (!Array.isArray(parsed)) throw new Error('not an array')
    lines = parsed.map((r: Record<string, unknown>) => ({
      id: r.id ? String(r.id) : null,
      itemTypeId: r.itemTypeId ? String(r.itemTypeId) : null,
      description: String(r.description ?? ''),
      quantity: String(r.quantity ?? ''),
      unitPrice: String(r.unitPrice ?? ''),
      linkedProjectId: r.linkedProjectId ? String(r.linkedProjectId) : null,
      taxable: r.taxable === undefined ? true : !!r.taxable,
    }))
  } catch {
    return { error: 'Could not read the line items — reload and try again.' }
  }

  const result = await saveInvoiceEdit(prisma, accountId, invoiceId, {
    number: str(formData, 'number'),
    subject: str(formData, 'subject'),
    poNumber: str(formData, 'poNumber'),
    notes: str(formData, 'notes'),
    issueDate: str(formData, 'issueDate'),
    paymentTerm: str(formData, 'paymentTerm'),
    dueDate: str(formData, 'dueDate'),
    discountPercent: str(formData, 'discountPercent'),
    tax1Name: str(formData, 'tax1Name'),
    tax1Percent: str(formData, 'tax1Percent'),
    tax2Name: str(formData, 'tax2Name'),
    tax2Percent: str(formData, 'tax2Percent'),
    currency: str(formData, 'currency'),
    acceptOnlinePayments: formData.get('acceptOnlinePayments') === 'on',
    allowCardPayments: formData.get('allowCardPayments') === 'on',
    allowAchPayments: formData.get('allowAchPayments') === 'on',
    lines,
  })
  if (!result.ok) return { error: result.error }

  await writeAudit({
    accountId,
    actorUserId: userId,
    entityType: 'invoice',
    entityId: invoiceId,
    action: 'update',
    summary: result.summary,
    detail: result.releasedLineItemIds.length ? { releasedLineItemIds: result.releasedLineItemIds } : undefined,
  })
  if (result.renumbered) {
    const { from, to } = result.renumbered
    await writeAudit({
      accountId,
      actorUserId: userId,
      entityType: 'invoice',
      entityId: invoiceId,
      action: 'update',
      summary: from ? `Invoice ID changed from ${from} to ${to}` : `Invoice ID set to ${to}`,
      // The old number is retired: it is never given to another invoice (INV-6).
      detail: from ? { retiredNumber: from } : undefined,
    })
  }
  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/invoices')
  // redirect() throws NEXT_REDIRECT — keep it outside any try/catch.
  redirect(`/invoices/${invoiceId}`)
}

/** Create a blank draft invoice for a client, then open the editor (the "New invoice" path). */
export async function createBlankInvoiceAction(formData: FormData): Promise<void> {
  const { accountId, userId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_invoices')) return
  const clientId = String(formData.get('clientId') ?? '')
  const client = await prisma.client.findFirst({ where: { id: clientId, accountId }, select: { id: true, currency: true, entityId: true } })
  if (!client) return
  const invoice = await prisma.invoice.create({
    data: { accountId, clientId: client.id, entityId: client.entityId, status: 'draft', currency: client.currency },
  })
  await writeAudit({ accountId, actorUserId: userId, entityType: 'invoice', entityId: invoice.id, action: 'create', summary: 'Blank draft created' })
  revalidatePath('/invoices')
  redirect(`/invoices/${invoice.id}/edit`)
}
