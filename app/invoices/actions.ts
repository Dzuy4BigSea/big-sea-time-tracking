'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { PaymentMethod } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordPayment } from '@/modules/invoicing/recordPayment'
import { generateInvoice } from '@/modules/invoicing/generateInvoice'
import { parseYmd } from '@/lib/week'

// Scoped to the demo account until account context / auth lands.
const ACCOUNT_ID = 'acc_demo'

export type PaymentState = { error?: string; ok?: boolean }

const METHODS: PaymentMethod[] = ['cash', 'check', 'bank_transfer', 'card', 'other']

export async function recordPaymentAction(_prev: PaymentState, formData: FormData): Promise<PaymentState> {
  const invoiceId = String(formData.get('invoiceId') ?? '')
  const amountStr = String(formData.get('amount') ?? '').replace(/[$,\s]/g, '')
  const paidOn = parseYmd(String(formData.get('paidOn') ?? ''))
  const method = String(formData.get('method') ?? 'other') as PaymentMethod

  if (!invoiceId) return { error: 'Missing invoice.' }
  const amount = Number(amountStr)
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter a payment amount greater than 0.' }
  if (!paidOn) return { error: 'Pick a payment date.' }
  const amountCents = Math.round(amount * 100)
  const safeMethod = METHODS.includes(method) ? method : 'other'

  try {
    await recordPayment(prisma, { invoiceId, amountCents, paidOn, method: safeMethod })
  } catch (e) {
    const msg = e instanceof Error && /overpayment/i.test(e.message) ? 'Payment exceeds the amount due.' : 'Could not record payment (invoice may not be open).'
    return { error: msg }
  }

  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/invoices')
  return { ok: true }
}

export async function generateInvoiceAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get('clientId') ?? '')
  if (!clientId) return
  const invoice = await generateInvoice(prisma, { accountId: ACCOUNT_ID, clientId })
  revalidatePath('/invoices')
  // redirect() throws NEXT_REDIRECT — keep it outside any try/catch.
  redirect(invoice ? `/invoices/${invoice.id}` : '/invoices?nothing=1')
}
