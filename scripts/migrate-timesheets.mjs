#!/usr/bin/env node
/**
 * Fast bulk timesheets import (spec 13, Phase 3). The generic per-row ETL writes one INSERT + one
 * id-map upsert per row — ~776k round-trips for Big Sea's 388k entries (hours). Time entries are
 * leaf rows (nothing references them by Harvest id), so here we skip the per-row id-map and use
 * chunked `createMany`, turning it into ~80 batched inserts (minutes). Project↔person and
 * project↔task assignments are derived from the distinct combinations seen in the entries and
 * upserted once at the end (Phase 4 later enriches these with the real Harvest roster + PM flags).
 *
 * Because we skip the id-map, this import is NOT row-level idempotent — re-running would duplicate.
 * Guard: refuses to write if time entries already exist, unless --truncate (clean re-import).
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-timesheets.mjs                # dry run (map + reconcile)
 *   node --env-file=.env scripts/migrate-timesheets.mjs --apply        # write (empty table only)
 *   node --env-file=.env scripts/migrate-timesheets.mjs --apply --truncate   # wipe TE + re-import
 * Env: ACCOUNT_ID, SNAPSHOT_ID (optional overrides).
 */
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

const APPLY = process.argv.includes('--apply')
const TRUNCATE = process.argv.includes('--truncate')
const TE_CHUNK = 4000
const ASG_CHUNK = 2000
const DRY = '__dry__'

const cents = (v) => (v == null || v === '' ? null : Math.round(Number(v) * 100))
const minutes = (v) => (v == null ? 0 : Math.round(Number(v) * 60))
const dateOnly = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`) : new Date())
const sid = (v) => (v == null ? null : String(v))

const accountId =
  process.env.ACCOUNT_ID ??
  (await p.account.findFirst({ where: { name: { contains: 'Big Sea' } }, select: { id: true } }))?.id
if (!accountId) { console.error('No account; set ACCOUNT_ID.'); process.exit(1) }

const snap = process.env.SNAPSHOT_ID
  ? await p.migrationSnapshot.findFirst({ where: { id: process.env.SNAPSHOT_ID, accountId } })
  : (await p.migrationSnapshot.findFirst({ where: { accountId, status: 'complete' }, orderBy: { createdAt: 'desc' } })) ??
    (await p.migrationSnapshot.findFirst({ where: { accountId, status: 'partial' }, orderBy: { createdAt: 'desc' } }))
if (!snap) { console.error('No importable snapshot.'); process.exit(1) }

const sourceCount = (snap.entityCounts ?? {}).time_entries ?? 0
const existing = await p.timeEntry.count({ where: { accountId } })
console.log(`\n▶ Timesheets bulk import`)
console.log(`  account=${accountId}  snapshot=${snap.id} (${snap.status})`)
console.log(`  source time_entries=${sourceCount}  existing in db=${existing}  mode=${APPLY ? 'APPLY' : 'DRY RUN'}${TRUNCATE ? ' +truncate' : ''}`)

if (APPLY && existing > 0 && !TRUNCATE) {
  console.error(`\n⛔ ${existing} time entries already exist. Re-run with --truncate for a clean re-import (avoids duplicates).`)
  process.exit(1)
}

// Load id-maps (built by phases 1–2) into memory.
const mapRows = await p.migrationIdMap.findMany({ where: { accountId, entity: { in: ['user', 'project', 'task'] } }, select: { entity: true, harvestId: true, localId: true } })
const maps = { user: new Map(), project: new Map(), task: new Map() }
for (const r of mapRows) if (r.localId !== DRY) maps[r.entity].set(r.harvestId, r.localId)
console.log(`  id-maps: users=${maps.user.size} projects=${maps.project.size} tasks=${maps.task.size}`)

if (APPLY && TRUNCATE && existing > 0) {
  process.stdout.write(`  truncating ${existing} existing time entries… `)
  const del = await p.timeEntry.deleteMany({ where: { accountId } })
  console.log(`deleted ${del.count}`)
}

const parts = await p.migrationSnapshotPart.findMany({ where: { snapshotId: snap.id, resource: 'time_entries' }, select: { id: true, chunk: true, rowCount: true }, orderBy: { chunk: 'asc' } })
console.log(`  ${parts.length} snapshot part(s)\n`)

let mapped = 0, skipped = 0, written = 0
const userAsg = new Set() // `${projectId}|${userId}`
const taskAsg = new Set() // `${projectId}|${taskId}`

for (const part of parts) {
  const row = await p.migrationSnapshotPart.findUnique({ where: { id: part.id }, select: { data: true } })
  const rows = Array.isArray(row?.data) ? row.data : []
  const buf = []
  for (const te of rows) {
    const userId = maps.user.get(sid(te.user?.id))
    const projectId = maps.project.get(sid(te.project?.id))
    const taskId = maps.task.get(sid(te.task?.id))
    if (!userId || !projectId || !taskId) { skipped++; continue }
    mapped++
    userAsg.add(`${projectId}|${userId}`)
    taskAsg.add(`${projectId}|${taskId}`)
    buf.push({
      accountId, userId, projectId, taskId,
      spentDate: dateOnly(te.spent_date),
      minutes: minutes(te.hours),
      notes: te.notes ?? null,
      isBillable: te.billable ?? true,
      billableRateCents: cents(te.billable_rate),
      lockState: te.invoice?.id ? 'invoiced' : te.is_locked ? 'approved' : 'open',
    })
  }
  if (APPLY) {
    for (let i = 0; i < buf.length; i += TE_CHUNK) {
      const r = await p.timeEntry.createMany({ data: buf.slice(i, i + TE_CHUNK) })
      written += r.count
    }
  }
  process.stdout.write(`\r  part chunk=${part.chunk} mapped=${mapped} skipped=${skipped} written=${written}   `)
}
console.log('\n')

if (APPLY) {
  // Derive assignments (additive; Phase 4 enriches with real roster/PM/rates).
  const uArr = [...userAsg].map((k) => { const [projectId, userId] = k.split('|'); return { accountId, projectId, userId } })
  const tArr = [...taskAsg].map((k) => { const [projectId, taskId] = k.split('|'); return { accountId, projectId, taskId } })
  let uw = 0, tw = 0
  for (let i = 0; i < uArr.length; i += ASG_CHUNK) uw += (await p.projectUserAssignment.createMany({ data: uArr.slice(i, i + ASG_CHUNK), skipDuplicates: true })).count
  for (let i = 0; i < tArr.length; i += ASG_CHUNK) tw += (await p.projectTaskAssignment.createMany({ data: tArr.slice(i, i + ASG_CHUNK), skipDuplicates: true })).count
  console.log(`Derived assignments: projectUser=${uw}/${uArr.length} projectTask=${tw}/${tArr.length}`)
}

// Reconcile.
const dbCount = APPLY ? await p.timeEntry.count({ where: { accountId } }) : 0
console.log(`\nReconciliation:`)
console.log(`  source=${sourceCount}  mapped=${mapped}  skipped(missing parent)=${skipped}  written=${written}  db=${dbCount}`)
const unmapped = sourceCount - mapped
if (unmapped > 0) console.log(`  note: ${unmapped} source rows outside distinct mapped set (rounding/duplicates in parts) — investigate if large`)
if (APPLY) console.log(dbCount === mapped ? '\n✅ DB row count matches mapped rows.' : `\n⚠️  db(${dbCount}) != mapped(${mapped}) — inspect.`)
else console.log('\n(dry run — nothing written. Re-run with --apply [--truncate] to import.)')

await p.$disconnect()
