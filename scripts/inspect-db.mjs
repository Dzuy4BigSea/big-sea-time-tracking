#!/usr/bin/env node
/** Read-only snapshot of the current DB: accounts, per-account row counts, snapshots, id-map state.
 *  Run: node --env-file=.env scripts/inspect-db.mjs */
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

const accounts = await p.account.findMany({ select: { id: true, name: true, createdAt: true } })
console.log(`\n=== ${accounts.length} account(s) ===`)
for (const a of accounts) {
  const [users, clients, projects, tasks, timeEntries, expenses, invoices, estimates, entities, idmap] = await Promise.all([
    p.user.count({ where: { accountId: a.id } }),
    p.client.count({ where: { accountId: a.id } }),
    p.project.count({ where: { accountId: a.id } }),
    p.task.count({ where: { accountId: a.id } }),
    p.timeEntry.count({ where: { accountId: a.id } }),
    p.expense.count({ where: { accountId: a.id } }),
    p.invoice.count({ where: { accountId: a.id } }),
    p.estimate.count({ where: { accountId: a.id } }),
    p.businessEntity.count({ where: { accountId: a.id } }),
    p.migrationIdMap.count({ where: { accountId: a.id } }),
  ])
  console.log(`\n[${a.name}]  id=${a.id}`)
  console.log(`  users=${users} clients=${clients} projects=${projects} tasks=${tasks}`)
  console.log(`  timeEntries=${timeEntries} expenses=${expenses} invoices=${invoices} estimates=${estimates}`)
  console.log(`  businessEntities=${entities}  migrationIdMap rows=${idmap}`)

  // Which users would be "real" (can log in) vs imported placeholders?
  const realLogins = await p.user.findMany({
    where: { accountId: a.id, NOT: { passwordHash: '!migrated:no-login' } },
    select: { email: true, firstName: true, lastName: true, permissionProfile: true },
  })
  console.log(`  real login users (${realLogins.length}): ${realLogins.map((u) => u.email).join(', ') || '—'}`)

  const snaps = await p.migrationSnapshot.findMany({
    where: { accountId: a.id },
    select: { id: true, status: true, createdAt: true, entityCounts: true },
    orderBy: { createdAt: 'desc' },
  })
  console.log(`  snapshots (${snaps.length}):`)
  for (const s of snaps) {
    const counts = s.entityCounts ?? {}
    const total = Object.values(counts).reduce((x, y) => x + (y ?? 0), 0)
    console.log(`    ${s.id}  ${s.status}  ${s.createdAt.toISOString().slice(0, 10)}  rows=${total}  ${JSON.stringify(counts)}`)
  }
  if (idmap > 0) {
    const byEntity = await p.migrationIdMap.groupBy({ by: ['entity'], where: { accountId: a.id }, _count: true })
    console.log(`  id-map by entity: ${byEntity.map((r) => `${r.entity}=${r._count}`).join(' ')}`)
  }
}
await p.$disconnect()
