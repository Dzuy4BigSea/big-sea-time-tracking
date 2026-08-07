'use server'

import { revalidatePath } from 'next/cache'
import type { MessageKind } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { DEFAULT_LABELS, LABEL_FIELDS, type InvoiceLabelSet } from '@/lib/invoiceLabels'
import { MESSAGE_KINDS } from '@/lib/messageTemplates'

export type ConfigState = { error?: string; ok?: boolean }

async function requireInvoiceAdmin() {
  const actor = await requireUser()
  const ok = can(
    { permissionProfile: actor.permissionProfile as PermissionProfile, permissionOverrides: actor.permissionOverrides },
    'edit_account_settings',
  )
  return ok ? actor : null
}

/* ---------- Field labels ---------- */
export async function saveLabelsAction(_prev: ConfigState, formData: FormData): Promise<ConfigState> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return { error: 'You do not have permission to configure invoices.' }

  const labels = {} as InvoiceLabelSet
  for (const { key } of LABEL_FIELDS) {
    const v = String(formData.get(`label_${key}`) ?? '').trim()
    labels[key] = v || DEFAULT_LABELS[key]
  }
  const labelsJson = { ...labels } as Record<string, string>
  await prisma.invoiceLabels.upsert({
    where: { accountId: actor.accountId },
    create: { accountId: actor.accountId, labels: labelsJson },
    update: { labels: labelsJson },
  })
  revalidatePath('/invoices/configure')
  return { ok: true }
}

export async function resetLabelsAction(): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  await prisma.invoiceLabels.deleteMany({ where: { accountId: actor.accountId } })
  revalidatePath('/invoices/configure')
}

/* ---------- Email messages ---------- */
export async function saveMessageAction(_prev: ConfigState, formData: FormData): Promise<ConfigState> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return { error: 'You do not have permission to configure invoices.' }

  const kind = String(formData.get('kind') ?? '') as MessageKind
  if (!MESSAGE_KINDS.some((m) => m.kind === kind)) return { error: 'Unknown message type.' }
  const subject = String(formData.get('subject') ?? '').trim()
  const body = String(formData.get('body') ?? '').trim()
  if (!subject) return { error: 'Subject is required.' }

  await prisma.invoiceMessageTemplate.upsert({
    where: { accountId_kind: { accountId: actor.accountId, kind } },
    create: { accountId: actor.accountId, kind, subject, body },
    update: { subject, body },
  })
  revalidatePath('/invoices/configure')
  return { ok: true }
}

/* ---------- Item types ---------- */
export async function addItemTypeAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  const exists = await prisma.itemType.findFirst({ where: { accountId: actor.accountId, name } })
  if (exists) return
  await prisma.itemType.create({ data: { accountId: actor.accountId, name } })
  revalidatePath('/invoices/configure')
}

export async function deleteItemTypeAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const it = await prisma.itemType.findFirst({ where: { id, accountId: actor.accountId } })
  if (!it || it.isSystemDefault) return
  // Only remove when unused, to avoid orphaning line items.
  const inUse = await prisma.invoiceLineItem.count({ where: { itemTypeId: id } })
  const inUseEst = await prisma.estimateLineItem.count({ where: { itemTypeId: id } })
  if (inUse + inUseEst > 0) return
  await prisma.itemType.delete({ where: { id } })
  revalidatePath('/invoices/configure')
}

/* ---------- Sender addresses ---------- */
export async function addSenderAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  const name = String(formData.get('name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  if (!name || !email || !email.includes('@')) return
  const count = await prisma.senderAddress.count({ where: { accountId: actor.accountId } })
  await prisma.senderAddress.create({
    data: { accountId: actor.accountId, name, email, isDefault: count === 0 },
  })
  revalidatePath('/invoices/configure')
}

export async function setDefaultSenderAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const sender = await prisma.senderAddress.findFirst({ where: { id, accountId: actor.accountId } })
  if (!sender) return
  await prisma.$transaction([
    prisma.senderAddress.updateMany({ where: { accountId: actor.accountId }, data: { isDefault: false } }),
    prisma.senderAddress.update({ where: { id }, data: { isDefault: true } }),
  ])
  revalidatePath('/invoices/configure')
}

export async function deleteSenderAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const sender = await prisma.senderAddress.findFirst({ where: { id, accountId: actor.accountId } })
  if (!sender) return
  await prisma.senderAddress.delete({ where: { id } })
  // If we removed the default, promote another one.
  if (sender.isDefault) {
    const next = await prisma.senderAddress.findFirst({ where: { accountId: actor.accountId }, orderBy: { name: 'asc' } })
    if (next) await prisma.senderAddress.update({ where: { id: next.id }, data: { isDefault: true } })
  }
  revalidatePath('/invoices/configure')
}
