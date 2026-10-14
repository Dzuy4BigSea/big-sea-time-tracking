/**
 * Record a Stripe payment exactly once (specs/14 AC-STRIPE-002/003).
 *
 * Wraps recordPayment (the guarded state machine, INV-7) and turns its two expected refusals into
 * outcomes the webhook can answer with 200 instead of a retry-forever 500:
 * - a concurrent delivery of the same payment hit Payment.stripeChargeId's unique index → 'duplicate'
 * - the invoice left 'open' between the webhook's read and the locked write → 'not_open'
 * Anything else (DB down) is thrown so the webhook answers 500 and Stripe retries.
 */
import { Prisma, type PrismaClient, type PaymentMethod } from '@prisma/client'
import { recordPayment } from '@/modules/invoicing/recordPayment'
import { InvalidTransitionError } from '@/modules/invoicing/invoiceState'

export interface StripePaymentInput {
  invoiceId: string
  amountCents: number
  paidOn: Date
  method: PaymentMethod
  /** The PaymentIntent id (or charge/session id when there is none): Payment.stripeChargeId. */
  key: string
}

export type StripeRecordOutcome =
  | { outcome: 'recorded'; paymentId: string | null; paidCents: number; totalCents: number; status: string }
  | { outcome: 'duplicate' }
  | { outcome: 'not_open'; reason: string }

export function isUniqueViolation(e: unknown): boolean {
  return (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') || (e as { code?: string } | null)?.code === 'P2002'
}

export async function recordStripePaymentOnce(prisma: PrismaClient, input: StripePaymentInput): Promise<StripeRecordOutcome> {
  let inv: Awaited<ReturnType<typeof recordPayment>>
  try {
    inv = await recordPayment(prisma, {
      invoiceId: input.invoiceId,
      amountCents: input.amountCents,
      paidOn: input.paidOn,
      method: input.method,
      source: 'stripe',
      stripeChargeId: input.key,
      allowOverpayment: true, // money genuinely received; never reject a real payment (it is flagged instead)
      note: 'Paid online via Stripe',
    })
  } catch (e) {
    if (isUniqueViolation(e)) return { outcome: 'duplicate' }
    if (e instanceof InvalidTransitionError) return { outcome: 'not_open', reason: e.message }
    throw e
  }
  const payment = await prisma.payment.findUnique({ where: { stripeChargeId: input.key }, select: { id: true } }).catch(() => null)
  return { outcome: 'recorded', paymentId: payment?.id ?? null, paidCents: inv.paidCents, totalCents: inv.totalCents, status: inv.status }
}
