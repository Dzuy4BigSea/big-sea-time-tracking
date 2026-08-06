'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { can, type PermissionProfile } from '@/modules/shared/permissions'
import { getModules } from '@/lib/modules'
import { computeTotals } from '@/modules/invoicing/totals'

export type EstimateState = { error?: string; ok?: boolean }

const centsFrom = (raw: FormDataEntryValue | null): number | null => {
  const n = Number(String(raw ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}

async function requireEstimateAdmin() {
  const actor = await requireUser()
  if (!can({ permissionProfile: actor.permissionProfile as PermissionProfile }, 'manage_invoices')) return null
  const modules = await getModules(actor.accountId)
  if (!modules.estimates) return null // AC-MOD: module off → no estimate mutations
  return actor
}

export async function createEstimateAction(_prev: EstimateState, formData: FormData): Promise<EstimateState> {
  const actor = await requireEstimateAdmin()
  if (!actor) return { error: 'You do not have permission (or the Estimates module is off).' }

  const clientId = String(formData.get('clientId') ?? '')
  const subject = String(formData.get('subject') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || subject || 'Estimate'
  const amountCents = centsFrom(formData.get('amount'))

  const client = await prisma.client.findFirst({ where: { id: clientId, accountId: actor.accountId }, select: { id: true, currency: true } })
  if (!client) return { error: 'Pick a client.' }
  if (!amountCents) return { error: 'Enter an amount.' }

  const totals = computeTotals({ lineItems: [{ amountCents, taxable: false }] })

  try {
    await prisma.estimate.create({
      data: {
        accountId: actor.accountId,
        clientId,
        currency: client.currency,
        status: 'draft',
        subject: subject || null,
        subtotalCents: totals.subtotalCents,
        totalCents: totals.totalCents,
        lineItems: {
          create: [{ accountId: actor.accountId, description, quantity: 1, unitPriceCents: amountCents, amountCents, taxable: false, sortOrder: 0 }],
        },
      },
    })
  } catch {
    return { error: 'Could not create the estimate.' }
  }
  revalidatePath('/estimates')
  return { ok: true }
}

async function scopedEstimate(id: string, accountId: string) {
  return prisma.estimate.findFirst({ where: { id, accountId } })
}

/** AC-EST-001: draft → sent, assigns a number from the SEPARATE estimate sequence + a public token. */
export async function sendEstimateAction(formData: FormData): Promise<void> {
  const actor = await requireEstimateAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const est = await scopedEstimate(id, actor.accountId)
  if (!est || est.status !== 'draft') return

  await prisma.$transaction(async (tx) => {
    const account = await tx.account.findUniqueOrThrow({ where: { id: actor.accountId }, select: { estimateNumberSeq: true } })
    const nextSeq = account.estimateNumberSeq + 1
    await tx.account.update({ where: { id: actor.accountId }, data: { estimateNumberSeq: nextSeq } })
    await tx.estimate.update({
      where: { id },
      data: { status: 'sent', number: String(nextSeq), sentAt: new Date(), publicToken: randomBytes(24).toString('hex') },
    })
  })
  revalidatePath('/estimates')
  revalidatePath(`/estimates/${id}`)
}

/** AC-EST-002 */
export async function setEstimateStatusAction(formData: FormData): Promise<void> {
  const actor = await requireEstimateAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const target = String(formData.get('status') ?? '')
  if (target !== 'accepted' && target !== 'declined') return
  const est = await scopedEstimate(id, actor.accountId)
  if (!est || est.status !== 'sent') return
  await prisma.estimate.update({ where: { id }, data: { status: target } })
  revalidatePath('/estimates')
  revalidatePath(`/estimates/${id}`)
}

/** AC-EST-003/004: convert an accepted/sent estimate into a draft invoice, at most once. */
export async function convertEstimateAction(formData: FormData): Promise<void> {
  const actor = await requireEstimateAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const est = await prisma.estimate.findFirst({
    where: { id, accountId: actor.accountId },
    include: { lineItems: { orderBy: { sortOrder: 'asc' } }, convertedInvoice: { select: { id: true } } },
  })
  if (!est) return
  if (est.status !== 'sent' && est.status !== 'accepted') return
  if (est.convertedInvoice) {
    redirect(`/invoices/${est.convertedInvoice.id}`) // AC-EST-004: already converted
  }

  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        accountId: actor.accountId,
        clientId: est.clientId,
        status: 'draft',
        currency: est.currency,
        paymentTerm: 'net_30',
        subject: est.subject,
        notes: est.notes,
        discountPercent: est.discountPercent,
        discountCents: est.discountCents,
        tax1Name: est.tax1Name,
        tax1Percent: est.tax1Percent,
        tax2Name: est.tax2Name,
        tax2Percent: est.tax2Percent,
        taxCents: est.taxCents,
        subtotalCents: est.subtotalCents,
        totalCents: est.totalCents,
        createdFromEstimateId: est.id,
      },
    })
    let sortOrder = 0
    for (const li of est.lineItems) {
      await tx.invoiceLineItem.create({
        data: {
          accountId: actor.accountId,
          invoiceId: inv.id,
          kind: 'free_form',
          description: li.description,
          quantity: li.quantity,
          unitPriceCents: li.unitPriceCents,
          amountCents: li.amountCents,
          taxable: li.taxable,
          sortOrder: sortOrder++,
        },
      })
    }
    return inv
  })

  revalidatePath('/estimates')
  revalidatePath('/invoices')
  redirect(`/invoices/${invoice.id}`)
}

export async function deleteEstimateAction(formData: FormData): Promise<void> {
  const actor = await requireEstimateAdmin()
  if (!actor) return
  const id = String(formData.get('id') ?? '')
  const est = await prisma.estimate.findFirst({ where: { id, accountId: actor.accountId }, select: { status: true } })
  if (!est || est.status !== 'draft') return // only drafts are deletable
  await prisma.estimate.delete({ where: { id } })
  revalidatePath('/estimates')
  redirect('/estimates')
}
