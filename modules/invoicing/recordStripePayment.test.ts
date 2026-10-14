import { describe, it, expect } from 'vitest'
import { Prisma, type PrismaClient } from '@prisma/client'
import { recordStripePaymentOnce } from './recordStripePayment'

const input = { invoiceId: 'inv_1', amountCents: 500, paidOn: new Date('2026-10-14'), method: 'card' as const, key: 'pi_1' }

/** A fake Prisma whose transaction runs `tx` against an invoice row and a payment unique index. */
function fakePrisma(opts: { status?: string; existingKeys?: string[]; txError?: Error } = {}) {
  const keys = new Set(opts.existingKeys ?? [])
  let paid = 0
  const tx = {
    $queryRaw: async () => [],
    invoice: {
      findUniqueOrThrow: async () => ({ accountId: 'acc', status: opts.status ?? 'open', totalCents: 500, paidCents: paid, number: '1', sentAt: new Date(), _count: { lineItems: 1 } }),
      update: async ({ data }: { data: { paidCents: number; status: string } }) => ({ id: 'inv_1', totalCents: 500, ...data }),
    },
    payment: {
      create: async ({ data }: { data: { stripeChargeId: string; amountCents: number } }) => {
        if (keys.has(data.stripeChargeId)) throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5' })
        keys.add(data.stripeChargeId)
        paid += data.amountCents
      },
      aggregate: async () => ({ _sum: { amountCents: paid } }),
    },
  }
  return {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      if (opts.txError) throw opts.txError
      return fn(tx)
    },
    payment: { findUnique: async () => ({ id: 'pay_1' }) },
  } as unknown as PrismaClient
}

describe('recordStripePaymentOnce', () => {
  it('records through the state machine and returns the payment id + new status', async () => {
    expect(await recordStripePaymentOnce(fakePrisma(), input)).toEqual({ outcome: 'recorded', paymentId: 'pay_1', paidCents: 500, totalCents: 500, status: 'paid' })
  })
  it('unique-key violation (concurrent duplicate delivery) → duplicate, not an error', async () => {
    expect(await recordStripePaymentOnce(fakePrisma({ existingKeys: ['pi_1'] }), input)).toEqual({ outcome: 'duplicate' })
  })
  it('invoice no longer open (guard inside the locked transaction) → not_open', async () => {
    const r = await recordStripePaymentOnce(fakePrisma({ status: 'written_off' }), input)
    expect(r.outcome).toBe('not_open')
  })
  it('anything else is thrown so Stripe retries', async () => {
    await expect(recordStripePaymentOnce(fakePrisma({ txError: new Error('db down') }), input)).rejects.toThrow('db down')
  })
})
