/**
 * Invoicing go-live guards against a live (seeded) DB: double-billing race (INV-4), fixed-fee
 * exclusion, missing-rate block, atomic numbering with imported collisions (INV-6), re-send keeps
 * the number, payment SUM recompute, and paid-invoice delete / mark-as-draft blocks.
 *
 * Creates its own client/projects in acc_demo and removes them afterwards.
 * Run with: npm run test:integration (DATABASE_URL must point at a throwaway, seeded DB).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/prisma'
import { generateInvoice, GenerateInvoiceError } from './generateInvoice'
import { sendInvoice, markInvoiceDraft, deleteInvoice } from './invoiceLifecycle'
import { recordPayment, deletePayment } from './recordPayment'

const A = 'acc_demo'
const tag = `it_${Date.now()}`
let clientId = ''
let tmProjectId = ''
let ffProjectId = ''

const day = (s: string) => new Date(`${s}T00:00:00.000Z`)

beforeAll(async () => {
  const client = await prisma.client.create({ data: { accountId: A, name: `Client ${tag}`, currency: 'USD' } })
  clientId = client.id
  const tm = await prisma.project.create({
    data: { accountId: A, clientId, name: `TM ${tag}`, projectType: 'time_and_materials', billableRateMethod: 'project', projectHourlyRateCents: 15000 },
  })
  tmProjectId = tm.id
  const ff = await prisma.project.create({
    data: { accountId: A, clientId, name: `FF ${tag}`, projectType: 'fixed_fee', projectFeesCents: 500000 },
  })
  ffProjectId = ff.id
  await prisma.timeEntry.createMany({
    data: [
      { accountId: A, userId: 'usr_alice', projectId: tmProjectId, taskId: 'task_design', spentDate: day('2026-08-03'), minutes: 20, isBillable: true, billableRateCents: 15000 },
      { accountId: A, userId: 'usr_alice', projectId: tmProjectId, taskId: 'task_design', spentDate: day('2026-08-04'), minutes: 60, isBillable: true, billableRateCents: null },
      { accountId: A, userId: 'usr_bob', projectId: ffProjectId, taskId: 'task_dev', spentDate: day('2026-08-04'), minutes: 600, isBillable: true, billableRateCents: 0 },
    ],
  })
})

afterAll(async () => {
  const invs = await prisma.invoice.findMany({ where: { clientId }, select: { id: true } })
  await prisma.timeEntry.deleteMany({ where: { projectId: { in: [tmProjectId, ffProjectId] } } })
  await prisma.invoice.deleteMany({ where: { id: { in: invs.map((i) => i.id) } } })
  await prisma.client.deleteMany({ where: { id: clientId } })
  await prisma.$disconnect()
})

describe('invoicing go-live guards (live DB)', () => {
  let invoiceId = ''

  it('concurrent generations: exactly one wins, the other rolls back (INV-4); fixed-fee time skipped; missing rate re-derived', async () => {
    const results = await Promise.allSettled([
      generateInvoice(prisma, { accountId: A, clientId }),
      generateInvoice(prisma, { accountId: A, clientId }),
    ])
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value)
    const failed = results.filter((r) => r.status === 'rejected')
    expect(ok).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(GenerateInvoiceError)
    invoiceId = (ok[0] as PromiseFulfilledResult<{ id: string }>).value.id

    const invs = await prisma.invoice.findMany({ where: { clientId } })
    expect(invs).toHaveLength(1) // the loser left no orphan draft
    const lines = await prisma.invoiceLineItem.findMany({ where: { invoiceId } })
    expect(lines).toHaveLength(1)
    expect(Number(lines[0].quantity)).toBe(1.33) // 80 min
    expect(lines[0].amountCents).toBe(19950) // 1.33 × $150
    expect(lines.some((l) => l.kind === 'flat')).toBe(false)
    const ff = await prisma.timeEntry.findFirst({ where: { projectId: ffProjectId } })
    expect(ff?.invoiceLineItemId).toBeNull() // fixed-fee time not pulled in
    const fixed = await prisma.timeEntry.findFirst({ where: { projectId: tmProjectId, minutes: 60 } })
    expect(fixed?.billableRateCents).toBe(15000) // re-derived via resolveRate, persisted
  })

  it('blocks generation when a billable entry has no resolvable rate', async () => {
    const p = await prisma.project.create({ data: { accountId: A, clientId, name: `NoRate ${tag}`, projectType: 'time_and_materials', billableRateMethod: 'none' } })
    await prisma.timeEntry.create({ data: { accountId: A, userId: 'usr_bob', projectId: p.id, taskId: 'task_pm', spentDate: day('2026-08-05'), minutes: 30, isBillable: true } })
    await expect(generateInvoice(prisma, { accountId: A, clientId })).rejects.toThrow(/no hourly rate for NoRate/)
    await prisma.timeEntry.deleteMany({ where: { projectId: p.id } })
    await prisma.project.delete({ where: { id: p.id } })
  })

  it('send allocates atomically, skips an imported number collision, and a re-send keeps the number', async () => {
    const acct = await prisma.account.findUniqueOrThrow({ where: { id: A }, select: { invoiceNumberSeq: true } })
    const next = acct.invoiceNumberSeq + 1
    // An imported invoice already holds the next number.
    const imported = await prisma.invoice.create({ data: { accountId: A, clientId, status: 'paid', number: String(next) } })
    const sent = await sendInvoice(prisma, invoiceId)
    expect(sent.number).toBe(String(next + 1))
    expect(sent.issueDate).not.toBeNull()
    const after = await prisma.account.findUniqueOrThrow({ where: { id: A }, select: { invoiceNumberSeq: true } })
    expect(after.invoiceNumberSeq).toBe(next + 1)
    await prisma.invoice.delete({ where: { id: imported.id } })

    await prisma.invoice.update({ where: { id: invoiceId }, data: { issueDate: day('2026-08-01') } })
    await markInvoiceDraft(prisma, invoiceId)
    const resent = await sendInvoice(prisma, invoiceId)
    expect(resent.number).toBe(String(next + 1)) // AC-INV-013
    expect(resent.issueDate).toEqual(day('2026-08-01')) // existing date kept
    const again = await prisma.account.findUniqueOrThrow({ where: { id: A }, select: { invoiceNumberSeq: true } })
    expect(again.invoiceNumberSeq).toBe(next + 1) // no number consumed
  })

  it('recurring: a profile far behind issues ONE invoice and jumps to a future date; a bad profile is isolated', async () => {
    const good = await prisma.recurringInvoiceProfile.create({
      data: {
        accountId: A, clientId, subject: `Rec ${tag}`, frequency: 'weekly', nextIssueDate: day('2026-01-05'), amountCents: 1000,
        templateLineItems: [{ description: 'Support', quantity: 1, unitPriceCents: 1000, amountCents: 1000, taxable: true }],
      },
    })
    const bad = await prisma.recurringInvoiceProfile.create({
      data: { accountId: A, clientId, subject: `Bad ${tag}`, frequency: 'weekly', nextIssueDate: day('2026-01-05'), amountCents: 0, templateLineItems: [] },
    })
    const { generateDueRecurring } = await import('./generateRecurring')
    const r = await generateDueRecurring(prisma, A, new Date('2026-03-02T12:00:00Z'))
    expect(r.errors.map((e) => e.profileId)).toContain(bad.id)
    const made = await prisma.invoice.findMany({ where: { clientId, subject: `Rec ${tag}` }, include: { lineItems: true } })
    expect(made).toHaveLength(1)
    expect(made[0].lineItems[0].taxable).toBe(true)
    const g = await prisma.recurringInvoiceProfile.findUniqueOrThrow({ where: { id: good.id } })
    expect(g.nextIssueDate).toEqual(day('2026-03-09'))
    await prisma.recurringInvoiceProfile.deleteMany({ where: { id: { in: [good.id, bad.id] } } })
  })

  it('paidCents = SUM(payments); delete / mark-as-draft blocked once paid', async () => {
    await Promise.all([
      recordPayment(prisma, { invoiceId, amountCents: 5000, paidOn: day('2026-08-10'), method: 'check' }),
      recordPayment(prisma, { invoiceId, amountCents: 4950, paidOn: day('2026-08-10'), method: 'check' }),
    ])
    let inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })
    expect(inv.paidCents).toBe(9950)
    await expect(markInvoiceDraft(prisma, invoiceId)).rejects.toThrow(/payments have been recorded/)
    await expect(deleteInvoice(prisma, invoiceId)).rejects.toThrow(/payments have been recorded/)

    const pay = await prisma.payment.findFirstOrThrow({ where: { invoiceId, amountCents: 5000 } })
    await deletePayment(prisma, A, pay.id)
    inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })
    expect(inv.paidCents).toBe(4950)
    expect(inv.status).toBe('open')

    // Written-off invoices: payments can no longer be removed.
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'written_off' } })
    const remaining = await prisma.payment.findFirstOrThrow({ where: { invoiceId } })
    await expect(deletePayment(prisma, A, remaining.id)).rejects.toThrow(/Illegal invoice transition/)
  })
})
