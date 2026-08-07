/**
 * Invoice lifecycle transitions that mutate the DB (specs/05).
 *
 * sendInvoice: draft → open — assigns the next sequential number (bumps the account
 *   sequence, INV-6), stamps issue/due dates + a public token, and LOCKS the linked
 *   time/expense entries (lockState 'invoiced', INV-3).
 * markInvoiceDraft: open → draft — unlocks the linked entries back to 'open' (they stay
 *   reserved to this draft via invoiceLineItemId), keeping the assigned number.
 *
 * Both use applyInvoiceAction for the guard (throws on an illegal transition, INV-7).
 */
import type { PrismaClient } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { applyInvoiceAction, type StoredStatus } from '@/modules/invoicing/invoiceState'

const TERM_DAYS: Record<string, number> = {
  due_on_receipt: 0,
  net_15: 15,
  net_30: 30,
  net_45: 45,
  net_60: 60,
  custom: 30,
}
const dateOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
const addDays = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n))

export async function sendInvoice(prisma: PrismaClient, invoiceId: string, now: Date = new Date()) {
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      accountId: true,
      status: true,
      totalCents: true,
      paidCents: true,
      number: true,
      sentAt: true,
      paymentTerm: true,
      _count: { select: { lineItems: true } },
      lineItems: { select: { id: true } },
    },
  })
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: inv.accountId },
    select: { invoiceNumberSeq: true },
  })

  const result = applyInvoiceAction(
    {
      status: inv.status as StoredStatus,
      totalCents: inv.totalCents,
      paidCents: inv.paidCents,
      lineItemCount: inv._count.lineItems,
      sentAt: inv.sentAt,
      number: inv.number,
    },
    'send',
    { lastInvoiceNumberSeq: account.invoiceNumberSeq },
  )

  const issueDate = dateOnly(now)
  const dueDate = addDays(issueDate, TERM_DAYS[inv.paymentTerm] ?? 30)
  const publicToken = randomBytes(24).toString('hex')
  const lineItemIds = inv.lineItems.map((li) => li.id)

  return prisma.$transaction(async (tx) => {
    await tx.account.update({
      where: { id: inv.accountId },
      data: { invoiceNumberSeq: result.effects.nextInvoiceNumberSeq! },
    })
    if (lineItemIds.length > 0) {
      await tx.timeEntry.updateMany({ where: { invoiceLineItemId: { in: lineItemIds } }, data: { lockState: 'invoiced' } })
      await tx.expense.updateMany({ where: { invoiceLineItemId: { in: lineItemIds } }, data: { lockState: 'invoiced' } })
    }
    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'open',
        number: result.effects.assignNumber,
        sentAt: now,
        issueDate,
        dueDate,
        publicToken,
      },
    })
  })
}

/** Delete an invoice (draft or sent), releasing its reserved entries back to the pool. */
export async function deleteInvoice(prisma: PrismaClient, invoiceId: string) {
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      status: true,
      totalCents: true,
      paidCents: true,
      number: true,
      sentAt: true,
      _count: { select: { lineItems: true } },
      lineItems: { select: { id: true } },
    },
  })

  applyInvoiceAction(
    {
      status: inv.status as StoredStatus,
      totalCents: inv.totalCents,
      paidCents: inv.paidCents,
      lineItemCount: inv._count.lineItems,
      sentAt: inv.sentAt,
      number: inv.number,
    },
    'delete',
  )

  const lineItemIds = inv.lineItems.map((li) => li.id)
  await prisma.$transaction(async (tx) => {
    if (lineItemIds.length > 0) {
      // Release: unlink + unlock so entries return to the uninvoiced pool.
      await tx.timeEntry.updateMany({
        where: { invoiceLineItemId: { in: lineItemIds } },
        data: { invoiceLineItemId: null, lockState: 'open' },
      })
      await tx.expense.updateMany({
        where: { invoiceLineItemId: { in: lineItemIds } },
        data: { invoiceLineItemId: null, lockState: 'open' },
      })
    }
    await tx.invoice.delete({ where: { id: invoiceId } }) // cascades line items + payments
  })
}

/** Write off an open invoice (open → written_off). Linked entries stay locked (they were billed). */
export async function writeOffInvoice(prisma: PrismaClient, invoiceId: string) {
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      status: true,
      totalCents: true,
      paidCents: true,
      number: true,
      sentAt: true,
      _count: { select: { lineItems: true } },
    },
  })
  applyInvoiceAction(
    { status: inv.status as StoredStatus, totalCents: inv.totalCents, paidCents: inv.paidCents, lineItemCount: inv._count.lineItems, sentAt: inv.sentAt, number: inv.number },
    'write_off',
  )
  return prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'written_off' } })
}

export async function markInvoiceDraft(prisma: PrismaClient, invoiceId: string) {
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      status: true,
      totalCents: true,
      paidCents: true,
      number: true,
      sentAt: true,
      _count: { select: { lineItems: true } },
      lineItems: { select: { id: true } },
    },
  })

  applyInvoiceAction(
    {
      status: inv.status as StoredStatus,
      totalCents: inv.totalCents,
      paidCents: inv.paidCents,
      lineItemCount: inv._count.lineItems,
      sentAt: inv.sentAt,
      number: inv.number,
    },
    'mark_as_draft',
  )

  const lineItemIds = inv.lineItems.map((li) => li.id)
  return prisma.$transaction(async (tx) => {
    if (lineItemIds.length > 0) {
      await tx.timeEntry.updateMany({ where: { invoiceLineItemId: { in: lineItemIds } }, data: { lockState: 'open' } })
      await tx.expense.updateMany({ where: { invoiceLineItemId: { in: lineItemIds } }, data: { lockState: 'open' } })
    }
    return tx.invoice.update({ where: { id: invoiceId }, data: { status: 'draft' } })
  })
}
