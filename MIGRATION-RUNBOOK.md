# Harvest → Track2 migration runbook

Operational companion to [`specs/13-migration.md`](specs/13-migration.md). This is the exact procedure
for the real Big Sea cutover, including the hard constraints discovered running it against the live
account (Harvest-Account-Id `97126`).

## The plan (3 passes)
1. **Now** — full backup + first import (dry-run → apply) to shake out the mapping.
2. **~3 days later** — incremental (delta) backup + re-run import (idempotent) to catch changes.
3. **Cutover** — final incremental, verify counts, switch the team over.

Every step is idempotent and keeps an untouched raw copy **before** any transform, so nothing is lost.

## Data volumes (why some steps are offline)
| Resource | Rows | Notes |
|---|---|---|
| clients | ~594 | |
| contacts | ~970 | |
| projects | ~2,649 | |
| tasks | ~581 | |
| users | ~130 | |
| time entries | **~270,000** | 25k–52k per year; **100–300s to pull per year** |
| estimates | — | `/estimates` returns **403 (not authorized)** on this plan — skipped; snapshot ends `partial` (expected) |

## Step 1 — Backup (raw, before ETL)

> ⚠️ The **initial full history cannot be captured from the in-app "Full backup" button.** A single
> year of time entries takes longer than any serverless request allows, so the function dies mid-pull
> and the button appears frozen. Run the initial full backup **offline** instead. Delta pulls later
> are small and DO work from the button.

**Initial full backup (offline, no time cap):**
```bash
# same value as Vercel's INTEGRATION_ENC_KEY; DATABASE_URL = Supabase session pooler (:5432)
INTEGRATION_ENC_KEY=... DATABASE_URL=... node scripts/backup-harvest-offline.mjs
```
- Resumable + idempotent — re-run if it's interrupted; already-captured year-chunks are skipped.
- Writes one `MigrationSnapshotPart` per resource/year with a SHA-256 checksum.
- Finishes `complete` (or `partial` if estimates 403 — that's fine).

**Later delta backups:** use **Settings → Migrate → Incremental (delta since last)** in the app. Small,
serverless-safe, pulls only records changed since the last clean pull.

> ⚠️ As of 2026-09-30 the in-app button **can't be used for the first update sync**: the initial
> backup never saved `lastPulledAt` on the Harvest connection, so it refuses ("run a full backup
> first"). Use the offline incremental mode instead; it saves `lastPulledAt` when it finishes, so
> later deltas can use the button.

**Offline incremental (update sync):**
```bash
# needs INTEGRATION_ENC_KEY in .env (copy from Vercel → Settings → Environment Variables)
node --env-file=.env scripts/backup-harvest-offline.mjs --incremental --since=2026-08-06T00:00:00Z --years=2025,2026
```
- Writes a **new** `incremental` snapshot; the original full snapshot is never touched. Resumable.
- Light resources: pulled whole. Expenses/invoices: `updated_since` delta (id-mapped → safe upserts).
- **Time entries are special:** the bulk import (`migrate-timesheets.mjs`) has no per-row id-map, so a
  delta upsert would duplicate. The sync pulls **whole years** (`--years`) so the bulk importer can
  replace them by year (this also catches Harvest-side deletions), plus a `delta` chunk to spot
  edits in older years. Only safe while Track2 has **no native time entries** in those years.

## Step 2 — Import into Track2 (`Settings → Migrate → 3`)
1. **Preview import (dry run)** — writes nothing; reports created/updated/skipped/errors per entity.
   Review the counts against the table above.
2. **Apply import** — idempotent upserts keyed by `MigrationIdMap(entity, harvestId)`. Resumable across
   the serverless cap via a cursor; the on-screen runner drives it to completion. Safe to re-run.

**What the importer does / doesn't do**
- Order: clients → contacts → tasks → people → expense categories → projects → time → expenses → invoices → estimates.
- **People matched by email are mapped, never overwritten** — real Track2 admins (e.g. andi@, dzuy@) are
  protected. Imported people get an unusable password hash and must use password-reset to sign in.
- Derived (documented gaps): project↔task / project↔user **assignments** are reconstructed from the
  distinct combinations in time entries (historical time already carries its resolved billable rate);
  a single **payment** is synthesized per invoice for its paid portion (Harvest exposes payment history
  only per-invoice, which the flat backup doesn't capture).
- Invoice/estimate number sequences are bumped past the highest imported number so new docs don't collide.

## Step 3 — Verify + cutover
- Compare Track2 counts (Reports, Clients, Projects, Team) against the snapshot's `entityCounts`.
- Spot-check a few invoices end-to-end (totals, paid amount, line items).
- Run one final incremental backup + import immediately before switching the team over.

## Rollback / safety
- The raw snapshot is immutable and downloadable (manifest + per-part, with checksums) from the Migrate page.
- Re-running the import never duplicates (idempotent id-map). To discard an import and retry, clear the
  imported rows + `MigrationIdMap` for the account; the snapshot is untouched and can be re-imported.
