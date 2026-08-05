/**
 * recordPayment — apply a payment to an invoice via the guarded state machine (specs/05).
 *
 * Uses applyInvoiceAction('record_payment') for the guard (must be open, no overpayment)
 * and the paid-driven status derivation, then writes the Payment + updated invoice in a txn.
 */
import type { PrismaClient, PaymentMethod } from '@prisma/client'
import { applyInvoiceAction, type StoredStatus } from '@/modules/invoicing/invoiceState'

export interface RecordPaymentInput {
  invoiceId: string
  amountCents: number
  paidOn: Date
  method: PaymentMethod
  note?: string
  allowOverpayment?: boolean
}

export async function recordPayment(prisma: PrismaClient, input: RecordPaymentInput) {
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: input.invoiceId },
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

  const result = applyInvoiceAction(
    {
      status: inv.status as StoredStatus,
      totalCents: inv.totalCents,
      paidCents: inv.paidCents,
      lineItemCount: inv._count.lineItems,
      sentAt: inv.sentAt,
      number: inv.number,
    },
    'record_payment',
    { amountCents: input.amountCents, allowOverpayment: input.allowOverpayment },
  )

  return prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        accountId: inv.accountId,
        invoiceId: input.invoiceId,
        amountCents: input.amountCents,
        paidOn: input.paidOn,
        method: input.method,
        note: input.note,
      },
    })
    return tx.invoice.update({
      where: { id: input.invoiceId },
      data: { paidCents: result.paidCents, status: result.status },
    })
  })
}
