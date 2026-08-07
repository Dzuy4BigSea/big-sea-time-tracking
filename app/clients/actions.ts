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
  const { accountId, permissionProfile } = await requireUser()

  // Permission gate (defense in depth — the form is also hidden for those who can't).
  if (!can({ permissionProfile: permissionProfile as PermissionProfile }, 'manage_clients')) {
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
  const { accountId, permissionProfile } = await requireUser()
  if (!can({ permissionProfile: permissionProfile as PermissionProfile }, 'manage_clients')) {
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
