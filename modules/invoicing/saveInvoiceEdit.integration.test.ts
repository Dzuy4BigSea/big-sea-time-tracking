/**
 * Harvest-style invoice editor against a live (seeded) DB (specs/05 AC-INV-019…022): edit + add +
 * remove lines in one save, removed lines release their time (INV-4), total can't drop below paid,
 * Invoice ID uniqueness / never-reuse and the sequence bump (INV-6).
 *
 * Creates its own client/project/invoices in acc_demo and removes them afterwards; restores the
 * account's invoice sequence.
 * Run with: npm run test:integration (DATABASE_URL must point at a throwaway, seeded DB).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/prisma'
import { generateInvoice } from './generateInvoice'
import { sendInvoice } from './invoiceLifecycle'
import { recordPayment } from './recordPayment'
import { saveInvoiceEdit, type InvoiceEditInput } from './saveInvoiceEdit'

const A = 'acc_demo'
const tag = `ie_${Date.now()}`
let clientId = ''
let projectId = ''
let invoiceId = ''
let seqBefore = 0
const auditIds: string[] = []

const day = (s: string) => new Date(`${s}T00:00:00.000Z`)

async function input(over: Partial<InvoiceEditInput> = {}): Promise<InvoiceEditInput> {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lineItems: { orderBy: { sortOrder: 'asc' } } } })
  return {
    number: inv.number ?? '',
    subject: inv.subject ?? '',
    poNumber: '',
    notes: '',
    issueDate: inv.issueDate ? inv.issueDate.toISOString().slice(0, 10) : '',
    paymentTerm: inv.paymentTerm,
    dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : '',
    discountPercent: '',
    tax1Name: '',
    tax1Percent: '',
    tax2Name: '',
    tax2Percent: '',
    currency: inv.currency,
    acceptOnlinePayments: true,
    allowCardPayments: true,
    allowAchPayments: true,
    lines: inv.lineItems.map((l) => ({
      id: l.id,
      itemTypeId: l.itemTypeId,
      description: l.description,
      quantity: String(Number(l.quantity)),
      unitPrice: (l.unitPriceCents / 100).toFixed(2),
      linkedProjectId: l.linkedProjectId,
      taxable: l.taxable,
    })),
    ...over,
  }
}

beforeAll(async () => {
  seqBefore = (await prisma.account.findUniqueOrThrow({ where: { id: A }, select: { invoiceNumberSeq: true } })).invoiceNumberSeq
  const client = await prisma.client.create({ data: { accountId: A, name: `Client ${tag}`, currency: 'USD' } })
  clientId = client.id
  const p = await prisma.project.create({
    data: { accountId: A, clientId, name: `TM ${tag}`, projectType: 'time_and_materials', billableRateMethod: 'project', projectHourlyRateCents: 10000 },
  })
  projectId = p.id
  await prisma.timeEntry.createMany({
    data: [
      { accountId: A, userId: 'usr_alice', projectId, taskId: 'task_design', spentDate: day('2026-08-03'), minutes: 120, isBillable: true, billableRateCents: 10000 },
      { accountId: A, userId: 'usr_alice', projectId, taskId: 'task_dev', spentDate: day('2026-08-04'), minutes: 60, isBillable: true, billableRateCents: 10000 },
    ],
  })
  const inv = await generateInvoice(prisma, { accountId: A, clientId })
  invoiceId = inv!.id
  await sendInvoice(prisma, invoiceId)
})

afterAll(async () => {
  const invs = await prisma.invoice.findMany({ where: { clientId }, select: { id: true } })
  await prisma.timeEntry.deleteMany({ where: { projectId } })
  await prisma.invoice.deleteMany({ where: { id: { in: invs.map((i) => i.id) } } })
  await prisma.auditLog.deleteMany({ where: { id: { in: auditIds } } })
  await prisma.client.deleteMany({ where: { id: clientId } })
  await prisma.account.update({ where: { id: A }, data: { invoiceNumberSeq: seqBefore } })
  await prisma.$disconnect()
})

describe('saveInvoiceEdit (live DB)', () => {
  it('edit + add + remove + reorder in one save; removed line releases its time (AC-INV-019/020)', async () => {
    const base = await input()
    expect(base.lines).toHaveLength(2) // by task: Design 2h, Dev 1h
    const [design, dev] = base.lines
    const devEntry = await prisma.timeEntry.findFirstOrThrow({ where: { projectId, taskId: 'task_dev' } })
    expect(devEntry.lockState).toBe('invoiced')

    const r = await saveInvoiceEdit(prisma, A, invoiceId, {
      ...base,
      lines: [
        { id: null, description: 'Hosting', quantity: '1', unitPrice: '50.00' },
        { ...design, description: 'Design work', quantity: '2.5' },
        // dev removed
      ],
    })
    expect(r).toMatchObject({ ok: true, summary: 'Invoice updated (1 line added, 1 line changed, 1 line removed)' })

    const lines = await prisma.invoiceLineItem.findMany({ where: { invoiceId }, orderBy: { sortOrder: 'asc' } })
    expect(lines.map((l) => [l.description, Number(l.quantity), l.amountCents, l.sortOrder])).toEqual([
      ['Hosting', 1, 5000, 0],
      ['Design work', 2.5, 25000, 1],
    ])
    expect(lines.find((l) => l.id === dev.id)).toBeUndefined()
    const released = await prisma.timeEntry.findUniqueOrThrow({ where: { id: devEntry.id } })
    expect(released.invoiceLineItemId).toBeNull()
    expect(released.lockState).toBe('open')
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })
    expect(inv.totalCents).toBe(30000)
    expect(inv.status).toBe('open')
  })

  it('refuses a total below what has been paid, changing nothing (AC-INV-021)', async () => {
    await recordPayment(prisma, { invoiceId, amountCents: 20000, paidOn: day('2026-08-10'), method: 'bank_transfer' })
    const base = await input()
    const r = await saveInvoiceEdit(prisma, A, invoiceId, { ...base, lines: [base.lines[0]] }) // $50 < $200 paid
    expect(r.ok).toBe(false)
    const lines = await prisma.invoiceLineItem.count({ where: { invoiceId } })
    expect(lines).toBe(2)
  })

  it('Invoice ID: higher number moves the sequence; taken / retired numbers refused (AC-INV-022)', async () => {
    const other = await prisma.invoice.findFirstOrThrow({ where: { accountId: A, number: { not: null }, id: { not: invoiceId } }, select: { number: true } })
    const base = await input()
    const taken = await saveInvoiceEdit(prisma, A, invoiceId, { ...base, number: other.number! })
    expect(taken).toEqual({ ok: false, error: `Invoice ID ${other.number} is already used by another invoice.` })

    const retiredNo = `R${Date.now()}`
    const a = await prisma.auditLog.create({ data: { accountId: A, entityType: 'invoice', entityId: 'gone', action: 'delete', after: { summary: 'x', retiredNumber: retiredNo } } })
    auditIds.push(a.id)
    const retired = await saveInvoiceEdit(prisma, A, invoiceId, { ...base, number: retiredNo })
    expect(retired.ok).toBe(false)

    const seq = (await prisma.account.findUniqueOrThrow({ where: { id: A }, select: { invoiceNumberSeq: true } })).invoiceNumberSeq
    const high = String(seq + 5000)
    const ok = await saveInvoiceEdit(prisma, A, invoiceId, { ...base, number: high })
    expect(ok).toMatchObject({ ok: true, renumbered: { from: base.number, to: high } })
    const after = await prisma.account.findUniqueOrThrow({ where: { id: A }, select: { invoiceNumberSeq: true } })
    expect(after.invoiceNumberSeq).toBe(seq + 5000)

    // The next invoice follows the new sequence.
    const draft = await prisma.invoice.create({
      data: {
        accountId: A,
        clientId,
        status: 'draft',
        currency: 'USD',
        totalCents: 100,
        subtotalCents: 100,
        lineItems: { create: [{ accountId: A, description: 'x', quantity: 1, unitPriceCents: 100, amountCents: 100 }] },
      },
    })
    const sent = await sendInvoice(prisma, draft.id)
    expect(sent.number).toBe(String(seq + 5001))
  })

  it('a paid invoice is read-only', async () => {
    const base = await input()
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'paid' } })
    const r = await saveInvoiceEdit(prisma, A, invoiceId, base)
    expect(r).toEqual({ ok: false, error: 'This invoice can no longer be edited.' })
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'open' } })
  })
})
