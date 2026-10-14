/**
 * Invoice lifecycle transitions that mutate the DB (specs/05).
 *
 * sendInvoice: draft → open — assigns the next sequential number atomically (bumps the account
 *   sequence in-transaction, skipping numbers already used, INV-6) unless the draft already has one
 *   (re-send after mark-as-draft keeps it), defaults issue/due dates only when unset (issue date =
 *   today in the account timezone), stamps a public token, and LOCKS the linked
 *   time/expense entries (lockState 'invoiced', INV-3).
 * markInvoiceDraft: open → draft — unlocks the linked entries back to 'open' (they stay
 *   reserved to this draft via invoiceLineItemId), keeping the assigned number.
 *
 * mark-as-draft and delete are refused once payments are recorded (paidCents > 0).
 * All use applyInvoiceAction for the guard (throws on an illegal transition, INV-7).
 */
import type { PrismaClient, Prisma } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { applyInvoiceAction, firstFreeInvoiceSeq, InvalidTransitionError, PAID_BLOCK_REASON, type StoredStatus } from '@/modules/invoicing/invoiceState'
import { todayIn } from '@/lib/tz'

const TERM_DAYS: Record<string, number> = {
  due_on_receipt: 0,
  net_15: 15,
  net_30: 30,
  net_45: 45,
  net_60: 60,
  custom: 30,
}
const addDays = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n))

/** Default issue/due dates for a send: keep any dates already set; otherwise today (account tz) + term. */
export function sendDates(
  current: { issueDate: Date | null; dueDate: Date | null; paymentTerm: string },
  today: Date,
): { issueDate: Date; dueDate: Date } {
  const issueDate = current.issueDate ?? today
  const dueDate = current.dueDate ?? addDays(issueDate, TERM_DAYS[current.paymentTerm] ?? 30)
  return { issueDate, dueDate }
}

/**
 * Allocate the next invoice number atomically inside `tx` (INV-6). The UPDATE … RETURNING takes the
 * Account row lock, so concurrent sends serialize. If the number is already used (an imported Harvest
 * number above the sequence), skip forward to the first free one and move the sequence there.
 */
export async function allocateInvoiceNumber(tx: Prisma.TransactionClient, accountId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ seq: number }[]>`
    UPDATE "Account" SET "invoiceNumberSeq" = "invoiceNumberSeq" + 1 WHERE id = ${accountId} RETURNING "invoiceNumberSeq" AS seq`
  if (rows.length === 0) throw new Error('Account not found')
  let seq = Number(rows[0].seq)
  const WINDOW = 500
  for (;;) {
    const candidates = Array.from({ length: WINDOW }, (_, i) => String(seq + i))
    const taken = await tx.invoice.findMany({ where: { accountId, number: { in: candidates } }, select: { number: true } })
    const free = firstFreeInvoiceSeq(seq, taken.map((t) => t.number!))
    if (free < seq + WINDOW) {
      seq = free
      break
    }
    seq += WINDOW
  }
  await tx.$executeRaw`UPDATE "Account" SET "invoiceNumberSeq" = GREATEST("invoiceNumberSeq", ${seq}) WHERE id = ${accountId}`
  return String(seq)
}

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
      issueDate: true,
      dueDate: true,
      publicToken: true,
      account: { select: { timezone: true } },
      _count: { select: { lineItems: true } },
      lineItems: { select: { id: true } },
    },
  })

  // Guard (draft → open, ≥1 line). A draft that was sent before keeps its number (AC-INV-013).
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
  )

  // "Today" is the account's calendar day, not the UTC server day.
  const { issueDate, dueDate } = sendDates(inv, todayIn(inv.account.timezone, now))
  const publicToken = inv.publicToken ?? randomBytes(24).toString('hex')
  const lineItemIds = inv.lineItems.map((li) => li.id)

  return prisma.$transaction(async (tx) => {
    const number = inv.number ?? (await allocateInvoiceNumber(tx, inv.accountId))
    // Claim the draft → open transition; 0 rows means a concurrent send got there first.
    const claimed = await tx.invoice.updateMany({
      where: { id: invoiceId, status: 'draft' },
      data: { status: result.status, number, sentAt: now, issueDate, dueDate, publicToken },
    })
    if (claimed.count === 0) throw new InvalidTransitionError(inv.status as StoredStatus, 'send', 'the invoice was already sent')
    if (lineItemIds.length > 0) {
      await tx.timeEntry.updateMany({ where: { invoiceLineItemId: { in: lineItemIds } }, data: { lockState: 'invoiced' } })
      await tx.expense.updateMany({ where: { invoiceLineItemId: { in: lineItemIds } }, data: { lockState: 'invoiced' } })
    }
    return tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } })
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
      _count: { select: { lineItems: true, payments: true } },
      lineItems: { select: { id: true } },
    },
  })
  if (inv._count.payments > 0) throw new InvalidTransitionError(inv.status as StoredStatus, 'delete', PAID_BLOCK_REASON)

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

/** written_off → open (Harvest "Re-open Invoice", specs/27 AC-STAT-007). Entries stay locked. */
export async function reopenInvoice(prisma: PrismaClient, invoiceId: string) {
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { status: true, totalCents: true, paidCents: true, number: true, sentAt: true, _count: { select: { lineItems: true } } },
  })
  const result = applyInvoiceAction(
    { status: inv.status as StoredStatus, totalCents: inv.totalCents, paidCents: inv.paidCents, lineItemCount: inv._count.lineItems, sentAt: inv.sentAt, number: inv.number },
    'reopen',
  )
  // Guard against a concurrent change: only flip a row that is still written off.
  const { count } = await prisma.invoice.updateMany({ where: { id: invoiceId, status: 'written_off' }, data: { status: result.status } })
  if (count === 0) throw new InvalidTransitionError(inv.status as StoredStatus, 'reopen', 'the invoice changed — reload and try again')
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
      _count: { select: { lineItems: true, payments: true } },
      lineItems: { select: { id: true } },
    },
  })
  if (inv._count.payments > 0) throw new InvalidTransitionError(inv.status as StoredStatus, 'mark_as_draft', PAID_BLOCK_REASON)

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
