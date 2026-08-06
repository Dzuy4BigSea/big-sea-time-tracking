'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { PrismaClient, RecurringFrequency as DbFreq, PaymentTerm } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { advanceIssueDate, isDue } from '@/modules/invoicing/recurring'
import { parseYmd } from '@/lib/week'

export type RecurringState = { error?: string; ok?: boolean }

interface TemplateLine {
  description: string
  quantity: number
  unitPriceCents: number
  amountCents: number
}

const FREQ: DbFreq[] = ['weekly', 'monthly', 'quarterly', 'yearly', 'custom']
const centsFrom = (raw: FormDataEntryValue | null): number | null => {
  const n = Number(String(raw ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}

async function requireInvoiceAdmin() {
  const actor = await requireUser()
  if (!can({ permissionProfile: actor.permissionProfile as PermissionProfile }, 'manage_invoices')) return null
  return actor
}

export async function createRecurringAction(_prev: RecurringState, formData: FormData): Promise<RecurringState> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return { error: 'You do not have permission to manage recurring invoices.' }

  const clientId = String(formData.get('clientId') ?? '')
  const subject = String(formData.get('subject') ?? '').trim()
  const freqRaw = String(formData.get('frequency') ?? 'monthly') as DbFreq
  const frequency = FREQ.includes(freqRaw) ? freqRaw : 'monthly'
  const intervalCount = Math.max(1, Math.floor(Number(String(formData.get('intervalCount') ?? '1')) || 1))
  const nextIssueDate = parseYmd(String(formData.get('nextIssueDate') ?? ''))
  const amountCents = centsFrom(formData.get('amount'))

  const client = await prisma.client.findFirst({ where: { id: clientId, accountId: actor.accountId }, select: { id: true } })
  if (!client) return { error: 'Pick a client.' }
  if (!subject) return { error: 'Subject is required.' }
  if (!nextIssueDate) return { error: 'Pick the next issue date.' }
  if (!amountCents) return { error: 'Enter an amount.' }

  const templateLineItems: TemplateLine[] = [
    { description: subject, quantity: 1, unitPriceCents: amountCents, amountCents },
  ]

  try {
    await prisma.recurringInvoiceProfile.create({
      data: {
        accountId: actor.accountId,
        clientId,
        subject,
        frequency,
        intervalCount,
        nextIssueDate,
        amountCents,
        status: 'active',
        templateLineItems: templateLineItems as unknown as object,
      },
    })
  } catch {
    return { error: 'Could not create the recurring profile.' }
  }
  revalidatePath('/recurring')
  return { ok: true }
}

/** AC-REC-004: seed a profile from an existing invoice's line items. */
export async function createRecurringFromInvoiceAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  const invoiceId = String(formData.get('invoiceId') ?? '')
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId: actor.accountId },
    include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!inv) return

  const templateLineItems: TemplateLine[] = inv.lineItems.map((li) => ({
    description: li.description,
    quantity: Number(li.quantity),
    unitPriceCents: li.unitPriceCents,
    amountCents: li.amountCents,
  }))
  const today = new Date()

  await prisma.recurringInvoiceProfile.create({
    data: {
      accountId: actor.accountId,
      clientId: inv.clientId,
      subject: inv.subject ?? 'Recurring invoice',
      frequency: 'monthly',
      intervalCount: 1,
      nextIssueDate: advanceIssueDate(today, 'monthly'),
      amountCents: inv.totalCents,
      paymentTerm: inv.paymentTerm,
      notes: inv.notes,
      status: 'active',
      templateLineItems: templateLineItems as unknown as object,
    },
  })
  revalidatePath('/recurring')
  redirect('/recurring')
}

/** Generate a draft invoice for every due active profile, then advance its date. Idempotent per date. */
export async function generateDueRecurring(db: PrismaClient, accountId: string, asOf: Date): Promise<number> {
  const profiles = await db.recurringInvoiceProfile.findMany({ where: { accountId, status: 'active' } })
  let created = 0
  for (const p of profiles) {
    if (!isDue(p.nextIssueDate, asOf, 'active')) continue
    const client = await db.client.findUnique({ where: { id: p.clientId }, select: { currency: true } })
    const lines = (p.templateLineItems as unknown as TemplateLine[]) ?? []
    const subtotal = lines.reduce((s, li) => s + li.amountCents, 0)
    const nextDate = advanceIssueDate(p.nextIssueDate!, p.frequency, p.intervalCount)

    await db.$transaction(async (tx) => {
      // Re-check inside the txn so a retry for the same date can't double-generate (AC-REC-003).
      const fresh = await tx.recurringInvoiceProfile.findUnique({ where: { id: p.id }, select: { nextIssueDate: true, status: true } })
      if (!fresh || !isDue(fresh.nextIssueDate, asOf, fresh.status as 'active' | 'paused')) return
      const invoice = await tx.invoice.create({
        data: {
          accountId,
          clientId: p.clientId,
          status: 'draft',
          currency: client?.currency ?? 'USD',
          paymentTerm: p.paymentTerm as PaymentTerm,
          subject: p.subject,
          notes: p.notes,
          subtotalCents: subtotal,
          totalCents: subtotal,
        },
      })
      let sortOrder = 0
      for (const li of lines) {
        await tx.invoiceLineItem.create({
          data: {
            accountId,
            invoiceId: invoice.id,
            kind: 'free_form',
            description: li.description,
            quantity: li.quantity,
            unitPriceCents: li.unitPriceCents,
            amountCents: li.amountCents,
            taxable: false,
            sortOrder: sortOrder++,
          },
        })
      }
      await tx.recurringInvoiceProfile.update({ where: { id: p.id }, data: { nextIssueDate: nextDate } })
      created++
    })
  }
  return created
}

export async function generateDueAction(): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  await generateDueRecurring(prisma, actor.accountId, new Date())
  revalidatePath('/recurring')
  revalidatePath('/invoices')
}

export async function toggleRecurringStatusAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const p = await prisma.recurringInvoiceProfile.findFirst({ where: { id, accountId: actor.accountId }, select: { status: true } })
  if (!p) return
  await prisma.recurringInvoiceProfile.update({ where: { id }, data: { status: p.status === 'active' ? 'paused' : 'active' } })
  revalidatePath('/recurring')
}

export async function deleteRecurringAction(formData: FormData): Promise<void> {
  const actor = await requireInvoiceAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const p = await prisma.recurringInvoiceProfile.findFirst({ where: { id, accountId: actor.accountId }, select: { id: true } })
  if (!p) return
  await prisma.recurringInvoiceProfile.delete({ where: { id } })
  revalidatePath('/recurring')
}
