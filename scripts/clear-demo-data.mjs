#!/usr/bin/env node
/**
 * Clear DEMO/seed domain data from one account before the real Harvest migration (spec 13).
 *
 * DELETES (scoped to the target account): time entries, expenses, invoices (+ line items, payments),
 * estimates (+ line items), projects (+ assignments), tasks, clients (+ contacts), expense categories,
 * retainers, recurring profiles, audit logs — and demo USERS whose email matches DEMO_USER_DOMAIN.
 *
 * KEEPS: the account, business entities, integration connections, the migration snapshot(s) + id-map,
 * invoice item types / appearance / labels / message templates / sender addresses, and any real login
 * user (default: anyone NOT on the demo domain).
 *
 * Guarded (go-live): DRY RUN unless --confirm; ACCOUNT_ID is REQUIRED (no lookup by name); refuses,
 * with no override, any account that has Harvest id-map rows / snapshots or more than 1,000 time
 * entries. Production (acc_demo, 388k entries) can never be cleared with this script.
 *
 * Usage:
 *   ACCOUNT_ID=acc_x node --env-file=.env scripts/clear-demo-data.mjs             # dry run
 *   ACCOUNT_ID=acc_x node --env-file=.env scripts/clear-demo-data.mjs --confirm   # actually delete
 * Env: ACCOUNT_ID (required), DEMO_USER_DOMAIN (default "bigsea.demo").
 */
import { PrismaClient } from '@prisma/client'
import { PROD_TIME_ENTRY_THRESHOLD, refuse, requireAccountId } from './lib/guards.mjs'
const p = new PrismaClient()

const CONFIRM = process.argv.includes('--confirm')
const DEMO_DOMAIN = process.env.DEMO_USER_DOMAIN ?? 'bigsea.demo'

const account = await requireAccountId(p)
const accountId = account.id

const [idmap, snapshots, teCount] = await Promise.all([
  p.migrationIdMap.count({ where: { accountId } }),
  p.migrationSnapshot.count({ where: { accountId } }),
  p.timeEntry.count({ where: { accountId } }),
])
if (idmap > 0 || snapshots > 0 || teCount > PROD_TIME_ENTRY_THRESHOLD) {
  await p.$disconnect()
  refuse(`account "${account.name}" (${accountId}) does not look like demo data`, [
    `time entries=${teCount} (limit ${PROD_TIME_ENTRY_THRESHOLD})  Harvest id-map rows=${idmap}  snapshots=${snapshots}`,
    'This script only clears seed/demo data. There is no override: real data is never wiped here.',
  ])
}

// Users to delete: demo domain. Everyone else (e.g. @bigsea.co real admins) is preserved.
const demoUsers = await p.user.findMany({ where: { accountId, email: { endsWith: `@${DEMO_DOMAIN}` } }, select: { id: true, email: true } })
const keepUsers = await p.user.findMany({ where: { accountId, NOT: { email: { endsWith: `@${DEMO_DOMAIN}` } } }, select: { email: true } })

const w = { where: { accountId } }
const [clients, projects, tasks, timeEntries, expenses, invoices, estimates, payments, contacts, cats] = await Promise.all([
  p.client.count(w), p.project.count(w), p.task.count(w), p.timeEntry.count(w), p.expense.count(w),
  p.invoice.count(w), p.estimate.count(w), p.payment.count(w), p.clientContact.count(w), p.expenseCategory.count(w),
])

console.log(`\nTarget account: ${account?.name}  (${accountId})`)
console.log(`Mode: ${CONFIRM ? 'CONFIRM — will DELETE' : 'DRY RUN — no changes'}`)
console.log(`\nWill DELETE:`)
console.log(`  timeEntries=${timeEntries} expenses=${expenses} invoices=${invoices} (payments=${payments}) estimates=${estimates}`)
console.log(`  projects=${projects} tasks=${tasks} clients=${clients} (contacts=${contacts}) expenseCategories=${cats}`)
console.log(`  demo users (${demoUsers.length}): ${demoUsers.map((u) => u.email).join(', ') || '—'}`)
console.log(`\nWill KEEP:`)
console.log(`  real login users (${keepUsers.length}): ${keepUsers.map((u) => u.email).join(', ') || '—'}`)
console.log(`  + business entities, integrations, snapshot(s), id-map, item types, invoice config.`)

if (!CONFIRM) {
  console.log('\n(dry run — nothing deleted. Re-run with --confirm to proceed.)')
  await p.$disconnect()
  process.exit(0)
}

console.log('\nDeleting…')
// FK-safe order. Children before parents; Payment/line items cascade from Invoice but delete explicitly to be safe.
const steps = [
  ['payments', () => p.payment.deleteMany(w)],
  ['invoiceLineItems', () => p.invoiceLineItem.deleteMany(w)],
  ['invoices', () => p.invoice.deleteMany(w)],
  ['estimateLineItems', () => p.estimateLineItem.deleteMany(w)],
  ['estimates', () => p.estimate.deleteMany(w)],
  ['recurringProfiles', () => p.recurringInvoiceProfile.deleteMany(w)],
  ['retainers', () => p.retainer.deleteMany(w)],
  ['timeEntries', () => p.timeEntry.deleteMany(w)],
  ['expenses', () => p.expense.deleteMany(w)],
  ['projectTaskAssignments', () => p.projectTaskAssignment.deleteMany(w)],
  ['projectUserAssignments', () => p.projectUserAssignment.deleteMany(w)],
  ['projects', () => p.project.deleteMany(w)],
  ['tasks', () => p.task.deleteMany(w)],
  ['clientContacts', () => p.clientContact.deleteMany(w)],
  ['clients', () => p.client.deleteMany(w)],
  ['expenseCategories', () => p.expenseCategory.deleteMany(w)],
  ['auditLogs', () => p.auditLog.deleteMany(w)],
  ['timesheets', () => p.timesheet.deleteMany(w)],
  ['personBillableRates', () => p.personBillableRate.deleteMany(w)],
  ['personCostRates', () => p.personCostRate.deleteMany(w)],
  ['demoUsers', () => p.user.deleteMany({ where: { accountId, email: { endsWith: `@${DEMO_DOMAIN}` } } })],
]
for (const [label, fn] of steps) {
  try {
    const r = await fn()
    console.log(`  ${label.padEnd(24)} deleted ${r.count}`)
  } catch (e) {
    console.error(`  ${label.padEnd(24)} ERROR ${e.message?.slice(0, 120)}`)
  }
}
console.log('\n✅ Demo data cleared. Real logins, entities, snapshot, and invoice config preserved.')
await p.$disconnect()
