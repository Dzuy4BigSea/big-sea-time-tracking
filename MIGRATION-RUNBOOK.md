# Harvest → Track2 migration runbook

Operational companion to [`specs/13-migration.md`](specs/13-migration.md). This is the exact procedure
for the real Big Sea cutover, including the hard constraints discovered running it against the live
account (Harvest-Account-Id `97126`).

## The plan (3 passes)
1. **Now** — full backup + first import (dry-run → apply) to shake out the mapping.
2. **~3 days later** — incremental (delta) backup + re-run import (idempotent) to catch changes.
3. **Cutover** — final incremental, verify counts, switch the team over.

Every step is idempotent and keeps an untouched raw copy **before** any transform, so nothing is lost.

> **Go-live safety (2026-10-13).** Once Track2 is the system of record, set `MIGRATION_LOCKED=1` in Vercel
> (and in any shell that runs these scripts): Settings → Migrate and every migration script then refuse to
> write. Until then, the importer never overwrites Track2-owned rows (see "What the importer does" below),
> every destructive script is a dry run by default and needs an explicit `ACCOUNT_ID`, and wipes refuse on
> production-sized data. Backups, restore, the DB health check and the full guard table are in [OPS.md](OPS.md).

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

> The button works for the first update sync too (fixed 2026-09-30: it deltas from the last finished
> full backup, and an estimates-only 403 counts as clean). The offline mode below is the fallback.

**Offline incremental (update sync):**
```bash
# needs INTEGRATION_ENC_KEY in .env (copy from Vercel → Settings → Environment Variables)
node --env-file=.env scripts/backup-harvest-offline.mjs --incremental --since=2026-08-06T00:00:00Z --years=2025,2026
```
- Writes a **new** `incremental` snapshot; the original full snapshot is never touched. Resumable.
- Light resources: pulled whole. Expenses/invoices: `updated_since` delta (id-mapped → safe upserts).
- **Time entries:** since 2026-10-07 every Harvest-sourced entry is keyed by `TimeEntry.harvestId`.
  The first time after the bulk import, run
  `ACCOUNT_ID=acc_demo node --env-file=.env scripts/rebuild-timesheets.mjs` (dry run, then `--apply`)
  after importing the delta's other entities: it composes full snapshot + deltas and replaces each year
  with keyed rows, then writes the `time_harvest_ids` marker. From then on the importer upserts time by
  `harvestId`. Deletions in Harvest are not caught by deltas.
  - **Go-live guard:** the dry run prints a "Go-live check". `--apply` refuses if any entry is on a
    Track2 invoice, approved, running, created in Track2 (after `BULK_CUTOFF`), or edited in Track2 after
    import. If Track2 is already in real use, stop and decide; `--force-after-go-live` proceeds but keeps
    keyed Track2-owned entries. Rows it writes carry `updatedAt` = Harvest's `updated_at` (see below).
- **Assignments:** `INTEGRATION_ENC_KEY=... node --env-file=.env scripts/sync-assignments.mjs` is now a dry
  run; add `--apply` to write (it overwrites assignment rates and PM flags with Harvest's).

**No local machine? Run the scripts from GitHub.** `.github/workflows/migration-script.yml` is a
manual-only workflow (Actions → "Migration script (manual)" → Run workflow): pick `rebuild-timesheets`
or `sync-assignments` (or `parity-check`: a read-only Harvest ↔ Track2 comparison of every entity, invoice
totals/due/state and time per year, listing each mismatch), leave **apply** unticked for the dry run, read the log, then run again with
**apply** ticked. It needs the repository secrets `DATABASE_URL` (Supabase session pooler, port 5432)
and `INTEGRATION_ENC_KEY` (same as Vercel). It never runs on its own.

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
  The highest number is now the **numeric** max of the trailing digits (until 2026-10-13 it was Prisma's
  alphabetical `_max`, so `'999'` beat `'7801'` and the sequence could sit below real invoice numbers).
  Repair an existing database with `ACCOUNT_ID=acc_demo node --env-file=.env scripts/fix-number-sequences.mjs`
  (dry run) then `--confirm`; `scripts/check-db-health.mjs` reports whether it is needed.

**What the importer never overwrites (go-live protections, `modules/migration/protect.ts`)**
- Time entries that are locked (`lockState` not `open`), on a Track2 invoice line, on an approved timesheet,
  running, or **edited in Track2 after import**. The importer and `rebuild-timesheets.mjs` stamp `updatedAt`
  with Harvest's whole-second `updated_at`; a Track2 edit sets a millisecond-precision `updatedAt`, so an
  entry whose `updatedAt` is neither a Harvest stamp nor its own creation time is treated as Track2's. A
  Harvest version that is not newer than the stamp is skipped, so re-importing an old snapshot cannot roll
  entries back.
- Expenses that are on an invoice line or locked.
- Invoices Track2 has touched: any audit entry by a person or not written by the importer (sent, paid,
  edited, Stripe), a non-imported payment, linked time/expenses, a public link, a Xero copy. Their fields,
  line items and payments are left alone (line items are never rebuilt).
- Estimates that were sent from Track2 or converted to an invoice.
- Each skip is reported as a "Protected N …" note under the import results. Entries **deleted** in Track2
  but still in Harvest are re-created by an import, which is one more reason to set `MIGRATION_LOCKED=1`
  at go-live.

## Step 3 — Verify + cutover
- Compare Track2 counts (Reports, Clients, Projects, Team) against the snapshot's `entityCounts`.
- Spot-check a few invoices end-to-end (totals, paid amount, line items).
- Run one final incremental backup + import immediately before switching the team over.

## Rollback / safety
- Nightly off-site `pg_dump` (GitHub Actions) and the tested restore procedure: [OPS.md](OPS.md).
- Settings → Data export downloads every table as CSV (admins).
- The raw snapshot is immutable and downloadable (manifest + per-part, with checksums) from the Migrate page.
- Re-running the import never duplicates (idempotent id-map). To discard an import and retry, clear the
  imported rows + `MigrationIdMap` for the account; the snapshot is untouched and can be re-imported.
