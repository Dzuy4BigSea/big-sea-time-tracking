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

/** Resolve the optional per-company scope from a form; validates the entity belongs to the account. */
async function entityScope(accountId: string, formData: FormData): Promise<string | null> {
  const raw = String(formData.get('entityId') ?? '').trim()
  if (!raw) return null
  const ent = await prisma.businessEntity.findFirst({ where: { id: raw, accountId }, select: { id: true } })
  return ent?.id ?? null
}

/* ---------- Field labels ---------- */
export async function saveLabelsAction(_prev: ConfigState, formData: FormData): Promise<ConfigState> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return { error: 'You do not have permission to configure invoices.' }
  const entityId = await entityScope(actor.accountId, formData)

  const labels = {} as InvoiceLabelSet
  for (const { key } of LABEL_FIELDS) {
    const v = String(formData.get(`label_${key}`) ?? '').trim()
    labels[key] = v || DEFAULT_LABELS[key]
  }
  const labelsJson = { ...labels } as Record<string, string>
  // Manual upsert: entityId is nullable, so the compound unique can't drive a Prisma upsert.
  const existing = await prisma.invoiceLabels.findFirst({ where: { accountId: actor.accountId, entityId } })
  if (existing) await prisma.invoiceLabels.update({ where: { id: existing.id }, data: { labels: labelsJson } })
  else await prisma.invoiceLabels.create({ data: { accountId: actor.accountId, entityId, labels: labelsJson } })
  revalidatePath('/invoices/configure')
  return { ok: true }
}

export async function resetLabelsAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  const entityId = await entityScope(actor.accountId, formData)
  await prisma.invoiceLabels.deleteMany({ where: { accountId: actor.accountId, entityId } })
  revalidatePath('/invoices/configure')
}

/* ---------- Email messages ---------- */
export async function saveMessageAction(_prev: ConfigState, formData: FormData): Promise<ConfigState> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return { error: 'You do not have permission to configure invoices.' }

  const entityId = await entityScope(actor.accountId, formData)
  const kind = String(formData.get('kind') ?? '') as MessageKind
  if (!MESSAGE_KINDS.some((m) => m.kind === kind)) return { error: 'Unknown message type.' }
  const subject = String(formData.get('subject') ?? '').trim()
  const body = String(formData.get('body') ?? '').trim()
  if (!subject) return { error: 'Subject is required.' }

  const existing = await prisma.invoiceMessageTemplate.findFirst({ where: { accountId: actor.accountId, entityId, kind } })
  if (existing) await prisma.invoiceMessageTemplate.update({ where: { id: existing.id }, data: { subject, body } })
  else await prisma.invoiceMessageTemplate.create({ data: { accountId: actor.accountId, entityId, kind, subject, body } })
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
