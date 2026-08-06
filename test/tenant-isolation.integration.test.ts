/**
 * Tenant isolation (specs/08 §INV-5) — live-DB integration checks.
 *
 * Every read must be scoped by accountId; no query for account A may return account B's rows.
 * Read-only against the seeded database (acc_demo = Big Sea, acc_globex = isolation tenant).
 * Run with: npm run test:integration
 */
import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/prisma'

const A = 'acc_demo'
const B = 'acc_globex'

afterAll(async () => {
  await prisma.$disconnect()
})

describe('tenant isolation (INV-5)', () => {
  it('both seeded accounts exist', async () => {
    const accounts = await prisma.account.findMany({ where: { id: { in: [A, B] } }, select: { id: true } })
    expect(accounts.map((a) => a.id).sort()).toEqual([A, B].sort())
  })

  it('clients are partitioned by account (no overlap)', async () => {
    const [aClients, bClients] = await Promise.all([
      prisma.client.findMany({ where: { accountId: A }, select: { id: true } }),
      prisma.client.findMany({ where: { accountId: B }, select: { id: true } }),
    ])
    expect(aClients.length).toBeGreaterThan(0)
    expect(bClients.length).toBeGreaterThan(0)
    const aIds = new Set(aClients.map((c) => c.id))
    expect(bClients.some((c) => aIds.has(c.id))).toBe(false)
  })

  it('a B-scoped client query never returns A rows (and vice versa)', async () => {
    // Globex's seeded client (Initech) must not appear under acc_demo.
    const initech = await prisma.client.findFirst({ where: { accountId: B }, select: { id: true, accountId: true } })
    expect(initech).not.toBeNull()
    const leak = await prisma.client.findFirst({ where: { id: initech!.id, accountId: A } })
    expect(leak).toBeNull() // the classic app-query shape { id, accountId } cannot cross tenants
  })

  it('invoices, projects, time entries, expenses each carry a single account and never straddle', async () => {
    for (const model of ['invoice', 'project', 'timeEntry', 'expense'] as const) {
      // Any row that belongs to B must not be returned by an A-scoped query.
      const bRow = await (prisma[model] as any).findFirst({ where: { accountId: B }, select: { id: true } })
      if (!bRow) continue
      const crossed = await (prisma[model] as any).findFirst({ where: { id: bRow.id, accountId: A } })
      expect(crossed, `${model} ${bRow.id} leaked into account A`).toBeNull()
    }
  })

  it("invoice line items inherit their invoice's account", async () => {
    const items = await prisma.invoiceLineItem.findMany({
      where: { accountId: A },
      select: { accountId: true, invoice: { select: { accountId: true } } },
      take: 200,
    })
    for (const li of items) expect(li.invoice.accountId).toBe(li.accountId)
  })

  it('users belong to exactly one account; the other tenant’s users are invisible to an A-scoped query', async () => {
    const zoe = await prisma.user.findFirst({ where: { accountId: B }, select: { id: true } })
    expect(zoe).not.toBeNull()
    const crossed = await prisma.user.findFirst({ where: { id: zoe!.id, accountId: A } })
    expect(crossed).toBeNull()
  })
})
