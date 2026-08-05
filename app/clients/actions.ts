'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'

export type NewClientState = { error?: string; ok?: boolean }

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

  const hasContact = contactFirst || contactLast || contactEmail
  try {
    await prisma.client.create({
      data: {
        accountId,
        name,
        currency,
        address,
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
