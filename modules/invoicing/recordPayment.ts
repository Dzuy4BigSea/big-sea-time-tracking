/**
 * recordPayment — apply a payment to an invoice via the guarded state machine (specs/05).
 *
 * Uses applyInvoiceAction('record_payment') for the guard (must be open, no overpayment)
 * and the paid-driven status derivation, then writes the Payment + updated invoice in a txn.
 * The invoice row is locked (FOR UPDATE) and paidCents is recomputed as SUM(payments) inside the
 * transaction, so concurrent payments can't lose an update.
 */
import type { PrismaClient, PaymentMethod, Prisma } from '@prisma/client'
import { applyInvoiceAction, deriveStatusAfterPayment, type StoredStatus } from '@/modules/invoicing/invoiceState'

export interface RecordPaymentInput {
  invoiceId: string
  amountCents: number
  paidOn: Date
  method: PaymentMethod
  note?: string
  allowOverpayment?: boolean
  source?: 'manual' | 'stripe'
  stripeChargeId?: string
}

type Tx = Prisma.TransactionClient

/** Lock the invoice row for the rest of the transaction so concurrent payments serialize. */
async function lockInvoice(tx: Tx, invoiceId: string) {
  await tx.$queryRaw`SELECT 1 FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`
  return tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      accountId: true,
      status: true,
      totalCents: true,
      paidCents: true,
      number: true,
      sentAt: true,
      _count: { select: { lineItems: true } },
    },
  })
}

/** paidCents is always the SUM of the invoice's payments, recomputed inside the transaction. */
async function sumPayments(tx: Tx, invoiceId: string): Promise<number> {
  const agg = await tx.payment.aggregate({ where: { invoiceId }, _sum: { amountCents: true } })
  return agg._sum.amountCents ?? 0
}

const stateOf = (inv: Awaited<ReturnType<typeof lockInvoice>>) => ({
  status: inv.status as StoredStatus,
  totalCents: inv.totalCents,
  paidCents: inv.paidCents,
  lineItemCount: inv._count.lineItems,
  sentAt: inv.sentAt,
  number: inv.number,
})

export async function recordPayment(prisma: PrismaClient, input: RecordPaymentInput) {
  return prisma.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, input.invoiceId)
    // Guard (must be open; no overpayment unless allowed) against the locked, current row.
    applyInvoiceAction(stateOf(inv), 'record_payment', { amountCents: input.amountCents, allowOverpayment: input.allowOverpayment })
    await tx.payment.create({
      data: {
        accountId: inv.accountId,
        invoiceId: input.invoiceId,
        amountCents: input.amountCents,
        paidOn: input.paidOn,
        method: input.method,
        note: input.note,
        source: input.source ?? 'manual',
        stripeChargeId: input.stripeChargeId,
      },
    })
    const paidCents = await sumPayments(tx, input.invoiceId)
    return tx.invoice.update({
      where: { id: input.invoiceId },
      data: { paidCents, status: deriveStatusAfterPayment(inv.totalCents, paidCents) },
    })
  })
}

/**
 * Remove a recorded payment (AC-INV-011) through the state machine: only open/paid invoices
 * (written-off / closed are final), then paidCents = SUM(remaining payments) and status re-derived.
 * Returns null when the payment does not exist in `accountId` (INV-5).
 */
export async function deletePayment(
  prisma: PrismaClient,
  accountId: string,
  paymentId: string,
): Promise<{ invoiceId: string; amountCents: number } | null> {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, accountId }, select: { id: true, invoiceId: true, amountCents: true } })
  if (!payment) return null
  return prisma.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, payment.invoiceId)
    applyInvoiceAction(stateOf(inv), 'delete_payment', { amountCents: payment.amountCents })
    const del = await tx.payment.deleteMany({ where: { id: payment.id, accountId } })
    if (del.count === 0) return null // already removed by a concurrent request
    const paidCents = await sumPayments(tx, payment.invoiceId)
    await tx.invoice.update({
      where: { id: payment.invoiceId },
      data: { paidCents, status: deriveStatusAfterPayment(inv.totalCents, paidCents) },
    })
    return { invoiceId: payment.invoiceId, amountCents: payment.amountCents }
  })
}
