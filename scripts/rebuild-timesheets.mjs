#!/usr/bin/env node
/**
 * Rebuild time entries from the full Harvest snapshot + every incremental snapshot since, keyed by
 * TimeEntry.harvestId (spec 13 update sync).
 *
 * Why: the original bulk import (migrate-timesheets.mjs) wrote 388k entries with no Harvest id, so a
 * delta couldn't be applied without duplicating. This composes the CURRENT state of every entry —
 * the full snapshot's rows overlaid by delta rows (newest `updated_at` wins) — and replaces each
 * year in one transaction with keyed rows. Afterwards it writes the TIME_KEYED_MARKER so the regular
 * importer (in-app Incremental → Apply import) upserts time by harvestId from then on.
 *
 *   - Per-year transaction: the homepage/reports never see a half-written year.
 *   - Only Harvest-sourced rows are replaced: keyed rows, plus unkeyed rows created by the bulk import
 *     (createdAt < BULK_CUTOFF). Entries created in Track2 itself are never touched.
 *   - Resumable: a year whose keyed count already equals the composed count (and has no unkeyed bulk
 *     rows left) is skipped. FRESH DB connection per year (a long-lived one went stale in August).
 *   - Gap: entries DELETED in Harvest after the full snapshot stay (deltas only carry changed rows).
 *
 * GO-LIVE GUARD: this deletes and recreates Harvest-sourced time entries. Once Track2 is used for real
 * work that would destroy Track2 history, so --apply REFUSES when any of these exist (dry run reports them):
 *   - a time entry on a Track2 invoice line (invoiceLineItemId) or an approved timesheet,
 *   - a time entry created in Track2 (harvestId null, createdAt >= BULK_CUTOFF), or a running timer,
 *   - a Harvest-sourced entry edited in Track2 after import (updatedAt is neither the import's own
 *     write time nor a whole-second Harvest stamp; see modules/migration/protect.ts).
 * Override with --force-after-go-live. Even then, KEYED entries that are invoiced/approved/running/
 * edited in Track2 are kept (not deleted, not re-created). MIGRATION_LOCKED=1 refuses --apply outright.
 * Rows it writes carry updatedAt = Harvest's updated_at, so later imports can tell them from Track2 edits.
 *
 * Usage:
 *   ACCOUNT_ID=acc_x node --env-file=.env scripts/rebuild-timesheets.mjs            # dry run: reconciliation + guard report
 *   ACCOUNT_ID=acc_x node --env-file=.env scripts/rebuild-timesheets.mjs --apply    # write (safe to re-run)
 *   ACCOUNT_ID=acc_x node --env-file=.env scripts/rebuild-timesheets.mjs --apply --force   # rewrite every year
 * Env: ACCOUNT_ID (required), FULL_SNAPSHOT_ID (optional), BULK_CUTOFF (default 2026-08-08T00:00:00Z).
 *
 * Run the non-time import for each incremental snapshot FIRST (new people/projects/tasks must exist):
 *   SNAPSHOT_ID=<id> npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/migrate-staged.ts full --apply
 */
import { PrismaClient } from '@prisma/client'
import { assertNotLocked, refuse, requireAccountId } from './lib/guards.mjs'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')
const AFTER_GO_LIVE = process.argv.includes('--force-after-go-live')
const TE_CHUNK = 2000
const ASG_CHUNK = 1000
const DRY = '__dry__'
const BULK_CUTOFF = new Date(process.env.BULK_CUTOFF ?? '2026-08-08T00:00:00Z')
const MARKER = { entity: 'time_harvest_ids', harvestId: 'done' } // = TIME_KEYED_MARKER in importer.ts

const cents = (v) => (v == null || v === '' ? null : Math.round(Number(v) * 100))
const minutes = (v) => (v == null ? 0 : Math.round(Number(v) * 60))
const dateOnly = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`) : new Date())
const sid = (v) => (v == null ? null : String(v))
const yearOf = (te) => String(te.spent_date ?? '').slice(0, 4)
const hrs = (m) => (m / 60).toLocaleString('en-US', { maximumFractionDigits: 1 })
const log = (m) => process.stdout.write(m + '\n')

if (APPLY) assertNotLocked('rebuild-timesheets --apply')
const boot = new PrismaClient()
const accountId = (await requireAccountId(boot)).id

// ---- go-live guard -------------------------------------------------------------------------------
// "Edited in Track2": updatedAt is not a whole-second Harvest stamp AND differs from createdAt by more
// than the slack of one write (same rule as modules/migration/protect.ts isImportStamped).
const EDITED_SQL = `("updatedAt" <> date_trunc('second', "updatedAt") AND abs(extract(epoch from ("updatedAt" - "createdAt"))) > 2)`
const [g] = await boot.$queryRawUnsafe(
  `SELECT
     COUNT(*) FILTER (WHERE "invoiceLineItemId" IS NOT NULL)::int AS linked,
     COUNT(*) FILTER (WHERE "approvedTimesheetId" IS NOT NULL)::int AS approved,
     COUNT(*) FILTER (WHERE "isRunning")::int AS running,
     COUNT(*) FILTER (WHERE "harvestId" IS NULL AND "createdAt" >= $2)::int AS native,
     COUNT(*) FILTER (WHERE ("harvestId" IS NOT NULL OR "createdAt" < $2) AND ${EDITED_SQL})::int AS edited,
     MAX("createdAt") FILTER (WHERE "harvestId" IS NOT NULL OR "createdAt" < $2) AS "lastImport"
   FROM "TimeEntry" WHERE "accountId" = $1`,
  accountId, BULK_CUTOFF,
)
const goLive = { linked: g.linked, approved: g.approved, running: g.running, native: g.native, edited: g.edited }
const goLiveHits = Object.values(goLive).reduce((a, b) => a + b, 0)
log(`\n▶ Go-live check (account ${accountId}, last Harvest import write ${g.lastImport ? new Date(g.lastImport).toISOString() : 'n/a'})`)
log(`  on Track2 invoices=${goLive.linked}  approved=${goLive.approved}  running timers=${goLive.running}  created in Track2=${goLive.native}  edited in Track2=${goLive.edited}`)
if (goLive.edited > 0) {
  const sample = await boot.$queryRawUnsafe(`SELECT id, "harvestId", "createdAt", "updatedAt" FROM "TimeEntry" WHERE "accountId" = $1 AND ${EDITED_SQL} ORDER BY "updatedAt" DESC LIMIT 5`, accountId)
  for (const r of sample) log(`    edited: ${r.id} harvestId=${r.harvestId ?? '-'} created=${new Date(r.createdAt).toISOString()} updated=${new Date(r.updatedAt).toISOString()}`)
}
if (goLiveHits > 0 && APPLY && !AFTER_GO_LIVE) {
  await boot.$disconnect()
  refuse('Track2 already holds work that a rebuild would destroy', [
    'This script deletes and recreates every Harvest-sourced time entry for each year.',
    'Track2 has invoiced, approved, running, native or edited entries (counts above), so it looks',
    'like Track2 is in real use. If you are certain, re-run with --apply --force-after-go-live',
    '(keyed entries that Track2 owns are then kept; unkeyed bulk rows are still replaced).',
  ])
}
if (goLiveHits > 0 && APPLY) log('  ⚠️  --force-after-go-live: proceeding; keyed Track2-owned entries are preserved.')

const finished = { in: ['complete', 'partial'] }
const full = process.env.FULL_SNAPSHOT_ID
  ? await boot.migrationSnapshot.findFirst({ where: { id: process.env.FULL_SNAPSHOT_ID, accountId } })
  : await boot.migrationSnapshot.findFirst({ where: { accountId, mode: 'full', status: finished }, orderBy: { createdAt: 'desc' } })
if (!full) { log('No finished full snapshot.'); process.exit(1) }
const deltas = await boot.migrationSnapshot.findMany({
  where: { accountId, mode: 'incremental', status: finished, createdAt: { gt: full.createdAt } },
  orderBy: { createdAt: 'asc' },
  select: { id: true, createdAt: true },
})

// Latest version of every entry touched by any delta (newest updated_at; later snapshot breaks ties).
const latest = new Map()
for (const d of deltas) {
  const parts = await boot.migrationSnapshotPart.findMany({ where: { snapshotId: d.id, resource: 'time_entries' }, select: { data: true } })
  for (const part of parts) {
    for (const te of Array.isArray(part.data) ? part.data : []) {
      const prev = latest.get(String(te.id))
      if (!prev || String(te.updated_at ?? '') >= String(prev.updated_at ?? '')) latest.set(String(te.id), te)
    }
  }
}
const deltaByYear = new Map()
for (const te of latest.values()) {
  const y = yearOf(te)
  if (!deltaByYear.has(y)) deltaByYear.set(y, [])
  deltaByYear.get(y).push(te)
}

const mapRows = await boot.migrationIdMap.findMany({ where: { accountId, entity: { in: ['user', 'project', 'task'] } }, select: { entity: true, harvestId: true, localId: true } })
const maps = { user: new Map(), project: new Map(), task: new Map() }
for (const r of mapRows) if (r.localId !== DRY) maps[r.entity].set(r.harvestId, r.localId)

const fullParts = await boot.migrationSnapshotPart.findMany({ where: { snapshotId: full.id, resource: 'time_entries' }, select: { id: true, chunk: true }, orderBy: { chunk: 'asc' } })
const partByYear = new Map(fullParts.map((p) => [p.chunk, p.id]))
const years = [...new Set([...partByYear.keys(), ...deltaByYear.keys()])].filter((y) => /^\d{4}$/.test(y)).sort()
await boot.$disconnect()

log(`\n▶ Rebuild time entries keyed by Harvest id`)
log(`  account=${accountId}  full=${full.id} (${full.createdAt.toISOString().slice(0, 10)})  mode=${APPLY ? 'APPLY' : 'DRY RUN'}${FORCE ? ' +force' : ''}`)
log(`  deltas: ${deltas.map((d) => `${d.id} (${d.createdAt.toISOString().slice(0, 10)})`).join(', ') || 'none'}  → ${latest.size} changed/new entries`)
log(`  id-maps: users=${maps.user.size} projects=${maps.project.size} tasks=${maps.task.size}  bulk cutoff=${BULK_CUTOFF.toISOString()}\n`)
log(`  year   source  changed    new  skipped |  composed      hours |  db now      hours |  Δ entries     Δ hours`)

const mapRow = (te) => {
  const userId = maps.user.get(sid(te.user?.id))
  const projectId = maps.project.get(sid(te.project?.id))
  const taskId = maps.task.get(sid(te.task?.id))
  if (!userId || !projectId || !taskId) return null
  return {
    accountId, userId, projectId, taskId,
    harvestId: String(te.id),
    spentDate: dateOnly(te.spent_date),
    minutes: minutes(te.hours),
    notes: te.notes ?? null,
    isBillable: te.billable ?? true,
    billableRateCents: cents(te.billable_rate),
    lockState: te.invoice?.id ? 'invoiced' : te.is_locked ? 'approved' : 'open',
    // Harvest's whole-second updated_at: marks the row as "as imported" (protect.ts isImportStamped).
    ...(stampOf(te.updated_at) ? { updatedAt: stampOf(te.updated_at) } : {}),
  }
}
function stampOf(v) {
  if (!v) return null
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? null : new Date(Math.floor(d.getTime() / 1000) * 1000)
}

// Rows the rebuild owns: keyed (from Harvest) or unkeyed bulk-import rows. Track2-native rows excluded.
const harvestOwned = { OR: [{ harvestId: { not: null } }, { harvestId: null, createdAt: { lt: BULK_CUTOFF } }] }

const tot = { source: 0, changed: 0, added: 0, skipped: 0, composed: 0, composedMin: 0, db: 0, dbMin: 0, written: 0 }
const userAsg = new Set(), taskAsg = new Set()

async function processYear(year) {
  const yStart = new Date(`${year}-01-01T00:00:00.000Z`)
  const yEnd = new Date(`${Number(year) + 1}-01-01T00:00:00.000Z`)
  const inYear = { accountId, spentDate: { gte: yStart, lt: yEnd } }
  const db = new PrismaClient()
  try {
    const partId = partByYear.get(year)
    const base = partId ? (await db.migrationSnapshotPart.findUnique({ where: { id: partId }, select: { data: true } }))?.data ?? [] : []
    const fromDelta = deltaByYear.get(year) ?? []
    const composed = new Map()
    let changed = 0
    for (const te of base) if (!latest.has(String(te.id))) composed.set(String(te.id), te)
    for (const te of base) if (latest.has(String(te.id)) && yearOf(latest.get(String(te.id))) === year) changed++
    for (const te of fromDelta) composed.set(String(te.id), te)
    const added = fromDelta.length - changed

    const buf = []
    let skipped = 0
    for (const te of composed.values()) {
      const m = mapRow(te)
      if (!m) { skipped++; continue }
      buf.push(m)
      userAsg.add(`${m.projectId}|${m.userId}`)
      taskAsg.add(`${m.projectId}|${m.taskId}`)
    }
    const bufMin = buf.reduce((a, r) => a + r.minutes, 0)
    const now = await db.timeEntry.aggregate({ where: { ...inYear, ...harvestOwned }, _count: true, _sum: { minutes: true } })
    const dbMin = now._sum.minutes ?? 0

    tot.source += base.length; tot.changed += changed; tot.added += added; tot.skipped += skipped
    tot.composed += buf.length; tot.composedMin += bufMin; tot.db += now._count; tot.dbMin += dbMin
    const sign = (n) => (n > 0 ? `+${n}` : String(n))
    const line = `  ${year}  ${String(base.length).padStart(7)}  ${String(changed).padStart(6)}  ${String(added).padStart(5)}  ${String(skipped).padStart(7)} | ${String(buf.length).padStart(9)}  ${hrs(bufMin).padStart(9)} | ${String(now._count).padStart(7)}  ${hrs(dbMin).padStart(9)} | ${sign(buf.length - now._count).padStart(10)}  ${sign(Math.round((bufMin - dbMin) / 6) / 10).padStart(10)}`
    if (!APPLY) { log(line); return }

    const [keyed, legacy] = await Promise.all([
      db.timeEntry.count({ where: { ...inYear, harvestId: { not: null } } }),
      db.timeEntry.count({ where: { ...inYear, harvestId: null, createdAt: { lt: BULK_CUTOFF } } }),
    ])
    if (!FORCE && legacy === 0 && keyed === buf.length) { tot.written += keyed; log(`${line}   already keyed — skipped`); return }

    // Keyed rows Track2 owns (invoiced/approved/running/edited there) are never deleted or re-created.
    const keep = await db.$queryRawUnsafe(
      `SELECT "harvestId" FROM "TimeEntry" WHERE "accountId" = $1 AND "harvestId" IS NOT NULL
         AND ("invoiceLineItemId" IS NOT NULL OR "approvedTimesheetId" IS NOT NULL OR "isRunning" OR ${EDITED_SQL})`,
      accountId,
    )
    const keepIds = new Set(keep.map((r) => r.harvestId))
    const toWrite = keepIds.size ? buf.filter((r) => !keepIds.has(r.harvestId)) : buf
    if (keepIds.size) log(`  ${year}: keeping ${keepIds.size} Track2-owned keyed entr${keepIds.size === 1 ? 'y' : 'ies'} (account-wide)`)
    const protectedWhere = keepIds.size ? { NOT: { harvestId: { in: [...keepIds] } } } : {}

    await db.$transaction(async (tx) => {
      await tx.timeEntry.deleteMany({ where: { ...inYear, ...harvestOwned, ...protectedWhere } })
      // An entry whose date moved across years may still sit (keyed) in another year — clear it first.
      for (let i = 0; i < toWrite.length; i += 5000) {
        await tx.timeEntry.deleteMany({ where: { accountId, harvestId: { in: toWrite.slice(i, i + 5000).map((r) => r.harvestId) } } })
      }
      for (let i = 0; i < toWrite.length; i += TE_CHUNK) await tx.timeEntry.createMany({ data: toWrite.slice(i, i + TE_CHUNK) })
    }, { timeout: 600_000, maxWait: 60_000 })
    tot.written += buf.length
    log(`${line}   wrote ${toWrite.length}${toWrite.length !== buf.length ? ` (kept ${buf.length - toWrite.length})` : ''}`)
  } finally {
    await db.$disconnect()
  }
}

for (const y of years) {
  try {
    await processYear(y)
  } catch (e) {
    log(`  ${y}: ERROR ${String(e.message).slice(0, 160)} — retrying once…`)
    await new Promise((r) => setTimeout(r, 2000))
    await processYear(y)
  }
}

log(`  ${'─'.repeat(104)}`)
log(`  all   ${String(tot.source).padStart(7)}  ${String(tot.changed).padStart(6)}  ${String(tot.added).padStart(5)}  ${String(tot.skipped).padStart(7)} | ${String(tot.composed).padStart(9)}  ${hrs(tot.composedMin).padStart(9)} | ${String(tot.db).padStart(7)}  ${hrs(tot.dbMin).padStart(9)}`)

const fin = new PrismaClient()
if (APPLY) {
  const uArr = [...userAsg].map((k) => { const [projectId, userId] = k.split('|'); return { accountId, projectId, userId } })
  const tArr = [...taskAsg].map((k) => { const [projectId, taskId] = k.split('|'); return { accountId, projectId, taskId } })
  let uw = 0, tw = 0
  for (let i = 0; i < uArr.length; i += ASG_CHUNK) uw += (await fin.projectUserAssignment.createMany({ data: uArr.slice(i, i + ASG_CHUNK), skipDuplicates: true })).count
  for (let i = 0; i < tArr.length; i += ASG_CHUNK) tw += (await fin.projectTaskAssignment.createMany({ data: tArr.slice(i, i + ASG_CHUNK), skipDuplicates: true })).count
  log(`\nAssignments added for new combinations: projectUser +${uw}  projectTask +${tw}`)

  const [keyed, legacy, native] = await Promise.all([
    fin.timeEntry.count({ where: { accountId, harvestId: { not: null } } }),
    fin.timeEntry.count({ where: { accountId, harvestId: null, createdAt: { lt: BULK_CUTOFF } } }),
    fin.timeEntry.count({ where: { accountId, harvestId: null, createdAt: { gte: BULK_CUTOFF } } }),
  ])
  log(`\nReconciliation: composed=${tot.composed}  keyed in db=${keyed}  unkeyed bulk rows left=${legacy}  Track2-native=${native}`)
  if (keyed === tot.composed && legacy === 0) {
    await fin.migrationIdMap.upsert({
      where: { accountId_entity_harvestId: { accountId, ...MARKER } },
      create: { accountId, ...MARKER, localId: 'done' },
      update: {},
    })
    log('✅ All Harvest time entries keyed. Marker written — the in-app importer now upserts time by harvestId.')
  } else {
    log('⚠️  Not fully keyed yet — re-run with --apply to finish (resumable). Marker NOT written.')
  }
} else {
  log('\n(dry run — nothing written. Re-run with --apply.)')
}
await fin.$disconnect()
process.exit(0)
