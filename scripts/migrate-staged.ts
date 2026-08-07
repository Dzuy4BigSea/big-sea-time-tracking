/**
 * Staged Harvest → Track2 migration runner (spec 13). Runs the real ETL (modules/migration/importer)
 * OFFLINE — no serverless time cap — one phase at a time so each can be verified before the next.
 *
 * Phases (dependency-ordered; each includes all earlier stages, idempotent so re-running is safe):
 *   team       → clients, contacts, tasks, users, expense_categories   (the people + foundation)
 *   projects   → + projects
 *   timesheets → + time_entries                                        (the 388k-row bulk)
 *   full       → + expenses, invoices, estimates
 *
 * Usage:
 *   npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/migrate-staged.ts <phase> [--apply]
 *   (default is a DRY RUN; pass --apply to write. ACCOUNT_ID / SNAPSHOT_ID env override discovery.)
 */
import '../test/load-env'
import { prisma } from '@/lib/prisma'
import { runImportBatch, getImportableSnapshot, IMPORT_RESOURCES, type ImportCursor } from '@/modules/migration/importer'
import { reconcile, formatReconTable, type ReconInput } from '@/modules/migration/reconcile'

const PHASES: Record<string, { stopAfter?: string; label: string }> = {
  team: { stopAfter: 'expense_category', label: 'Team + foundation (clients, contacts, tasks, users, categories)' },
  projects: { stopAfter: 'project', label: 'Projects (+ everything before)' },
  timesheets: { stopAfter: 'time_entry', label: 'Timesheets / time entries (+ everything before)' },
  full: { stopAfter: undefined, label: 'Full import (+ expenses, invoices, estimates)' },
}

// entity → the DB table count fn + snapshot resource key + tolerated unmapped (orphans by design).
const ENTITY_META: { entity: string; label: string; resource: string; count: (accountId: string) => Promise<number>; tol?: number }[] = [
  { entity: 'client', label: 'Clients', resource: 'clients', count: (a) => prisma.client.count({ where: { accountId: a } }) },
  { entity: 'contact', label: 'Contacts', resource: 'contacts', count: (a) => prisma.clientContact.count({ where: { accountId: a } }) },
  { entity: 'task', label: 'Tasks', resource: 'tasks', count: (a) => prisma.task.count({ where: { accountId: a } }) },
  { entity: 'user', label: 'People', resource: 'users', count: (a) => prisma.user.count({ where: { accountId: a } }) },
  { entity: 'expense_category', label: 'Expense categories', resource: 'expense_categories', count: (a) => prisma.expenseCategory.count({ where: { accountId: a } }) },
  { entity: 'project', label: 'Projects', resource: 'projects', count: (a) => prisma.project.count({ where: { accountId: a } }) },
  { entity: 'time_entry', label: 'Time entries', resource: 'time_entries', count: (a) => prisma.timeEntry.count({ where: { accountId: a } }), tol: 500 },
  { entity: 'expense', label: 'Expenses', resource: 'expenses', count: (a) => prisma.expense.count({ where: { accountId: a } }), tol: 200 },
  { entity: 'invoice', label: 'Invoices', resource: 'invoices', count: (a) => prisma.invoice.count({ where: { accountId: a } }), tol: 200 },
  { entity: 'estimate', label: 'Estimates', resource: 'estimates', count: (a) => prisma.estimate.count({ where: { accountId: a } }) },
]
const STAGE_ORDER = ENTITY_META.map((m) => m.entity)

async function main() {
  const phaseName = process.argv[2] ?? 'team'
  const apply = process.argv.includes('--apply')
  const phase = PHASES[phaseName]
  if (!phase) {
    console.error(`Unknown phase "${phaseName}". Use one of: ${Object.keys(PHASES).join(', ')}`)
    process.exit(1)
  }

  const accountId =
    process.env.ACCOUNT_ID ??
    (await prisma.account.findFirst({ where: { name: { contains: 'Big Sea' } }, select: { id: true } }))?.id
  if (!accountId) throw new Error('No account found; set ACCOUNT_ID.')
  const snap = process.env.SNAPSHOT_ID
    ? await prisma.migrationSnapshot.findFirst({ where: { id: process.env.SNAPSHOT_ID, accountId } })
    : await getImportableSnapshot(accountId)
  if (!snap) throw new Error('No importable snapshot found for this account.')

  const runStages = STAGE_ORDER.slice(0, phase.stopAfter ? STAGE_ORDER.indexOf(phase.stopAfter) + 1 : STAGE_ORDER.length)
  console.log(`\n▶ Phase: ${phaseName} — ${phase.label}`)
  console.log(`  account=${accountId}  snapshot=${snap.id} (${snap.status})  mode=${apply ? 'APPLY (writes)' : 'DRY RUN'}`)
  console.log(`  stages this phase: ${runStages.join(' → ')}\n`)

  // Drive batches to completion (resumes via cursor; each batch is time-boxed inside the importer).
  let cursor: ImportCursor | null = null
  let processed = 0
  const totals: Record<string, { created: number; updated: number; skipped: number; errors: number }> = {}
  const allNotes: string[] = []
  let batches = 0
  for (;;) {
    const r = await runImportBatch(accountId, snap.id, { dryRun: !apply, cursor, stopAfter: phase.stopAfter })
    if (!r.ok) throw new Error(r.message ?? 'import batch failed')
    batches++
    processed += r.processedThisBatch
    for (const [e, t] of Object.entries(r.batch)) {
      const acc = (totals[e] ??= { created: 0, updated: 0, skipped: 0, errors: 0 })
      acc.created += t.created; acc.updated += t.updated; acc.skipped += t.skipped; acc.errors += t.errors
    }
    for (const n of r.notes) if (allNotes.length < 40) allNotes.push(n)
    process.stdout.write(`\r  ${r.stageLabel.padEnd(20)} processed=${processed}  batches=${batches}   `)
    if (r.done) break
    cursor = r.cursor
  }
  console.log('\n')

  console.log('Per-entity outcomes (this run):')
  for (const [e, t] of Object.entries(totals)) {
    console.log(`  ${e.padEnd(18)} created=${t.created} updated=${t.updated} skipped=${t.skipped} errors=${t.errors}`)
  }
  if (allNotes.length) {
    console.log('\nFirst errors/notes:')
    allNotes.forEach((n) => console.log(`  - ${n}`))
  }

  // Reconcile: snapshot source vs id-map vs DB rows.
  const counts = (snap.entityCounts as Record<string, number> | null) ?? {}
  const [mapGroups, ...dbCounts] = await Promise.all([
    prisma.migrationIdMap.groupBy({ by: ['entity'], where: { accountId }, _count: true }),
    ...ENTITY_META.map((m) => m.count(accountId)),
  ])
  const mapped: Record<string, number> = {}
  for (const g of mapGroups) mapped[g.entity] = g._count

  const inputs: ReconInput[] = ENTITY_META.map((m, i) => {
    const t = totals[m.entity]
    // On APPLY, the persistent id-map is the source of truth. On DRY RUN nothing is written, so a
    // row "maps" iff it resolved this run (created/updated/skipped-but-matched) — processed minus errors.
    const mappedIds = apply
      ? mapped[m.entity] ?? 0
      : t
        ? t.created + t.updated + t.skipped
        : 0
    return {
      entity: m.entity,
      label: m.label,
      resource: m.resource,
      sourceRows: counts[m.resource] ?? 0,
      mappedIds,
      dbRows: apply ? dbCounts[i] : 0,
      expectedSkips: m.tol,
      ran: runStages.includes(m.entity),
    }
  })
  const { rows, ok } = reconcile(inputs)
  console.log('\nReconciliation (snapshot → mapped → db):')
  console.log(formatReconTable(rows))
  console.log(`\nSource total across importable resources: ${IMPORT_RESOURCES.reduce((a, r) => a + (counts[r] ?? 0), 0)}`)
  console.log(ok ? '\n✅ Phase reconciled OK (no mismatches beyond tolerance).' : '\n⚠️  Mismatches detected — inspect rows above.')
  if (!apply) console.log('   (dry run — nothing was written. Re-run with --apply to migrate.)')

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('\nMigration runner failed:', e)
  await prisma.$disconnect()
  process.exit(1)
})
