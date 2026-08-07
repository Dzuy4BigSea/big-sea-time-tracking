'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { validEntityId } from '@/lib/entities'

export type NewClientState = { error?: string; ok?: boolean }
export type EditClientState = { error?: string; ok?: boolean }

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD']

export async function createClientAction(_prev: NewClientState, formData: FormData): Promise<NewClientState> {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()

  // Permission gate (defense in depth — the form is also hidden for those who can't).
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_clients')) {
    return { error: 'You do not have permission to add clients.' }
  }

  const name = String(formData.get('name') ?? '').trim()
  const currencyRaw = String(formData.get('currency') ?? 'USD').toUpperCase()
  const currency = CURRENCIES.includes(currencyRaw) ? currencyRaw : 'USD'
  const address = String(formData.get('address') ?? '').trim() || undefined

  const contactFirst = String(formData.get('contactFirst') ?? '').trim()
  const contactLast = String(formData.get('contactLast') ?? '').trim()
  const contactEmail = String(formData.get('contactEmail') ?? '').trim() || undefined
  const contactIsRecipient = formData.get('contactIsRecipient') === 'on'

  if (!name) return { error: 'Client name is required.' }

  const entityId = await validEntityId(accountId, String(formData.get('entityId') ?? ''))
  const hasContact = contactFirst || contactLast || contactEmail
  try {
    await prisma.client.create({
      data: {
        accountId,
        name,
        currency,
        address,
        entityId,
        contacts: hasContact
          ? {
              create: [
                {
                  accountId,
                  firstName: contactFirst || '—',
                  lastName: contactLast || '',
                  email: contactEmail,
                  isInvoiceRecipient: contactIsRecipient,
                },
              ],
            }
          : undefined,
      },
    })
  } catch {
    return { error: 'Could not create the client.' }
  }

  revalidatePath('/clients')
  return { ok: true }
}

export async function updateClientAction(_prev: EditClientState, formData: FormData): Promise<EditClientState> {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_clients')) {
    return { error: 'You do not have permission to edit clients.' }
  }

  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const currencyRaw = String(formData.get('currency') ?? 'USD').toUpperCase()
  const currency = CURRENCIES.includes(currencyRaw) ? currencyRaw : 'USD'
  const address = String(formData.get('address') ?? '').trim() || null

  if (!name) return { error: 'Client name is required.' }

  const entityId = await validEntityId(accountId, String(formData.get('entityId') ?? ''))
  const client = await prisma.client.findFirst({
    where: { id, accountId },
    select: { currency: true, _count: { select: { invoices: true } } },
  })
  if (!client) return { error: 'Client not found.' }

  // Currency is immutable once the client has invoices (prevents mixed-currency drift).
  const lockedCurrency = client._count.invoices > 0
  if (lockedCurrency && currency !== client.currency) {
    return { error: 'Currency can’t change after the client has invoices.' }
  }

  try {
    await prisma.client.update({
      where: { id },
      data: { name, address, currency: lockedCurrency ? client.currency : currency, entityId },
    })
  } catch {
    return { error: 'Could not save the client.' }
  }

  revalidatePath('/clients')
  return { ok: true }
}

async function clientAdmin(clientId: string) {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_clients')) return null
  const client = await prisma.client.findFirst({ where: { id: clientId, accountId }, select: { id: true } })
  return client ? accountId : null
}

/** Add a contact to a client (specs/12 — client contact management). */
export async function addContactAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get('clientId') ?? '')
  const accountId = await clientAdmin(clientId)
  if (!accountId) return
  const firstName = String(formData.get('firstName') ?? '').trim()
  const lastName = String(formData.get('lastName') ?? '').trim()
  if (!firstName && !lastName) return
  await prisma.clientContact.create({
    data: {
      accountId,
      clientId,
      firstName: firstName || '—',
      lastName,
      title: String(formData.get('title') ?? '').trim() || null,
      email: String(formData.get('email') ?? '').trim() || null,
      phoneOffice: String(formData.get('phoneOffice') ?? '').trim() || null,
      phoneMobile: String(formData.get('phoneMobile') ?? '').trim() || null,
      isInvoiceRecipient: formData.get('isInvoiceRecipient') === 'on',
    },
  })
  revalidatePath(`/clients/${clientId}`)
}

export async function deleteContactAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get('clientId') ?? '')
  const accountId = await clientAdmin(clientId)
  if (!accountId) return
  await prisma.clientContact.deleteMany({ where: { id: String(formData.get('contactId') ?? ''), clientId, accountId } })
  revalidatePath(`/clients/${clientId}`)
}

export async function toggleInvoiceRecipientAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get('clientId') ?? '')
  const accountId = await clientAdmin(clientId)
  if (!accountId) return
  const id = String(formData.get('contactId') ?? '')
  const c = await prisma.clientContact.findFirst({ where: { id, clientId, accountId }, select: { isInvoiceRecipient: true } })
  if (!c) return
  await prisma.clientContact.update({ where: { id }, data: { isInvoiceRecipient: !c.isInvoiceRecipient } })
  revalidatePath(`/clients/${clientId}`)
}

/** Archive or restore a client (specs/03). */
export async function setClientArchivedAction(formData: FormData): Promise<void> {
  const { accountId, permissionProfile, permissionOverrides } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile, permissionOverrides }, 'manage_clients')) return
  const id = String(formData.get('id') ?? '')
  const archived = String(formData.get('archived') ?? '') === 'on'
  const client = await prisma.client.findFirst({ where: { id, accountId }, select: { id: true } })
  if (!client) return
  await prisma.client.update({ where: { id }, data: { isActive: !archived, archivedAt: archived ? new Date() : null } })
  revalidatePath('/clients')
  revalidatePath(`/clients/${id}`)
}
