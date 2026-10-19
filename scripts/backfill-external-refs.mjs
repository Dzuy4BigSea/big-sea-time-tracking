#!/usr/bin/env node
/**
 * Backfill TimeEntry → Asana task links from the stored Harvest snapshots (specs/29, AC-ASANAAPP-010).
 *
 * The original import dropped Harvest's `external_reference` (the Asana task a time entry was tracked
 * from). Every raw Harvest row is still in MigrationSnapshotPart, so this reads the latest version of
 * each entry (full snapshot overlaid by incremental snapshots, newest updated_at wins — the same
 * composition as rebuild-timesheets.mjs) and writes the link onto the matching TimeEntry by harvestId.
 *
 * Safe by construction:
 *   - DRY RUN by default (counts only); --apply writes.
 *   - Only fills entries whose externalId is still NULL: a link set in Track2 is never overwritten.
 *   - Touches only the four external* columns, via raw SQL, so updatedAt is NOT bumped (protect.ts
 *     uses updatedAt to tell Track2 edits from imported rows) and hours/rates/lock state never change.
 *   - Re-runnable: a second run finds nothing left to fill.
 * It writes metadata only, so it is allowed while MIGRATION_LOCKED=1.
 *
 * Usage:
 *   ACCOUNT_ID=acc_x node --env-file=.env scripts/backfill-external-refs.mjs           # dry run
 *   ACCOUNT_ID=acc_x node --env-file=.env scripts/backfill-external-refs.mjs --apply   # write
 * Env: ACCOUNT_ID (required), FULL_SNAPSHOT_ID (optional; default = latest finished full snapshot).
 */
import { PrismaClient } from '@prisma/client'
import { requireAccountId } from './lib/guards.mjs'
import { externalRef } from './lib/externalRef.mjs'

const APPLY = process.argv.includes('--apply')
const CHUNK = 1000
const log = (m) => process.stdout.write(m + '\n')

const db = new PrismaClient()
const accountId = (await requireAccountId(db)).id

const finished = { in: ['complete', 'partial'] }
const full = process.env.FULL_SNAPSHOT_ID
  ? await db.migrationSnapshot.findFirst({ where: { id: process.env.FULL_SNAPSHOT_ID, accountId } })
  : await db.migrationSnapshot.findFirst({ where: { accountId, mode: 'full', status: finished }, orderBy: { createdAt: 'desc' } })
if (!full) { log('No finished full snapshot.'); process.exit(1) }
const deltas = await db.migrationSnapshot.findMany({
  where: { accountId, mode: 'incremental', status: finished, createdAt: { gt: full.createdAt } },
  orderBy: { createdAt: 'asc' },
  select: { id: true },
})

// Latest version of every entry touched by a delta.
const latest = new Map()
for (const d of deltas) {
  const parts = await db.migrationSnapshotPart.findMany({ where: { snapshotId: d.id, resource: 'time_entries' }, select: { data: true } })
  for (const part of parts) {
    for (const te of Array.isArray(part.data) ? part.data : []) {
      const prev = latest.get(String(te.id))
      if (!prev || String(te.updated_at ?? '') >= String(prev.updated_at ?? '')) latest.set(String(te.id), te)
    }
  }
}

const fullParts = await db.migrationSnapshotPart.findMany({
  where: { snapshotId: full.id, resource: 'time_entries' },
  select: { id: true, chunk: true },
  orderBy: { chunk: 'asc' },
})

log(`\n▶ Backfill Asana links on time entries from Harvest snapshots`)
log(`  account=${accountId}  full=${full.id}  deltas=${deltas.length} (${latest.size} newer rows)  mode=${APPLY ? 'APPLY' : 'DRY RUN'}\n`)
log(`  part        rows   with link   asana   other`)

const tot = { rows: 0, linked: 0, asana: 0, other: 0, written: 0 }
const seen = new Set()

/** Write one chunk; returns how many TimeEntry rows changed (only rows with no link yet). */
async function writeChunk(rows) {
  if (!rows.length || !APPLY) return 0
  const params = [accountId]
  const values = rows.map((r) => {
    const i = params.length
    params.push(r.harvestId, r.externalService, r.externalId, r.externalGroupId, r.externalPermalink)
    return `($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5})`
  })
  return db.$executeRawUnsafe(
    `UPDATE "TimeEntry" AS t
        SET "externalService" = v.svc, "externalId" = v.eid, "externalGroupId" = v.gid, "externalPermalink" = v.link
       FROM (VALUES ${values.join(', ')}) AS v(hid, svc, eid, gid, link)
      WHERE t."accountId" = $1 AND t."harvestId" = v.hid AND t."externalId" IS NULL`,
    ...params,
  )
}

async function processRows(label, rows) {
  const counts = { rows: 0, linked: 0, asana: 0, other: 0 }
  let buf = []
  for (const te of rows) {
    const hid = String(te.id)
    counts.rows++
    const ref = externalRef(te.external_reference)
    if (!ref.externalId) continue
    counts.linked++
    ref.externalService === 'asana' ? counts.asana++ : counts.other++
    buf.push({ harvestId: hid, ...ref })
    if (buf.length >= CHUNK) { tot.written += await writeChunk(buf); buf = [] }
  }
  tot.written += await writeChunk(buf)
  for (const k of Object.keys(counts)) tot[k] += counts[k]
  log(`  ${label.padEnd(8)} ${String(counts.rows).padStart(7)} ${String(counts.linked).padStart(11)} ${String(counts.asana).padStart(7)} ${String(counts.other).padStart(7)}`)
}

for (const p of fullParts) {
  const part = await db.migrationSnapshotPart.findUnique({ where: { id: p.id }, select: { data: true } })
  const rows = []
  for (const te of Array.isArray(part?.data) ? part.data : []) {
    const id = String(te.id)
    seen.add(id)
    rows.push(latest.get(id) ?? te) // a newer delta version wins
  }
  await processRows(p.chunk ?? 'all', rows)
}
// Entries created after the full snapshot exist only in deltas.
await processRows('deltas', [...latest.values()].filter((te) => !seen.has(String(te.id))))

const missing = await db.timeEntry.count({ where: { accountId, harvestId: { not: null }, externalId: null } })
log(`\n  total    ${String(tot.rows).padStart(7)} ${String(tot.linked).padStart(11)} ${String(tot.asana).padStart(7)} ${String(tot.other).padStart(7)}`)
log(APPLY
  ? `\n  Wrote links on ${tot.written} time entries. Harvest entries still without a link: ${missing}.`
  : `\n  DRY RUN: ${tot.linked} Harvest rows carry a link. Harvest entries without a link in Track2 now: ${missing}. Re-run with --apply to write.`)
await db.$disconnect()
