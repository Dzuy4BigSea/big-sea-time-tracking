'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'

export type EntityState = { error?: string; ok?: boolean }

async function requireEntitiesAdmin() {
  const actor = await requireUser()
  const ok = can(
    { permissionProfile: actor.permissionProfile as PermissionProfile, permissionOverrides: actor.permissionOverrides },
    'edit_account_settings',
  )
  return ok ? actor : null
}

const clean = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim()
  return s || null
}

/** Update a company's profile, branding, sender identity, and email theme (spec 18). */
export async function updateEntityBrandingAction(_prev: EntityState, formData: FormData): Promise<EntityState> {
  const actor = await requireEntitiesAdmin()
  if (!actor) return { error: 'You do not have permission to edit companies.' }

  const id = String(formData.get('id') ?? '')
  const entity = await prisma.businessEntity.findFirst({ where: { id, accountId: actor.accountId } })
  if (!entity) return { error: 'Company not found.' }

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'Company name is required.' }
  const email = clean(formData.get('senderEmail'))
  if (email && !email.includes('@')) return { error: 'Sender email looks invalid.' }
  const replyTo = clean(formData.get('replyToEmail'))
  if (replyTo && !replyTo.includes('@')) return { error: 'Reply-to email looks invalid.' }

  await prisma.businessEntity.update({
    where: { id },
    data: {
      name,
      senderName: clean(formData.get('senderName')),
      senderEmail: email,
      replyToEmail: replyTo,
      brandColor: clean(formData.get('brandColor')),
      accentColor: clean(formData.get('accentColor')),
      logoFileUrl: clean(formData.get('logoFileUrl')),
      documentTitle: clean(formData.get('documentTitle')),
      emailBrandColor: clean(formData.get('emailBrandColor')),
      emailAccentColor: clean(formData.get('emailAccentColor')),
    },
  })
  revalidatePath('/settings/integrations')
  revalidatePath('/invoices/configure')
  return { ok: true }
}

/** Add a new company (name + code). */
export async function addEntityAction(formData: FormData): Promise<void> {
  const actor = await requireEntitiesAdmin()
  if (!actor) return
  const name = String(formData.get('name') ?? '').trim()
  let code = String(formData.get('code') ?? '').trim().toUpperCase().slice(0, 6)
  if (!name) return
  if (!code) code = name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'CO'
  const clash = await prisma.businessEntity.findFirst({ where: { accountId: actor.accountId, code } })
  if (clash) code = `${code}${Math.min(9, (await prisma.businessEntity.count({ where: { accountId: actor.accountId } })) )}`
  const max = await prisma.businessEntity.aggregate({ where: { accountId: actor.accountId }, _max: { sortOrder: true } })
  await prisma.businessEntity.create({
    data: { accountId: actor.accountId, name, code, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  })
  revalidatePath('/settings/integrations')
}

/** Make a company the account default (exactly one default always remains). */
export async function setDefaultEntityAction(formData: FormData): Promise<void> {
  const actor = await requireEntitiesAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const entity = await prisma.businessEntity.findFirst({ where: { id, accountId: actor.accountId } })
  if (!entity) return
  await prisma.$transaction([
    prisma.businessEntity.updateMany({ where: { accountId: actor.accountId }, data: { isDefault: false } }),
    prisma.businessEntity.update({ where: { id }, data: { isDefault: true, isActive: true } }),
  ])
  revalidatePath('/settings/integrations')
}

/** Activate / deactivate a company. The default company can't be deactivated. */
export async function setEntityActiveAction(formData: FormData): Promise<void> {
  const actor = await requireEntitiesAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const active = String(formData.get('active') ?? '') === '1'
  const entity = await prisma.businessEntity.findFirst({ where: { id, accountId: actor.accountId } })
  if (!entity || (entity.isDefault && !active)) return
  await prisma.businessEntity.update({ where: { id }, data: { isActive: active } })
  revalidatePath('/settings/integrations')
}
