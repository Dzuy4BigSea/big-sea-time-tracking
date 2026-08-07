'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { Prisma, type PaymentTerm } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { recomputeInvoiceTotals } from '@/modules/invoicing/recomputeTotals'
import { writeAudit } from '@/lib/audit'
import { parseYmd } from '@/lib/week'

export type EditInvoiceState = { error?: string; ok?: boolean }

const TERMS: PaymentTerm[] = ['due_on_receipt', 'net_15', 'net_30', 'net_45', 'net_60', 'custom']
const centsFrom = (raw: FormDataEntryValue | null): number => {
  const n = Number(String(raw ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const pctOrNull = (raw: FormDataEntryValue | null): number | null => {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Guard: invoice belongs to the actor's account + actor may manage invoices. Returns status or null. */
async function guard(invoiceId: string): Promise<{ accountId: string; userId: string; status: string } | null> {
  const { accountId, userId, permissionProfile } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile }, 'manage_invoices')) return null
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, accountId }, select: { status: true } })
  if (!inv) return null
  return { accountId, userId, status: inv.status }
}

/** Header fields — editable for draft + open invoices. Recomputes totals (discount/tax may change). */
export async function updateInvoiceMetaAction(_prev: EditInvoiceState, formData: FormData): Promise<EditInvoiceState> {
  const invoiceId = String(formData.get('invoiceId') ?? '')
  const g = await guard(invoiceId)
  if (!g) return { error: 'Not found or not permitted.' }
  if (g.status !== 'draft' && g.status !== 'open') return { error: 'This invoice can no longer be edited.' }

  const termRaw = String(formData.get('paymentTerm') ?? 'net_30') as PaymentTerm
  const t1 = pctOrNull(formData.get('tax1Percent'))
  const t2 = pctOrNull(formData.get('tax2Percent'))
  const disc = pctOrNull(formData.get('discountPercent'))
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      subject: String(formData.get('subject') ?? '').trim() || null,
      poNumber: String(formData.get('poNumber') ?? '').trim() || null,
      notes: String(formData.get('notes') ?? '').trim() || null,
      terms: String(formData.get('terms') ?? '').trim() || null,
      issueDate: parseYmd(String(formData.get('issueDate') ?? '')) ?? null,
      dueDate: parseYmd(String(formData.get('dueDate') ?? '')) ?? null,
      paymentTerm: TERMS.includes(termRaw) ? termRaw : 'net_30',
      discountPercent: disc != null ? new Prisma.Decimal(disc) : null,
      tax1Name: String(formData.get('tax1Name') ?? '').trim() || null,
      tax1Percent: t1 != null ? new Prisma.Decimal(t1) : null,
      tax2Name: String(formData.get('tax2Name') ?? '').trim() || null,
      tax2Percent: t2 != null ? new Prisma.Decimal(t2) : null,
    },
  })
  await recomputeInvoiceTotals(prisma, invoiceId)
  await writeAudit({ accountId: g.accountId, actorUserId: g.userId, entityType: 'invoice', entityId: invoiceId, action: 'update', summary: 'Invoice details edited' })
  revalidatePath(`/invoices/${invoiceId}/edit`)
  revalidatePath(`/invoices/${invoiceId}`)
  return { ok: true }
}

/** Line-item add/edit/remove — draft only (open invoices have locked, billed entries). */
export async function addLineItemAction(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get('invoiceId') ?? '')
  const g = await guard(invoiceId)
  if (!g || g.status !== 'draft') return
  const description = String(formData.get('description') ?? '').trim()
  if (!description) return
  const quantity = Number(String(formData.get('quantity') ?? '1').replace(/[,\s]/g, '')) || 1
  const unitPriceCents = centsFrom(formData.get('unitPrice'))
  const amountCents = Math.round(quantity * unitPriceCents)
  const taxable = formData.get('taxable') === 'on'
  const max = await prisma.invoiceLineItem.aggregate({ where: { invoiceId }, _max: { sortOrder: true } })
  await prisma.invoiceLineItem.create({
    data: {
      accountId: g.accountId,
      invoiceId,
      kind: 'free_form',
      description,
      quantity: new Prisma.Decimal(quantity),
      unitPriceCents,
      amountCents,
      taxable,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  })
  await recomputeInvoiceTotals(prisma, invoiceId)
  revalidatePath(`/invoices/${invoiceId}/edit`)
  revalidatePath(`/invoices/${invoiceId}`)
}

export async function updateLineItemAction(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get('invoiceId') ?? '')
  const lineItemId = String(formData.get('lineItemId') ?? '')
  const g = await guard(invoiceId)
  if (!g || g.status !== 'draft' || !lineItemId) return
  const li = await prisma.invoiceLineItem.findFirst({ where: { id: lineItemId, invoiceId, accountId: g.accountId }, select: { id: true } })
  if (!li) return
  const description = String(formData.get('description') ?? '').trim()
  if (!description) return
  const quantity = Number(String(formData.get('quantity') ?? '1').replace(/[,\s]/g, '')) || 1
  const unitPriceCents = centsFrom(formData.get('unitPrice'))
  await prisma.invoiceLineItem.update({
    where: { id: lineItemId },
    data: {
      description,
      quantity: new Prisma.Decimal(quantity),
      unitPriceCents,
      amountCents: Math.round(quantity * unitPriceCents),
      taxable: formData.get('taxable') === 'on',
    },
  })
  await recomputeInvoiceTotals(prisma, invoiceId)
  revalidatePath(`/invoices/${invoiceId}/edit`)
  revalidatePath(`/invoices/${invoiceId}`)
}

export async function removeLineItemAction(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get('invoiceId') ?? '')
  const lineItemId = String(formData.get('lineItemId') ?? '')
  const g = await guard(invoiceId)
  if (!g || g.status !== 'draft' || !lineItemId) return
  await prisma.invoiceLineItem.deleteMany({ where: { id: lineItemId, invoiceId, accountId: g.accountId } })
  await recomputeInvoiceTotals(prisma, invoiceId)
  revalidatePath(`/invoices/${invoiceId}/edit`)
  revalidatePath(`/invoices/${invoiceId}`)
}

/** Create a blank draft invoice for a client, then open the editor (the "New invoice" path). */
export async function createBlankInvoiceAction(formData: FormData): Promise<void> {
  const { accountId, userId, permissionProfile } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile }, 'manage_invoices')) return
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
