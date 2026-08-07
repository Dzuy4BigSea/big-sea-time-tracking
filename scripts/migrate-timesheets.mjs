#!/usr/bin/env node
/**
 * Resumable bulk timesheets import (spec 13, Phase 3). 388k time entries are leaf rows, so we skip
 * the per-row id-map and use chunked `createMany`. Each snapshot part is exactly one calendar year
 * (backup chunked by spent_date year), which we exploit for idempotency + resume:
 *
 *   - FRESH DB connection per year-part — no single connection lives across the whole run, which is
 *     what went stale and hung earlier deep into the import.
 *   - Idempotent per year: delete that year's [Jan 1, next Jan 1) range, then insert — re-running a
 *     year can never duplicate.
 *   - Resumable: a year whose DB count already equals its mapped count is skipped, so a restart
 *     continues from where a drop left off instead of redoing everything.
 *   - Per-part progress is printed (flushed) so a stall is visible immediately; one retry per part.
 *
 * Assignments (project↔person, project↔task) are derived from the entries and upserted at the end
 * (Phase 4 later enriches with the real Harvest roster + PM flags + rates).
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-timesheets.mjs             # dry run (map + reconcile)
 *   node --env-file=.env scripts/migrate-timesheets.mjs --apply     # import (resumable; safe to re-run)
 *   node --env-file=.env scripts/migrate-timesheets.mjs --apply --force   # redo every year
 * Env: ACCOUNT_ID, SNAPSHOT_ID (optional).
 */
import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')
const TE_CHUNK = 2000
const ASG_CHUNK = 1000
const DRY = '__dry__'

const cents = (v) => (v == null || v === '' ? null : Math.round(Number(v) * 100))
const minutes = (v) => (v == null ? 0 : Math.round(Number(v) * 60))
const dateOnly = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`) : new Date())
const sid = (v) => (v == null ? null : String(v))
const log = (m) => process.stdout.write(m + '\n')

// One short-lived client for setup/reconcile; per-part clients for the heavy work.
const boot = new PrismaClient()
const accountId =
  process.env.ACCOUNT_ID ??
  (await boot.account.findFirst({ where: { name: { contains: 'Big Sea' } }, select: { id: true } }))?.id
if (!accountId) { log('No account; set ACCOUNT_ID.'); process.exit(1) }
const snap = process.env.SNAPSHOT_ID
  ? await boot.migrationSnapshot.findFirst({ where: { id: process.env.SNAPSHOT_ID, accountId } })
  : (await boot.migrationSnapshot.findFirst({ where: { accountId, status: 'complete' }, orderBy: { createdAt: 'desc' } })) ??
    (await boot.migrationSnapshot.findFirst({ where: { accountId, status: 'partial' }, orderBy: { createdAt: 'desc' } }))
if (!snap) { log('No importable snapshot.'); process.exit(1) }
const sourceCount = (snap.entityCounts ?? {}).time_entries ?? 0

// id-maps (from phases 1–2).
const mapRows = await boot.migrationIdMap.findMany({ where: { accountId, entity: { in: ['user', 'project', 'task'] } }, select: { entity: true, harvestId: true, localId: true } })
const maps = { user: new Map(), project: new Map(), task: new Map() }
for (const r of mapRows) if (r.localId !== DRY) maps[r.entity].set(r.harvestId, r.localId)

const parts = await boot.migrationSnapshotPart.findMany({ where: { snapshotId: snap.id, resource: 'time_entries' }, select: { id: true, chunk: true, rowCount: true }, orderBy: { chunk: 'asc' } })
const startExisting = APPLY ? await boot.timeEntry.count({ where: { accountId } }) : 0
await boot.$disconnect()

log(`\n▶ Timesheets bulk import (resumable)`)
log(`  account=${accountId}  snapshot=${snap.id} (${snap.status})  mode=${APPLY ? 'APPLY' : 'DRY RUN'}${FORCE ? ' +force' : ''}`)
log(`  source=${sourceCount}  existing in db=${startExisting}  id-maps: users=${maps.user.size} projects=${maps.project.size} tasks=${maps.task.size}`)
log(`  ${parts.length} year-part(s)\n`)

const mapRow = (te) => {
  const userId = maps.user.get(sid(te.user?.id))
  const projectId = maps.project.get(sid(te.project?.id))
  const taskId = maps.task.get(sid(te.task?.id))
  if (!userId || !projectId || !taskId) return null
  return {
    accountId, userId, projectId, taskId,
    spentDate: dateOnly(te.spent_date),
    minutes: minutes(te.hours),
    notes: te.notes ?? null,
    isBillable: te.billable ?? true,
    billableRateCents: cents(te.billable_rate),
    lockState: te.invoice?.id ? 'invoiced' : te.is_locked ? 'approved' : 'open',
  }
}

let totalMapped = 0, totalSkipped = 0, totalWritten = 0
const userAsg = new Set(), taskAsg = new Set()

async function processPart(part) {
  const year = Number(part.chunk)
  const yStart = new Date(`${year}-01-01T00:00:00.000Z`)
  const yEnd = new Date(`${year + 1}-01-01T00:00:00.000Z`)
  const db = new PrismaClient()
  try {
    const row = await db.migrationSnapshotPart.findUnique({ where: { id: part.id }, select: { data: true } })
    const rows = Array.isArray(row?.data) ? row.data : []
    const buf = []
    for (const te of rows) {
      const m = mapRow(te)
      if (!m) { totalSkipped++; continue }
      buf.push(m)
      userAsg.add(`${m.projectId}|${m.userId}`)
      taskAsg.add(`${m.projectId}|${m.taskId}`)
    }
    totalMapped += buf.length

    if (!APPLY) { log(`  ${year}: mapped=${buf.length} (dry)`); return }

    const existing = await db.timeEntry.count({ where: { accountId, spentDate: { gte: yStart, lt: yEnd } } })
    if (!FORCE && existing === buf.length && buf.length > 0) {
      totalWritten += existing
      log(`  ${year}: already complete (${existing}) — skipped`)
      return
    }
    if (existing > 0) await db.timeEntry.deleteMany({ where: { accountId, spentDate: { gte: yStart, lt: yEnd } } })
    let w = 0
    for (let i = 0; i < buf.length; i += TE_CHUNK) {
      const r = await db.timeEntry.createMany({ data: buf.slice(i, i + TE_CHUNK) })
      w += r.count
    }
    totalWritten += w
    log(`  ${year}: mapped=${buf.length} wrote=${w}`)
  } finally {
    await db.$disconnect()
  }
}

for (const part of parts) {
  try {
    await processPart(part)
  } catch (e) {
    log(`  ${part.chunk}: ERROR ${String(e.message).slice(0, 140)} — retrying once…`)
    await new Promise((r) => setTimeout(r, 2000))
    await processPart(part) // one retry with a fresh client
  }
}

// Derive assignments (additive; Phase 4 enriches).
if (APPLY) {
  const db = new PrismaClient()
  const uArr = [...userAsg].map((k) => { const [projectId, userId] = k.split('|'); return { accountId, projectId, userId } })
  const tArr = [...taskAsg].map((k) => { const [projectId, taskId] = k.split('|'); return { accountId, projectId, taskId } })
  let uw = 0, tw = 0
  for (let i = 0; i < uArr.length; i += ASG_CHUNK) uw += (await db.projectUserAssignment.createMany({ data: uArr.slice(i, i + ASG_CHUNK), skipDuplicates: true })).count
  for (let i = 0; i < tArr.length; i += ASG_CHUNK) tw += (await db.projectTaskAssignment.createMany({ data: tArr.slice(i, i + ASG_CHUNK), skipDuplicates: true })).count
  log(`\nDerived assignments: projectUser +${uw} (of ${uArr.length} distinct)  projectTask +${tw} (of ${tArr.length})`)
  await db.$disconnect()
}

const fin = new PrismaClient()
const dbCount = APPLY ? await fin.timeEntry.count({ where: { accountId } }) : 0
await fin.$disconnect()
log(`\nReconciliation:`)
log(`  source=${sourceCount}  mapped=${totalMapped}  skipped(missing parent)=${totalSkipped}  written=${totalWritten}  db=${dbCount}`)
if (APPLY) log(dbCount === totalMapped ? '\n✅ DB row count matches mapped rows.' : `\n⚠️  db(${dbCount}) != mapped(${totalMapped}) — re-run to finish (resumable).`)
else log('\n(dry run — nothing written. Re-run with --apply to import; safe to re-run if interrupted.)')
process.exit(0)
